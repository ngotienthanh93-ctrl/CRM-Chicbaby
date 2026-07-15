import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { maskPhone } from '../../security/masking';
import { serializeBaby, serializeCustomerSummary, serializeFollowUpContent } from '../../security/serialize';
import { formatVnDate } from '../../lib/datetime';
import { normalizePhone } from '../../lib/phone';
import { normalizeFacebook, normalizeZalo, socialLinksSchema } from './socialLinks';

// Re-export để test cũ (socialLinks.schema.test.ts) import from './customers.router' vẫn chạy.
export { socialLinksSchema };

export const customersRouter = Router();
customersRouter.use(requireAuth);

// 🔴 BẤT BIẾN #6 (chống IDOR): user KHÔNG có viewOrganization không được mở chi tiết khách sỉ.
// Áp cho MỌI route con của /:id (detail, babies, consultations, purchases, followups, consents,
// social-links, reveal-phone). `router.use('/:id', ...)` KHÔNG khớp GET '/' (path '/'), nên list vẫn chạy.
// Đứng SAU requireAuth ⇒ req.permissions đã có. Ném 404 (KHÔNG lộ tồn tại khách sỉ).
customersRouter.use(
  '/:id',
  asyncHandler(async (req, _res, next) => {
    const perms = req.permissions!;
    if (perms.viewOrganization) return next();
    // Nạp bất kể deletedAt để chặn cả khách sỉ ĐÃ soft-delete (sub-route con đọc thẳng bảng con theo customerId).
    const c = await prisma.customerCrm.findUnique({
      where: { id: String(req.params.id) },
      select: { deletedAt: true, roles: { select: { role: true } } },
    });
    // Khách không tồn tại / đã xóa ⇒ 404 (đồng nhất loadCustomer), tránh sub-route trả dữ liệu khách đã xóa.
    if (!c || c.deletedAt) throw notFound('Không tìm thấy khách hàng.');
    if (c.roles.some((r) => r.role === 'wholesale_contact')) {
      throw notFound('Không tìm thấy khách hàng.');
    }
    next();
  }),
);

const listQuery = z.object({
  search: z.string().optional(),
  role: z.enum(['retail_customer', 'wholesale_contact']).optional(),
  hasBaby: z.enum(['true', 'false']).optional(),
  tag: z.string().optional(),
  take: z.coerce.number().min(1).max(200).default(50),
});

// Ngưỡng pg_trgm coi là "gần giống" (chịu lỗi gõ). Mặc định pg_trgm là 0.3.
const TRGM_THRESHOLD = 0.3;
// Kích thước mỗi trang candidate raw SQL. Lọc RBAC ở Prisma theo TỪNG TRANG rồi gom tới khi đủ `take`,
// nên kết quả hợp lệ KHÔNG bị rơi dù nhiều candidate đầu bị RBAC loại (tránh bug "cap trước khi lọc").
const CANDIDATE_PAGE = 300;

// Include dùng chung cho list khách (đủ để serializeCustomerSummary).
const customerListInclude = {
  phones: true,
  roles: true,
  _count: { select: { babies: true, externalIdentities: true } },
} satisfies Prisma.CustomerCrmInclude;

/**
 * Bước 1 của tìm kiếm: trả 1 TRANG candidate {id, score} bằng raw SQL (parameterized — CHỐNG SQL injection).
 * - Tên: không dấu (immutable_unaccent) + LIKE chứa + fuzzy bằng toán tử `%` của pg_trgm (DÙNG index GIN).
 * - SĐT một phần: chỉ khi `phoneDigits` != null (gọi đã kiểm SEC-07/viewSensitive ở ngoài).
 * KHÔNG lặp RBAC ở đây — RBAC/ẩn khách sỉ áp ở bước 2 (findMany). ORDER BY score,id để phân trang ổn định.
 * Bọc transaction để `SET LOCAL` ngưỡng cho toán tử `%` (nếu không, `%` dùng ngưỡng session mặc định).
 */
