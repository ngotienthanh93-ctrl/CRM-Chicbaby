import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { assertBabyBelongsToInvoiceLine } from '../../security/ownership';
import { formatVnDate } from '../../lib/datetime';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import {
  evaluateBulkApply,
  validateSplitSegments,
  type BulkLine,
  type SplitSegment,
} from '../../engines/allocation';

/** Thông điệp 409 chung cho optimistic locking (CONC-03). */
const STALE_VERSION_MSG = 'Dữ liệu vừa được người khác cập nhật, vui lòng tải lại rồi thử lại.';

export const allocationsRouter = Router();
// Màn phân bổ hiển thị gợi ý bé => cần quyền xem bé (Marketing 403).
allocationsRouter.use(requireAuth, requirePermission('viewBaby'));

const cfg = DEFAULT_ENGINE_CONFIG;

const STATUS_MAP: Record<string, string[]> = {
  needs: ['suggested'],
  auto: ['auto_assigned'],
  done: ['confirmed'],
};

const listQuery = z.object({ status: z.enum(['needs', 'auto', 'done']).default('needs') });

allocationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = listQuery.parse(req.query);
    const perms = req.permissions!;

    // map kvCustomerId -> crm customer (tên)
    const identities = await prisma.customerExternalIdentity.findMany({
      where: { unlinkedAt: null },
      include: { customer: true },
    });
    const kvToCustomer = new Map<string, { id: string; name: string }>();
    identities.forEach((i) =>
      kvToCustomer.set(i.externalCustomerId, {
        id: i.customerId,
        name: i.customer.displayName ?? i.customer.fullName,
      }),
    );

    const allocations = await prisma.invoiceItemBabyAllocation.findMany({
      where: { assignmentStatus: { in: STATUS_MAP[status] as never[] } },
      include: {
        invoiceLine: { include: { invoice: true, product: true } },
        suggestedBaby: true,
        baby: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    // gom theo khách
    const groups = new Map<
      string,
      { customerId: string | null; customerName: string; lines: unknown[] }
    >();
    for (const a of allocations) {
      const kvCustomerId = a.invoiceLine.invoice.kvCustomerId ?? '';
      const cust = kvToCustomer.get(kvCustomerId);
      const key = cust?.id ?? `kv:${kvCustomerId}`;
      const group = groups.get(key) ?? {
        customerId: cust?.id ?? null,
        customerName: cust?.name ?? 'Khách chưa liên kết',
        lines: [],
      };
      group.lines.push({
        allocationId: a.id,
        product: a.invoiceLine.product.name,
        quantity: Number(a.assignedQuantity),
        purchaseDate: formatVnDate(a.invoiceLine.invoice.purchaseDate),
        assignmentStatus: a.assignmentStatus,
        confidence: a.assignmentConfidence,
        suggestedBaby:
          perms.viewBaby && a.suggestedBaby ? { id: a.suggestedBaby.id, name: a.suggestedBaby.babyName } : null,
        confirmedBaby:
          perms.viewBaby && a.baby ? { id: a.baby.id, name: a.baby.babyName } : null,
        skipCount: a.skipCount,
      });
      groups.set(key, group);
    }

    res.json({ status, groups: [...groups.values()] });
  }),
);

async function loadAllocation(id: string) {
  const a = await prisma.invoiceItemBabyAllocation.findUnique({
    where: { id },
    include: { invoiceLine: true },
  });
  if (!a) throw notFound('Không tìm thấy dòng phân bổ.');
  return a;
}

// Xác nhận gợi ý (suggested -> confirmed)
const confirmSchema = z.object({ babyId: z.string().optional(), version: z.number().int().optional() });
allocationsRouter.post(
  '/:id/confirm',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu không hợp lệ.');
    const a = await loadAllocation(String(req.params.id));
    const babyId = parsed.data.babyId ?? a.suggestedBabyId;
    if (!babyId) throw badRequest('Không có bé để xác nhận.');
    // 🔴 SEC-FIX-1: bé phải thuộc đúng khách của hóa đơn (chống IDOR gán bé chéo khách).
    await assertBabyBelongsToInvoiceLine(babyId, a.kvInvoiceLineId);
    await applyConfirm(a.id, babyId, req.auth!.userId, a.assignmentStatus, 'manual', parsed.data.version);
    res.json({ ok: true });
  }),
);

// Gán thủ công một bé
const assignSchema = z.object({ babyId: z.string().min(1), version: z.number().int().optional() });
allocationsRouter.post(
  '/:id/assign',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu bé cần gán.');
    const a = await loadAllocation(String(req.params.id));
    // 🔴 SEC-FIX-1: bé phải thuộc đúng khách của hóa đơn.
    await assertBabyBelongsToInvoiceLine(parsed.data.babyId, a.kvInvoiceLineId);
    await applyConfirm(a.id, parsed.data.babyId, req.auth!.userId, a.assignmentStatus, 'manual', parsed.data.version);
    res.json({ ok: true });
  }),
);

