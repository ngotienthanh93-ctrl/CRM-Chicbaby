import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { maskPhone } from '../../security/masking';
import { serializeBaby, serializeCustomerSummary, serializeFollowUpContent } from '../../security/serialize';
import { formatVnDate } from '../../lib/datetime';
import { normalizePhone } from '../../lib/phone';

export const customersRouter = Router();
customersRouter.use(requireAuth);

const listQuery = z.object({
  search: z.string().optional(),
  role: z.enum(['retail_customer', 'wholesale_contact']).optional(),
  hasBaby: z.enum(['true', 'false']).optional(),
  tag: z.string().optional(),
  take: z.coerce.number().min(1).max(200).default(50),
});

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const perms = req.permissions!;
    const search = q.search?.trim();

    // 🔴 SEC-07: Marketing (không viewSensitive) tìm theo SĐT => KHÔNG trả kết quả.
    const looksLikePhone = !!search && /\d{6,}/.test(normalizePhone(search));
    if (search && looksLikePhone && !perms.viewSensitive) {
      res.json({ items: [], note: 'Không có quyền tìm theo số điện thoại.' });
      return;
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (q.role) where.roles = { some: { role: q.role } };
    if (q.hasBaby === 'true') where.babies = { some: { deletedAt: null } };
    if (q.hasBaby === 'false') where.babies = { none: { deletedAt: null } };
    if (q.tag) where.tagAssignments = { some: { tag: q.tag } };
    if (search && !looksLikePhone) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    } else if (search && looksLikePhone && perms.viewSensitive) {
      where.phones = { some: { phoneNormalized: { contains: normalizePhone(search) } } };
    }

    const customers = await prisma.customerCrm.findMany({
      where,
      take: q.take,
      orderBy: { createdAt: 'desc' },
      include: {
        phones: true,
        roles: true,
        _count: { select: { babies: true, externalIdentities: true } },
      },
    });

    res.json({
      items: customers.map((c) => serializeCustomerSummary(c, perms)),
    });
  }),
);

async function loadCustomer(id: string) {
  const c = await prisma.customerCrm.findFirst({
    where: { id, deletedAt: null },
    include: {
      phones: true,
      roles: true,
      externalIdentities: true,
      tagAssignments: true,
      consents: { include: { consentType: true } },
      _count: { select: { babies: { where: { deletedAt: null } }, externalIdentities: true } },
    },
  });
  if (!c) throw notFound('Không tìm thấy khách hàng.');
  return c;
}

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const perms = req.permissions!;
    const c = await loadCustomer(String(req.params.id));
    res.json({
      id: c.id,
      fullName: perms.viewSensitive ? c.fullName : c.displayName ?? c.fullName,
      displayName: c.displayName ?? c.fullName,
      retentionStatus: c.retentionStatus,
      preferredChannel: c.preferredChannel,
      note: perms.viewSensitive ? c.note : null,
      phones: c.phones.map((p) => ({
        id: p.id,
        type: p.type,
        isPrimary: p.isPrimary,
        source: p.source,
        phone: maskPhone(p.phoneRaw, perms.viewSensitive),
      })),
      roles: c.roles.map((r) => r.role),
      kvCodes: c.externalIdentities.map((e) => e.externalCode ?? e.externalCustomerId),
      tags: c.tagAssignments.map((t) => t.tag),
      babyCount: c._count.babies,
      consents: c.consents.map((cs) => ({
        type: cs.consentType.key,
        name: cs.consentType.name,
        status: cs.status,
      })),
      masked: !perms.viewSensitive,
    });
  }),
);

