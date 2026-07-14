import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { assertBabyBelongsToInvoiceLine, resolveCustomerIdFromInvoiceLine } from '../../security/ownership';
import { assertCustomerVisible } from '../../security/customerVisibility';
import type { Permissions } from '../../security/permissions';
import type { Prisma } from '@prisma/client';
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

// 🔴 BẤT BIẾN #6 (ISSUE-2): allocation coi là "của KHÁCH SỈ" nếu bé ĐÃ xác nhận (baby) HOẶC bé GỢI Ý
// (suggestedBaby) thuộc khách có vai wholesale_contact — chặn kể cả khi KV identity của hóa đơn
// thiếu/unlink/stale (không suy được khách qua đường KV). Dùng lại ở list + assert + bulk filter.
const BABY_WHOLESALE_OR: Prisma.InvoiceItemBabyAllocationWhereInput[] = [
  { baby: { is: { customer: { is: { roles: { some: { role: 'wholesale_contact' } } } } } } },
  { suggestedBaby: { is: { customer: { is: { roles: { some: { role: 'wholesale_contact' } } } } } } },
];

/**
 * Predicate Prisma loại allocation có bé (xác nhận/gợi ý) thuộc KHÁCH SỈ khi thiếu viewOrganization.
 * viewOrganization=true ⇒ {} (không lọc — chu_shop vô hại). Áp vào where của findMany TRƯỚC take
 * để không cắt cụt danh sách trước khi lọc (ISSUE-3) và bịt kẽ KV identity thiếu/stale (ISSUE-2).
 */
export function allocationBabyWholesaleWhere(
  perms: Pick<Permissions, 'viewOrganization'>,
): Prisma.InvoiceItemBabyAllocationWhereInput {
  return perms.viewOrganization ? {} : { NOT: { OR: BABY_WHOLESALE_OR } };
}

type AllocationForList = Prisma.InvoiceItemBabyAllocationGetPayload<{
  include: {
    invoiceLine: { include: { invoice: true; product: true } };
    suggestedBaby: true;
    baby: true;
  };
}>;

/**
 * 🔴 ISSUE-3: nạp allocation hiển-thị-được, tránh trả rỗng/cụt oan.
 * Phần lọc "sở hữu bé" (khách sỉ) đã ở trong `baseWhere` (Prisma, TRƯỚC take). Phần lọc theo KV-identity
 * (khách sỉ có mã KV) KHÔNG biểu diễn được bằng Prisma relation (kv_* là mirror, không FK sang customer)
 * ⇒ vẫn phải lọc in-memory. Khi có KV cần ẩn, nạp theo TRANG (cursor) tới khi đủ `limit` dòng hiển-thị-được.
 * Trần MAX_SCAN chống quét vô hạn; chạm trần ⇒ trả phần đã gom (giới hạn hiếm: >MAX_SCAN dòng đầu đều khách sỉ).
 */
async function fetchDisplayableAllocations(
  baseWhere: Prisma.InvoiceItemBabyAllocationWhereInput,
  hiddenKvCustomerIds: Set<string>,
  limit: number,
): Promise<AllocationForList[]> {
  const include = {
    invoiceLine: { include: { invoice: true, product: true } },
    suggestedBaby: true,
    baby: true,
  } satisfies Prisma.InvoiceItemBabyAllocationInclude;
  // Tiebreaker id ⇒ total-order ổn định cho cursor (createdAt có thể trùng).
  const orderBy: Prisma.InvoiceItemBabyAllocationOrderByWithRelationInput[] = [
    { createdAt: 'desc' },
    { id: 'desc' },
  ];

  // Không phải lọc KV in-memory (thường gặp: có viewOrganization, hoặc không có khách sỉ mã KV) ⇒ nạp thẳng.
  if (hiddenKvCustomerIds.size === 0) {
    return prisma.invoiceItemBabyAllocation.findMany({ where: baseWhere, include, orderBy, take: limit });
  }

  const MAX_SCAN = limit * 10; // trần an toàn ~3000 dòng quét
  const kept: AllocationForList[] = [];
  let cursorId: string | undefined;
  let scanned = 0;
  while (kept.length < limit && scanned < MAX_SCAN) {
    const page = await prisma.invoiceItemBabyAllocation.findMany({
      where: baseWhere,
      include,
      orderBy,
      take: limit,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });
    if (page.length === 0) break;
    scanned += page.length;
    for (const a of page) {
      const kv = a.invoiceLine.invoice.kvCustomerId ?? '';
      if (hiddenKvCustomerIds.has(kv)) continue; // 🔴 BẤT BIẾN #6: bỏ dòng thuộc khách sỉ theo mã KV
      kept.push(a);
      if (kept.length >= limit) break;
    }
    cursorId = page[page.length - 1]!.id;
    if (page.length < limit) break; // hết dữ liệu
  }
  return kept.slice(0, limit);
}

allocationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = listQuery.parse(req.query);
    const perms = req.permissions!;

    // map kvCustomerId -> crm customer (tên)
    const identities = await prisma.customerExternalIdentity.findMany({
      where: { unlinkedAt: null },
      include: { customer: { include: { roles: true } } },
    });
    const kvToCustomer = new Map<string, { id: string; name: string }>();
    // 🔴 BẤT BIẾN #6: user thiếu viewOrganization KHÔNG thấy phân bổ (kèm gợi ý bé) của KHÁCH SỈ. Tập
    // kvCustomerId của khách sỉ để LOẠI hẳn allocation của họ — tránh lộ dưới nhãn "Khách chưa liên kết".
    const hiddenKvCustomerIds = new Set<string>();
    for (const i of identities) {
      const isWholesale = i.customer.roles.some((r) => r.role === 'wholesale_contact');
      if (!perms.viewOrganization && isWholesale) {
        hiddenKvCustomerIds.add(i.externalCustomerId);
        continue; // không đưa khách sỉ vào map hiển thị
      }
      kvToCustomer.set(i.externalCustomerId, {
        id: i.customerId,
        name: i.customer.displayName ?? i.customer.fullName,
      });
    }

    // 🔴 ISSUE-2 + ISSUE-3: đẩy phần lọc "sở hữu bé" (bé xác nhận/gợi ý thuộc khách sỉ) vào Prisma where
    // TRƯỚC take — vừa bịt kẽ KV identity thiếu/stale, vừa không cắt cụt danh sách trước khi lọc.
    const baseWhere: Prisma.InvoiceItemBabyAllocationWhereInput = {
      assignmentStatus: { in: STATUS_MAP[status] as never[] },
      ...allocationBabyWholesaleWhere(perms),
    };
    const allocations = await fetchDisplayableAllocations(baseWhere, hiddenKvCustomerIds, 300);

    // gom theo khách
    const groups = new Map<
      string,
      { customerId: string | null; customerName: string; lines: unknown[] }
    >();
    for (const a of allocations) {
      const kvCustomerId = a.invoiceLine.invoice.kvCustomerId ?? '';
      // 🔴 BẤT BIẾN #6 (phòng thủ chiều sâu): fetchDisplayableAllocations đã loại dòng khách sỉ theo mã KV;
      // giữ guard này để không bao giờ lộ nhóm khách sỉ dưới nhãn "Khách chưa liên kết" nếu helper đổi.
      if (hiddenKvCustomerIds.has(kvCustomerId)) continue;
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

/**
 * 🔴 BẤT BIẾN #6: chặn thao tác trên dòng phân bổ thuộc KHÁCH SỈ khi user thiếu viewOrganization.
 * Chặn theo BẤT KỲ tín hiệu nào chỉ tới khách sỉ (union 3 đường):
 *  (a) khách suy từ KV identity của hóa đơn (kv_invoice_line → kv_invoice → external identity);
 *  (b) bé ĐÃ xác nhận (baby) thuộc khách sỉ;  (c) bé GỢI Ý (suggestedBaby) thuộc khách sỉ.
 * (b)(c) bịt kẽ ISSUE-2: KV identity thiếu/unlink/stale ⇒ (a) suy khách = null nên KHÔNG bắt được,
 * nhưng con trỏ bé vẫn lộ khách sỉ ⇒ phải chặn. 404 TRUNG TÍNH (khớp loadAllocation) — không lộ tồn tại.
 * viewOrganization=true ⇒ no-op (chu_shop vô hại).
 */
async function assertAllocationVisible(
  allocation: { id: string; kvInvoiceLineId: string },
  perms: Permissions,
): Promise<void> {
  if (perms.viewOrganization) return;
  // (a) đường KV identity
  const customerId = await resolveCustomerIdFromInvoiceLine(allocation.kvInvoiceLineId);
  if (customerId) await assertCustomerVisible(customerId, perms, 'Không tìm thấy dòng phân bổ.');
  // (b)(c) đường sở hữu bé — dùng lại BABY_WHOLESALE_OR để nhất quán với list/bulk filter.
  const wholesaleByBaby = await prisma.invoiceItemBabyAllocation.findFirst({
    where: { id: allocation.id, OR: BABY_WHOLESALE_OR },
    select: { id: true },
  });
  if (wholesaleByBaby) throw notFound('Không tìm thấy dòng phân bổ.');
}

/**
 * 🔴 BẤT BIẾN #6: lọc danh sách allocationId, bỏ dòng thuộc KHÁCH SỈ khi thiếu viewOrganization.
 * Dùng cho bulk-preview/bulk-apply (đầu vào do client gửi) để không lộ/không áp lên dữ liệu khách sỉ.
 * Batched (số truy vấn hằng số) — không N+1.
 */
async function filterVisibleAllocationIds(ids: string[], perms: Permissions): Promise<string[]> {
  if (perms.viewOrganization || ids.length === 0) return ids;
  const rows = await prisma.invoiceItemBabyAllocation.findMany({
    where: { id: { in: ids } },
    select: { id: true, invoiceLine: { select: { invoice: { select: { kvCustomerId: true } } } } },
  });
  const kvIds = [
    ...new Set(rows.map((r) => r.invoiceLine.invoice.kvCustomerId).filter((v): v is string => !!v)),
  ];
  const wholesaleIdentities = kvIds.length
    ? await prisma.customerExternalIdentity.findMany({
        where: {
          externalCustomerId: { in: kvIds },
          unlinkedAt: null,
          customer: { roles: { some: { role: 'wholesale_contact' } } },
        },
        select: { externalCustomerId: true },
      })
    : [];
  const wholesaleKvIds = new Set(wholesaleIdentities.map((i) => i.externalCustomerId));
  const hiddenAllocIds = new Set(
    rows
      .filter((r) => {
        const kv = r.invoiceLine.invoice.kvCustomerId;
        return kv != null && wholesaleKvIds.has(kv);
      })
      .map((r) => r.id),
  );
  // 🔴 ISSUE-2: bổ sung đường sở hữu bé — allocation có bé (xác nhận/gợi ý) thuộc khách sỉ, kể cả khi
  // KV identity thiếu/unlink/stale (đường KV ở trên không bắt được). 1 query batched, không N+1.
  const babyWholesaleRows = await prisma.invoiceItemBabyAllocation.findMany({
    where: { id: { in: ids }, OR: BABY_WHOLESALE_OR },
    select: { id: true },
  });
  for (const r of babyWholesaleRows) hiddenAllocIds.add(r.id);
  return ids.filter((id) => !hiddenAllocIds.has(id));
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
    // 🔴 BẤT BIẾN #6: chặn xác nhận phân bổ của khách sỉ khi thiếu viewOrganization (union 3 tín hiệu).
    await assertAllocationVisible(a, req.permissions!);
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
    // 🔴 BẤT BIẾN #6: chặn gán bé cho phân bổ của khách sỉ khi thiếu viewOrganization (union 3 tín hiệu).
    await assertAllocationVisible(a, req.permissions!);
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
    // 🔴 BẤT BIẾN #6: chặn hạ-cấp-khách phân bổ của khách sỉ khi thiếu viewOrganization (union 3 tín hiệu).
    await assertAllocationVisible(a, req.permissions!);
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
    // 🔴 BẤT BIẾN #6: chặn chia số lượng phân bổ của khách sỉ khi thiếu viewOrganization (union 3 tín hiệu).
    await assertAllocationVisible(a, req.permissions!);
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
    // 🔴 BẤT BIẾN #6: loại dòng thuộc khách sỉ khỏi preview khi thiếu viewOrganization (không lộ gợi ý bé/mã KV).
    const ids = await filterVisibleAllocationIds(parsed.data.allocationIds, req.permissions!);
    const evalRes = await buildBulkEvaluation(ids);
    res.json(evalRes);
  }),
);

allocationsRouter.post(
  '/bulk-apply',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Danh sách dòng không hợp lệ.');
    // 🔴 BẤT BIẾN #6: loại dòng thuộc khách sỉ khỏi tập áp khi thiếu viewOrganization (không áp lên dữ liệu khách sỉ).
    const ids = await filterVisibleAllocationIds(parsed.data.allocationIds, req.permissions!);
    const evalRes = await buildBulkEvaluation(ids);
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