// "Chưa rõ -> cấp khách"
allocationsRouter.post(
  '/:id/skip',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const a = await loadAllocation(String(req.params.id));
    const updated = await prisma.invoiceItemBabyAllocation.update({
      where: { id: a.id },
      data: {
        assignmentStatus: 'customer_level',
        babyId: null,
        suggestedBabyId: null,
        skipCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    res.json({
      ok: true,
      skipCount: updated.skipCount,
      warnAvoidance: updated.skipCount >= cfg.allocation.skipWarnThreshold,
    });
  }),
);

// 🔴 FIX-6: chia số lượng thành NHIỀU allocation row / 1 dòng hóa đơn — KHÔNG rơi mất phần dư.
// Chấp nhận 2 dạng payload (KHÔNG sửa client):
//  - segments: [{ babyId|null, assignedQuantity }]  (dạng đầy đủ, nhiều bé)
//  - babyId + babyQuantity                          (dạng cũ: 1 bé + phần còn lại tự thành cấp khách)
// Bất biến: Σ assignedQuantity mọi row của dòng == số lượng dòng hàng, nếu không => 400 (không lưu).
const splitSegmentSchema = z.object({
  babyId: z.string().min(1).nullable(),
  assignedQuantity: z.number().positive(),
});
const splitSchema = z.object({
  segments: z.array(splitSegmentSchema).min(1).optional(),
  babyId: z.string().min(1).optional(),
  babyQuantity: z.number().positive().optional(),
  version: z.number().int().optional(),
});
allocationsRouter.post(
  '/:id/split',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = splitSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu chia số lượng không hợp lệ.');
    const a = await loadAllocation(String(req.params.id));
    const lineQty = Number(a.invoiceLine.quantity);

    // Dựng danh sách phần chia từ payload.
    let segments: SplitSegment[];
    if (parsed.data.segments && parsed.data.segments.length > 0) {
      segments = parsed.data.segments;
    } else if (parsed.data.babyId && parsed.data.babyQuantity != null) {
      if (parsed.data.babyQuantity > lineQty)
        throw badRequest('Số lượng gắn bé vượt số lượng dòng hàng.');
      segments = [{ babyId: parsed.data.babyId, assignedQuantity: parsed.data.babyQuantity }];
      const remainder = Math.round((lineQty - parsed.data.babyQuantity) * 100) / 100;
      // 🔴 Phần dư KHÔNG mất — thành 1 row cấp khách.
      if (remainder > 0) segments.push({ babyId: null, assignedQuantity: remainder });
    } else {
      throw badRequest('Thiếu dữ liệu chia số lượng (segments hoặc babyId+babyQuantity).');
    }

    // 🔴 Bất biến tổng SL — chưa đủ thì TỪ CHỐI, không lưu (không âm thầm rơi SL).
    const check = validateSplitSegments(lineQty, segments);
    if (!check.ok) throw badRequest(check.error!);

    // 🔴 SEC-FIX-1: MỌI bé trong phần chia phải thuộc đúng khách của hóa đơn (chống IDOR).
    for (const seg of segments) {
      if (seg.babyId) await assertBabyBelongsToInvoiceLine(seg.babyId, a.kvInvoiceLineId);
    }

    const siblings = await prisma.invoiceItemBabyAllocation.findMany({
      where: { kvInvoiceLineId: a.kvInvoiceLineId },
      orderBy: { createdAt: 'asc' },
    });
    // Tránh làm rơi row đang có: chỉ cho phép giữ nguyên/ tăng số row (MVP an toàn).
    if (segments.length < siblings.length) {
      throw badRequest(
        'Không thể giảm số phần chia của dòng đang có nhiều bản ghi (đặt lại phân bổ trước).',
      );
    }

    const userId = req.auth!.userId;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // FIX-8: khóa lạc quan trên row được thao tác.
      if (parsed.data.version != null) {
        const locked = await tx.invoiceItemBabyAllocation.updateMany({
          where: { id: a.id, version: parsed.data.version },
          data: { version: { increment: 1 } },
        });
        if (locked.count === 0) throw conflict(STALE_VERSION_MSG);
      }
      // Gán từng phần: tái dùng các row hiện có, tạo thêm nếu cần.
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const segData = seg.babyId
          ? {
              babyId: seg.babyId,
              suggestedBabyId: null,
              assignmentStatus: 'confirmed' as const,
              assignmentConfidence: 'high' as const,
              assignmentSource: 'manual' as const,
              assignedQuantity: seg.assignedQuantity,
              confirmedBy: userId,
              confirmedAt: now,
            }
          : {
              babyId: null,
              suggestedBabyId: null,
              assignmentStatus: 'customer_level' as const,
              assignmentConfidence: 'low' as const,
              assignmentSource: 'manual' as const,
              assignedQuantity: seg.assignedQuantity,
              confirmedBy: userId,
              confirmedAt: now,
            };
        const existing = siblings[i];
        if (existing) {
          await tx.invoiceItemBabyAllocation.update({
            where: { id: existing.id },
            data: { ...segData, version: { increment: 1 } },
          });
        } else {
          await tx.invoiceItemBabyAllocation.create({
            data: {
              kvInvoiceLineId: a.kvInvoiceLineId,
              consumptionStartDate: a.consumptionStartDate,
              ...segData,
            },
          });
        }
      }
      await tx.allocationHistory.create({
        data: {
          allocationId: a.id,
          oldValue: { assignedQuantity: Number(a.assignedQuantity) },
          newValue: { split: segments.map((s) => ({ babyId: s.babyId, qty: s.assignedQuantity })) },
          changedBy: userId,
          reason: 'Chia số lượng cho nhiều bé',
        },
      });
    });

    res.json({ ok: true, segments: segments.length, total: check.total });
  }),
);