// 🔴 Tab hồ sơ bé — Marketing 403 (SEC-06)
customersRouter.get(
  '/:id/babies',
  requirePermission('viewBaby'),
  asyncHandler(async (req, res) => {
    const perms = req.permissions!;
    const babies = await prisma.babyProfile.findMany({
      where: { customerId: String(req.params.id), deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items: babies.map((b) => serializeBaby(b, perms)) });
  }),
);

// Tab tư vấn — ẩn toàn bộ nếu không có quyền
customersRouter.get(
  '/:id/consultations',
  requirePermission('viewConsultation'),
  asyncHandler(async (req, res) => {
    const items = await prisma.consultation.findMany({
      where: { customerId: String(req.params.id), deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { advisedProducts: true },
    });
    res.json({
      items: items.map((c) => ({
        id: c.id,
        issue: c.issue,
        temperature: c.temperature,
        result: c.result,
        nextContactDate: c.nextContactDate ? formatVnDate(c.nextContactDate) : null,
        note: c.note,
        createdAt: formatVnDate(c.createdAt),
      })),
    });
  }),
);

// Lịch sử mua HỢP NHẤT mọi mã KV (CUS-09)
customersRouter.get(
  '/:id/purchases',
  asyncHandler(async (req, res) => {
    const identities = await prisma.customerExternalIdentity.findMany({
      where: { customerId: String(req.params.id), unlinkedAt: null },
      select: { externalCustomerId: true },
    });
    const kvIds = identities.map((i) => i.externalCustomerId);
    if (kvIds.length === 0) {
      res.json({ items: [] });
      return;
    }
    const invoices = await prisma.kvInvoice.findMany({
      where: { kvCustomerId: { in: kvIds } },
      orderBy: { purchaseDate: 'desc' },
      take: 100,
      include: { lines: { include: { product: true, allocations: true } } },
    });
    res.json({
      readonly: true,
      badge: 'KV · chỉ đọc',
      items: invoices.map((inv) => ({
        kvInvoiceId: inv.kvInvoiceId,
        code: inv.code,
        purchaseDate: formatVnDate(inv.purchaseDate),
        total: Number(inv.total),
        status: inv.status,
        lines: inv.lines.map((l) => ({
          product: l.product.name,
          quantity: Number(l.quantity),
          price: Number(l.price),
          // 🔴 FIX-6: 1 dòng có thể chia nhiều bé => tổng hợp trạng thái phân bổ.
          allocationStatus:
            l.allocations.length === 0
              ? 'chua_phan_bo'
              : l.allocations.length === 1
                ? l.allocations[0]!.assignmentStatus
                : 'da_chia_nhieu_be',
        })),
      })),
    });
  }),
);

customersRouter.get(
  '/:id/followups',
  asyncHandler(async (req, res) => {
    const perms = req.permissions!;
    const items = await prisma.followUp.findMany({
      where: { customerId: String(req.params.id) },
      orderBy: { dueDate: 'desc' },
      take: 100,
    });
    res.json({
      items: items.map((f) => ({
        id: f.id,
        reminderType: f.reminderType,
        status: f.status,
        dueDate: formatVnDate(f.dueDate),
        // 🔴 FIX-1: nội dung có thể chứa tên bé => vai thiếu quyền nhận bản trung tính.
        content: serializeFollowUpContent(perms, {
          reminderType: f.reminderType,
          targetType: f.targetType,
          content: f.content,
        }),
      })),
    });
  }),
);

customersRouter.get(
  '/:id/consents',
  asyncHandler(async (req, res) => {
    const events = await prisma.consentEvent.findMany({
      where: { customerId: String(req.params.id) },
      orderBy: { createdAt: 'desc' },
      include: { consentType: true },
    });
    res.json({
      items: events.map((e) => ({
        type: e.consentType.key,
        name: e.consentType.name,
        status: e.status,
        at: formatVnDate(e.createdAt),
      })),
    });
  }),
);

// Xem đầy đủ SĐT — GHI AUDIT mỗi lần (SEC-07/08)
customersRouter.post(
  '/:id/reveal-phone',
  requirePermission('viewSensitive'),
  asyncHandler(async (req, res) => {
    const c = await loadCustomer(String(req.params.id));
    await writeAudit({
      userId: req.auth!.userId,
      action: 'customer.reveal_phone',
      objectType: 'customer',
      objectId: c.id,
      reason: 'Nhân viên bấm Xem đầy đủ SĐT',
      ip: req.ip,
    });
    res.json({
      phones: c.phones.map((p) => ({ id: p.id, type: p.type, phone: p.phoneRaw })),
    });
  }),
);