async function findSearchCandidates(
  term: string,
  phoneDigits: string | null,
  limit: number,
  offset: number,
): Promise<Array<{ id: string; score: number }>> {
  // Điều kiện + điểm khớp SĐT (chỉ khi được phép tìm SĐT). Dùng Prisma.empty/sql để ghép an toàn.
  const phoneWhere = phoneDigits
    ? Prisma.sql`OR EXISTS (SELECT 1 FROM customer_phones cp WHERE cp."customerId" = customers_crm.id AND cp."phoneNormalized" LIKE '%' || ${phoneDigits} || '%')`
    : Prisma.empty;
  const phoneScore = phoneDigits
    ? Prisma.sql`CASE WHEN EXISTS (SELECT 1 FROM customer_phones cp WHERE cp."customerId" = customers_crm.id AND cp."phoneNormalized" LIKE '%' || ${phoneDigits} || '%') THEN 0.95 ELSE 0 END`
    : Prisma.sql`0`;

  return prisma.$transaction(async (tx) => {
    // Đặt ngưỡng cho toán tử `%` (pg_trgm) trong transaction này. set_config(..., is_local=true) = SET LOCAL,
    // nhưng nhận GIÁ TRỊ QUA BIND PARAM (parameterized) — không nội suy chuỗi vào SQL (an toàn dù sau này ngưỡng thành config).
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(TRGM_THRESHOLD)}, true)`,
    );
    return tx.$queryRaw<Array<{ id: string; score: number }>>(Prisma.sql`
      SELECT id, GREATEST(
        -- Ưu tiên: prefix (1.0) > chứa (0.9) > trigram similarity > SĐT khớp (0.95).
        CASE
          WHEN immutable_unaccent(lower("fullName")) LIKE immutable_unaccent(lower(${term})) || '%' THEN 1.0
          WHEN immutable_unaccent(lower("fullName")) LIKE '%' || immutable_unaccent(lower(${term})) || '%' THEN 0.9
          ELSE 0
        END,
        CASE
          WHEN immutable_unaccent(lower(coalesce("displayName", ''))) LIKE immutable_unaccent(lower(${term})) || '%' THEN 1.0
          WHEN immutable_unaccent(lower(coalesce("displayName", ''))) LIKE '%' || immutable_unaccent(lower(${term})) || '%' THEN 0.9
          ELSE 0
        END,
        similarity(immutable_unaccent(lower("fullName")), immutable_unaccent(lower(${term}))),
        similarity(immutable_unaccent(lower(coalesce("displayName", ''))), immutable_unaccent(lower(${term}))),
        ${phoneScore}
      )::float8 AS score
      FROM customers_crm
      WHERE "deletedAt" IS NULL AND (
        immutable_unaccent(lower("fullName")) LIKE '%' || immutable_unaccent(lower(${term})) || '%'
        OR immutable_unaccent(lower(coalesce("displayName", ''))) LIKE '%' || immutable_unaccent(lower(${term})) || '%'
        OR immutable_unaccent(lower("fullName")) % immutable_unaccent(lower(${term}))
        OR immutable_unaccent(lower(coalesce("displayName", ''))) % immutable_unaccent(lower(${term}))
        ${phoneWhere}
      )
      ORDER BY score DESC, id
      LIMIT ${limit} OFFSET ${offset}
    `);
  });
}

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const perms = req.permissions!;
    const search = q.search?.trim();

    // Bộ lọc CẤU TRÚC + RBAC dùng chung cho cả nhánh có/không search.
    const where: Record<string, unknown> = { deletedAt: null };
    // 🔴 BẤT BIẾN #6: user thiếu viewOrganization TUYỆT ĐỐI không thấy khách sỉ (vai wholesale_contact),
    // kể cả khách "cả lẻ+sỉ". Gộp AN TOÀN với filter q.role: some (khớp vai chọn) + none (loại sỉ).
    // Nếu q.role='wholesale_contact' mà thiếu quyền ⇒ some+none mâu thuẫn ⇒ rỗng (đúng: không cho xem sỉ).
    const rolesFilter: Record<string, unknown> = {};
    if (q.role) rolesFilter.some = { role: q.role };
    if (!perms.viewOrganization) rolesFilter.none = { role: 'wholesale_contact' };
    if (Object.keys(rolesFilter).length) where.roles = rolesFilter;
    if (q.hasBaby === 'true') where.babies = { some: { deletedAt: null } };
    if (q.hasBaby === 'false') where.babies = { none: { deletedAt: null } };
    if (q.tag) where.tagAssignments = { some: { tag: q.tag } };

    // Không có search: hành vi cũ (danh sách mới nhất theo filter).
    if (!search) {
      const customers = await prisma.customerCrm.findMany({
        where,
        take: q.take,
        orderBy: { createdAt: 'desc' },
        include: customerListInclude,
      });
      res.json({ items: customers.map((c) => serializeCustomerSummary(c, perms)) });
      return;
    }

    // Có search: tìm tên không dấu + fuzzy, và SĐT một phần (≥3 chữ số).
    const digits = normalizePhone(search);
    // phoneLike: chuỗi chỉ gồm ký tự số/điện thoại VÀ có ≥3 chữ số ⇒ coi là ý định tìm SĐT.
    const phoneLike = /^[\d\s.+()\-]+$/.test(search) && digits.length >= 3;

    // 🔴 SEC-07: vai KHÔNG viewSensitive tìm theo SĐT ⇒ KHÔNG trả kết quả (không query).
    if (phoneLike && !perms.viewSensitive) {
      res.json({ items: [], note: 'Không có quyền tìm theo số điện thoại.' });
      return;
    }

    const phoneDigits = phoneLike ? digits : null;

    // Phân trang candidate: mỗi trang lọc RBAC ở Prisma rồi gom, tới khi đủ `take` hoặc hết candidate.
    // 🔴 Phòng thủ nhiều lớp + BẤT BIẾN #6: RBAC/ẩn khách sỉ (`roles.none wholesale`) áp Ở BƯỚC PRISMA này;
    // vì lọc theo TỪNG TRANG (không cap trước RBAC), kết quả hợp lệ không bị rơi dù candidate đầu bị loại.
    const items: ReturnType<typeof serializeCustomerSummary>[] = [];
    const seen = new Set<string>();
    for (let offset = 0; items.length < q.take; offset += CANDIDATE_PAGE) {
      const page = await findSearchCandidates(search, phoneDigits, CANDIDATE_PAGE, offset);
      if (page.length === 0) break;
      const scoreById = new Map(page.map((c) => [c.id, c.score]));
      const rows = await prisma.customerCrm.findMany({
        where: { ...where, id: { in: page.map((c) => c.id) } },
        include: customerListInclude,
      });
      // Sắp xếp trong trang theo score (findMany không giữ thứ tự); score toàn cục đã theo trang.
      rows.sort((a, b) => (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0));
      for (const c of rows) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        items.push(serializeCustomerSummary(c, perms));
      }
      if (page.length < CANDIDATE_PAGE) break; // trang cuối ⇒ hết candidate
    }
    res.json({ items: items.slice(0, q.take) });
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
      // FB/Zalo là dữ liệu CRM-owned, hiển thị cho MỌI vai xem được hồ sơ (KHÔNG gate viewSensitive).
      facebook: c.facebook,
      zalo: c.zalo,
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

// 🔴 Ghi FB/Zalo cần manageCustomer (BẤT BIẾN #6): vai thiếu quyền => 403 tại server, không chỉ ẩn ở UI.
customersRouter.put(
  '/:id/social-links',
  requirePermission('manageCustomer'),
  asyncHandler(async (req, res) => {
    const parsed = socialLinksSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu kênh liên hệ không hợp lệ.');

    const c = await loadCustomer(String(req.params.id));

    // Chỉ đụng field được gửi lên; chuẩn hóa + kiểm tra XSS/host ở SERVER (ném 400 nếu link sai).
    const data: { facebook?: string | null; zalo?: string | null } = {};
    if (parsed.data.facebook !== undefined) data.facebook = normalizeFacebook(parsed.data.facebook);
    if (parsed.data.zalo !== undefined) data.zalo = normalizeZalo(parsed.data.zalo);
    if (Object.keys(data).length === 0) throw badRequest('Không có kênh liên hệ nào để cập nhật.');

    const updated = await prisma.customerCrm.update({ where: { id: c.id }, data });

    await writeAudit({
      userId: req.auth!.userId,
      action: 'customer.update_social_links',
      objectType: 'customer',
      objectId: c.id,
      oldValue: { facebook: c.facebook, zalo: c.zalo },
      newValue: { facebook: updated.facebook, zalo: updated.zalo },
      ip: req.ip,
    });

    res.json({ ok: true, facebook: updated.facebook, zalo: updated.zalo });
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

// Tab tư vấn — ẩn toàn bộ nếu không có quyền (CON-09). Bổ sung §11.2: babyId, SP tư vấn, "đã sửa N lần".
customersRouter.get(
  '/:id/consultations',
  requirePermission('viewConsultation'),
  asyncHandler(async (req, res) => {
    const items = await prisma.consultation.findMany({
      where: { customerId: String(req.params.id), deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { advisedProducts: true, _count: { select: { versions: true } } },
    });
    res.json({
      items: items.map((c) => ({
        id: c.id,
        babyId: c.babyId,
        issue: c.issue,
        temperature: c.temperature,
        result: c.result,
        reasonNoBuy: c.reasonNoBuy,
        advisedProductIds: c.advisedProducts.map((p) => p.kvProductId),
        nextContactDate: c.nextContactDate ? formatVnDate(c.nextContactDate) : null,
        note: c.note,
        version: c.version, // 🔴 FIX-3: client cần version để gửi khóa lạc quan khi sửa
        editedCount: c._count.versions, // CON-03: "đã sửa N lần"
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

    // 🔴 Ảnh bằng chứng CHỈ cho vai xử lý việc (processWork). Marketing => attachments: [] (KHÔNG query).
    // Query riêng, KHÔNG select `data` (bytes nặng); chỉ metadata + URL stream.
    type AttMeta = { id: string; url: string; uploadedByName: string | null; createdAt: string };
    const attByFollowUp = new Map<string, AttMeta[]>();
    if (perms.processWork && items.length > 0) {
      const atts = await prisma.followUpAttachment.findMany({
        where: { followUpId: { in: items.map((f) => f.id) }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, followUpId: true, uploadedBy: true, createdAt: true },
      });
      const uploaderIds = [...new Set(atts.map((a) => a.uploadedBy))];
      const uploaderNames =
        uploaderIds.length > 0
          ? new Map(
              (
                await prisma.user.findMany({
                  where: { id: { in: uploaderIds } },
                  select: { id: true, fullName: true },
                })
              ).map((u) => [u.id, u.fullName]),
            )
          : new Map<string, string>();
      for (const a of atts) {
        const list = attByFollowUp.get(a.followUpId) ?? [];
        list.push({
          id: a.id,
          url: `/api/followups/${a.followUpId}/attachments/${a.id}/file`,
          uploadedByName: uploaderNames.get(a.uploadedBy) ?? null,
          createdAt: formatVnDate(a.createdAt),
        });
        attByFollowUp.set(a.followUpId, list);
      }
    }

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
        attachments: attByFollowUp.get(f.id) ?? [],
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