// Preview áp hàng loạt (NGHIÊM NGẶT §6.5)
const bulkSchema = z.object({ allocationIds: z.array(z.string()).min(1), babyId: z.string().optional() });
allocationsRouter.post(
  '/bulk-preview',
  asyncHandler(async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Danh sách dòng không hợp lệ.');
    const evalRes = await buildBulkEvaluation(parsed.data.allocationIds);
    res.json(evalRes);
  }),
);

allocationsRouter.post(
  '/bulk-apply',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Danh sách dòng không hợp lệ.');
    const evalRes = await buildBulkEvaluation(parsed.data.allocationIds);
    let applied = 0;
    for (const lineId of evalRes.eligibleLineIds) {
      const a = await prisma.invoiceItemBabyAllocation.findUnique({ where: { id: lineId } });
      const babyId = parsed.data.babyId ?? a?.suggestedBabyId;
      if (!a || !babyId) continue;
      // 🔴 SEC-FIX-1: chặn IDOR cả khi áp hàng loạt — bé phải thuộc khách của từng hóa đơn.
      await assertBabyBelongsToInvoiceLine(babyId, a.kvInvoiceLineId);
      await applyConfirm(a.id, babyId, req.auth!.userId, a.assignmentStatus, 'manual');
      applied++;
    }
    await writeAudit({
      userId: req.auth!.userId,
      action: 'allocation.bulk_apply',
      objectType: 'allocation',
      newValue: { applied, rejected: evalRes.rejected.length },
    });
    res.json({ applied, rejected: evalRes.rejected });
  }),
);

async function buildBulkEvaluation(allocationIds: string[]) {
  const allocations = await prisma.invoiceItemBabyAllocation.findMany({
    where: { id: { in: allocationIds } },
    include: { invoiceLine: { include: { invoice: true, product: { include: { crmMeta: true } } } } },
  });
  const lines: BulkLine[] = allocations.map((a) => ({
    lineId: a.id,
    customerId: a.invoiceLine.invoice.kvCustomerId ?? 'unknown',
    invoiceId: a.invoiceLine.kvInvoiceId,
    assignmentStatus: a.assignmentStatus,
    suggestedBabyId: a.suggestedBabyId,
    confidence: a.assignmentConfidence,
    babyAssignmentMode: a.invoiceLine.product.crmMeta?.babyAssignmentMode ?? 'multi_audience',
    isSplitAcrossBabies: false,
  }));
  return evaluateBulkApply(lines);
}

async function applyConfirm(
  allocationId: string,
  babyId: string,
  userId: string,
  oldStatus: string,
  source: 'manual',
  expectedVersion?: number,
) {
  // FIX-8: nếu client gửi version => khóa lạc quan (updateMany where {id, version}); count 0 => 409.
  const data = {
    babyId,
    suggestedBabyId: null,
    assignmentStatus: 'confirmed' as const,
    assignmentConfidence: 'high' as const,
    assignmentSource: source,
    confirmedBy: userId,
    confirmedAt: new Date(),
    version: { increment: 1 },
  };
  if (expectedVersion != null) {
    const locked = await prisma.invoiceItemBabyAllocation.updateMany({
      where: { id: allocationId, version: expectedVersion },
      data,
    });
    if (locked.count === 0) throw conflict(STALE_VERSION_MSG);
  } else {
    await prisma.invoiceItemBabyAllocation.update({ where: { id: allocationId }, data });
  }
  await prisma.allocationHistory.create({
    data: {
      allocationId,
      oldValue: { assignmentStatus: oldStatus },
      newValue: { assignmentStatus: 'confirmed', babyId },
      changedBy: userId,
    },
  });
  // Đồng bộ reminder_source liên quan để nhắc được nêu tên bé.
  await prisma.reminderSource.updateMany({
    where: { lines: { some: { allocationId } } },
    data: { babyId, babyKey: babyId, assignmentStatus: 'confirmed', confidenceLevel: 'high' },
  });
}
