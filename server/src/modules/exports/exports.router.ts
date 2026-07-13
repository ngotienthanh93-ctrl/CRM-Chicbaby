// 🔴 Export dữ liệu khách/bé CÓ DUYỆT (SEC: "Export dữ liệu khách/bé ⇒ cần DUYỆT + audit").
// Luồng: người có quyền xem dữ liệu ĐỀ XUẤT (pending) → CHỦ SHOP duyệt/từ chối (reauth) → người đề xuất/chủ
// shop TẢI trong hạn (mỗi lần tải GHI AUDIT — SEC-07/08) → chủ shop THU HỒI bất cứ lúc nào. Marketing/trợ lý
// dữ liệu KHÔNG có viewSensitive ⇒ 403 ngay ở tầng server (nguyên tắc #6, không ẩn ở UI).
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import {
  effectiveExportState,
  isExportDownloadable,
  isExportDecidable,
  type ExportRequestSnapshot,
} from '../../engines/exportRequest';

export const exportsRouter = Router();
// 🔴 A01/SEC-06: TOÀN BỘ module export yêu cầu quyền xem dữ liệu nhạy cảm — kể cả list/detail (metadata yêu cầu
// có thể chứa lý do/ngữ cảnh nhạy cảm). Người bị HẠ QUYỀN mất truy cập NGAY (permissions nạp lại mỗi request).
// Marketing/trợ lý dữ liệu ⇒ 403 ở server, không chỉ ẩn UI (nguyên tắc BẤT BIẾN #6).
exportsRouter.use(requireAuth, requirePermission('viewSensitive'));

/** Phạm vi dữ liệu được phép export (allowlist — chặn scope tùy tiện). */
const DATASET_SCOPES = ['customers', 'babies'] as const;
type DatasetScope = (typeof DATASET_SCOPES)[number];

const HOUR_MS = 60 * 60 * 1000;

/** ⚙️ Đọc cấu hình export active (fallback DEFAULT nếu thiếu/hỏng — nguyên tắc #9, không hard-code). */
async function activeExportConfig(): Promise<{ ttlHours: number; maxRows: number }> {
  const rows = await prisma.configurationVersion.findMany({
    where: { key: { in: ['export.approval_ttl_hours', 'export.max_rows'] }, isActive: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const ttlRaw = byKey.get('export.approval_ttl_hours');
  const maxRaw = byKey.get('export.max_rows');
  return {
    ttlHours: Number.isFinite(ttlRaw) ? (ttlRaw as number) : DEFAULT_ENGINE_CONFIG.export.approvalTtlHours,
    maxRows: Number.isFinite(maxRaw) ? (maxRaw as number) : DEFAULT_ENGINE_CONFIG.export.maxRows,
  };
}

type ExportRow = {
  id: string;
  requestedBy: string;
  datasetScope: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy: string | null;
  expiresAt: Date | null;
  downloadCount: number;
  revokedAt: Date | null;
  createdAt: Date;
};

/** DTO cho client — kèm trạng thái HIỆU LỰC (tính động expiry/revoke) để UI hiển thị đúng. */
function serialize(r: ExportRow, now: Date) {
  const snap: ExportRequestSnapshot = { status: r.status, expiresAt: r.expiresAt, revokedAt: r.revokedAt };
  return {
    id: r.id,
    requestedBy: r.requestedBy,
    datasetScope: r.datasetScope,
    reason: r.reason,
    status: r.status,
    effectiveState: effectiveExportState(snap, now),
    approvedBy: r.approvedBy,
    expiresAt: r.expiresAt,
    downloadCount: r.downloadCount,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
    downloadable: isExportDownloadable(snap, now),
  };
}

/** Chỉ chủ shop (approveExport) thấy MỌI yêu cầu; người khác chỉ thấy yêu cầu của MÌNH. */
function canSeeAll(perms: { approveExport: boolean }): boolean {
  return perms.approveExport === true;
}

// 🔴 A09: cap độ dài lý do (free-text) — chống nhồi dữ liệu lớn/nhạy cảm vào audit append-only. Lý do vẫn được
// ghi audit để truy vết (chủ ý, đồng nhất với reason đổi cấu hình/gộp khách toàn app); cap chỉ giới hạn phạm vi.
const REASON_MAX = 500;
const reauthSchema = z.object({ password: z.string().min(1) });
// 🔴 A01/CWE-639: export CHỦ Ý là "toàn bộ dữ liệu theo phạm vi" (không nhận filter) — duyệt = duyệt full-dataset,
// KHÔNG để yêu cầu "khung hẹp" rồi tải ra toàn bộ. Nếu sau này cần lọc: thêm schema filter allowlist + áp vào buildDataset.
const createSchema = z.object({
  datasetScope: z.enum(DATASET_SCOPES),
  reason: z.string().trim().min(1, 'Bắt buộc nhập lý do export.').max(REASON_MAX),
});

// ============================================================
// POST /api/exports — ĐỀ XUẤT export. Cần quyền xem dữ liệu nhạy cảm (marketing/trợ lý dữ liệu ⇒ 403).
// ============================================================
exportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu không hợp lệ: cần phạm vi dữ liệu và lý do (≤ 500 ký tự).');
    const created = await prisma.exportRequest.create({
      data: {
        requestedBy: req.auth!.userId,
        datasetScope: parsed.data.datasetScope,
        reason: parsed.data.reason,
        status: 'pending',
      },
    });
    // 🔴 SEC-10/12: KHÔNG chép reason (free-text) vào audit — reason đã nằm ở bảng export_requests (đã gate
    // viewSensitive), truy được qua objectId. Audit append-only chỉ ghi ai/hành động/đối tượng.
    await writeAudit({
      userId: req.auth!.userId,
      action: 'export.request',
      objectType: 'export_request',
      objectId: created.id,
      newValue: { datasetScope: created.datasetScope },
    });
    res.status(201).json(serialize(created, new Date()));
  }),
);

// ============================================================
// GET /api/exports — danh sách (chủ shop: tất cả; người khác: của mình).
// ============================================================
exportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const where: Prisma.ExportRequestWhereInput = canSeeAll(req.permissions!)
      ? {}
      : { requestedBy: req.auth!.userId };
    // 🔴 CWE-400: cap cứng số bản ghi trả về (mới nhất trước) — chống bảng phình làm truy vấn/response nặng.
    const items = await prisma.exportRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ items: items.map((r) => serialize(r, now)) });
  }),
);

/** Nạp 1 yêu cầu + kiểm quyền xem (chủ shop hoặc chính người đề xuất). 404 nếu không có/không được xem. */
async function loadAuthorized(
  id: string,
  req: { auth: { userId: string }; permissions: { approveExport: boolean } },
): Promise<ExportRow> {
  const r = await prisma.exportRequest.findUnique({ where: { id } });
  if (!r) throw notFound('Không tìm thấy yêu cầu export.');
  if (!canSeeAll(req.permissions) && r.requestedBy !== req.auth.userId) {
    // Không lộ sự tồn tại của yêu cầu người khác.
    throw notFound('Không tìm thấy yêu cầu export.');
  }
  return r;
}

// ============================================================
// GET /api/exports/:id — chi tiết (chủ shop hoặc người đề xuất).
// ============================================================
exportsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const r = await loadAuthorized(String(req.params.id), {
      auth: { userId: req.auth!.userId },
      permissions: { approveExport: req.permissions!.approveExport },
    });
    res.json(serialize(r, new Date()));
  }),
);

// ============================================================
// POST /api/exports/:id/approve — CHỈ chủ shop + reauth. Đặt hạn tải = now + TTL (⚙️).
// ============================================================
exportsRouter.post(
  '/:id/approve',
  requirePermission('approveExport'),
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    const id = String(req.params.id);
    const now = new Date();
    const existing = await prisma.exportRequest.findUnique({ where: { id } });
    if (!existing) throw notFound('Không tìm thấy yêu cầu export.');
    if (!isExportDecidable({ status: existing.status, expiresAt: existing.expiresAt, revokedAt: existing.revokedAt }, now)) {
      throw conflict('Yêu cầu này không còn ở trạng thái chờ duyệt.');
    }
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    const { ttlHours } = await activeExportConfig();
    const expiresAt = new Date(now.getTime() + ttlHours * HOUR_MS);
    // 🔴 TOCTOU + audit atomic: conditional update LÀM CỔNG (chỉ duyệt khi VẪN pending & chưa thu hồi) +
    // writeAudit trong CÙNG transaction ⇒ hai chủ shop duyệt song song thì chỉ một thắng; audit không thể lệch.
    const updated = await prisma.$transaction(async (tx) => {
      const gate = await tx.exportRequest.updateMany({
        where: { id, status: 'pending', revokedAt: null },
        data: { status: 'approved', approvedBy: req.auth!.userId, expiresAt },
      });
      if (gate.count !== 1) throw conflict('Yêu cầu này không còn ở trạng thái chờ duyệt.');
      await writeAudit(
        { userId: req.auth!.userId, action: 'export.approve', objectType: 'export_request', objectId: id, newValue: { expiresAt, ttlHours } },
        tx,
      );
      return tx.exportRequest.findUniqueOrThrow({ where: { id } });
    });
    res.json(serialize(updated, now));
  }),
);

// ============================================================
// POST /api/exports/:id/reject — CHỈ chủ shop + reauth.
// ============================================================
exportsRouter.post(
  '/:id/reject',
  requirePermission('approveExport'),
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    const id = String(req.params.id);
    const now = new Date();
    const existing = await prisma.exportRequest.findUnique({ where: { id } });
    if (!existing) throw notFound('Không tìm thấy yêu cầu export.');
    if (!isExportDecidable({ status: existing.status, expiresAt: existing.expiresAt, revokedAt: existing.revokedAt }, now)) {
      throw conflict('Yêu cầu này không còn ở trạng thái chờ duyệt.');
    }
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    // 🔴 Conditional update làm cổng + audit atomic (như approve). Audit KHÔNG lưu free-text (SEC-10/12).
    const updated = await prisma.$transaction(async (tx) => {
      const gate = await tx.exportRequest.updateMany({
        where: { id, status: 'pending', revokedAt: null },
        data: { status: 'rejected' },
      });
      if (gate.count !== 1) throw conflict('Yêu cầu này không còn ở trạng thái chờ duyệt.');
      await writeAudit(
        { userId: req.auth!.userId, action: 'export.reject', objectType: 'export_request', objectId: id },
        tx,
      );
      return tx.exportRequest.findUniqueOrThrow({ where: { id } });
    });
    res.json(serialize(updated, now));
  }),
);

// ============================================================
// POST /api/exports/:id/revoke — CHỈ chủ shop + reauth. Cắt quyền tải NGAY (kể cả còn hạn).
// ============================================================
exportsRouter.post(
  '/:id/revoke',
  requirePermission('approveExport'),
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    const id = String(req.params.id);
    const now = new Date();
    const existing = await prisma.exportRequest.findUnique({ where: { id } });
    if (!existing) throw notFound('Không tìm thấy yêu cầu export.');
    if (existing.revokedAt) throw conflict('Yêu cầu này đã bị thu hồi trước đó.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    // 🔴 Conditional update làm cổng (chỉ thu hồi khi CHƯA thu hồi) + audit atomic. Idempotent-safe.
    const updated = await prisma.$transaction(async (tx) => {
      const gate = await tx.exportRequest.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (gate.count !== 1) throw conflict('Yêu cầu này đã bị thu hồi trước đó.');
      await writeAudit(
        { userId: req.auth!.userId, action: 'export.revoke', objectType: 'export_request', objectId: id },
        tx,
      );
      return tx.exportRequest.findUniqueOrThrow({ where: { id } });
    });
    res.json(serialize(updated, now));
  }),
);

/** Sinh dữ liệu theo phạm vi (đã duyệt ⇒ dữ liệu ĐẦY ĐỦ; soft-delete loại; giới hạn maxRows). */
async function buildDataset(scope: DatasetScope, maxRows: number): Promise<Record<string, unknown>[]> {
  if (scope === 'customers') {
    const rows = await prisma.customerCrm.findMany({
      where: { deletedAt: null },
      include: { phones: true },
      orderBy: { createdAt: 'asc' },
      take: maxRows,
    });
    return rows.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      displayName: c.displayName,
      phones: c.phones.map((p) => p.phoneRaw),
      facebook: c.facebook,
      zalo: c.zalo,
      careAddress: c.careAddress,
      retentionStatus: c.retentionStatus,
      createdAt: c.createdAt,
    }));
  }
  // babies
  const rows = await prisma.babyProfile.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: maxRows,
  });
  return rows.map((b) => ({
    id: b.id,
    customerId: b.customerId,
    babyName: b.babyName,
    birthDate: b.birthDate,
    estimatedBirthMonth: b.estimatedBirthMonth,
    gender: b.gender,
    allergies: b.allergies,
    condition: b.condition,
    note: b.note,
    createdAt: b.createdAt,
  }));
}

// ============================================================
// GET /api/exports/:id/download — TẢI (người đề xuất/chủ shop). Chỉ khi ĐÃ DUYỆT & còn hạn & chưa thu hồi.
// 🔴 Mỗi lần tải: GHI AUDIT (SEC-07/08) + tăng downloadCount. Người tải phải CÒN quyền xem dữ liệu nhạy cảm.
// ============================================================
exportsRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const perms = req.permissions!;
    // Quyền xem dữ liệu nhạy cảm đã được gate ở router-level (viewSensitive) — hạ quyền là bị chặn ngay.
    const r = await loadAuthorized(String(req.params.id), {
      auth: { userId: req.auth!.userId },
      permissions: { approveExport: perms.approveExport },
    });
    const snap: ExportRequestSnapshot = { status: r.status, expiresAt: r.expiresAt, revokedAt: r.revokedAt };
    if (!isExportDownloadable(snap, now)) {
      // Kiểm nhanh cho UX; cổng THẬT là conditional update bên dưới (chống race thu hồi/hết hạn giữa chừng).
      throw conflict(`Không tải được — trạng thái hiện tại: ${effectiveExportState(snap, now)}.`);
    }

    const { maxRows } = await activeExportConfig();
    // Đọc dữ liệu (thuần đọc, chưa có tác dụng phụ) TRƯỚC; nếu race thu hồi xảy ra, cổng dưới chặn → không trả.
    const rows = await buildDataset(r.datasetScope as DatasetScope, maxRows);
    // 🔴 TOCTOU + audit atomic: CHỈ tăng downloadCount khi VẪN approved & chưa thu hồi & còn hạn (conditional),
    // + writeAudit trong CÙNG transaction. Revoke chen giữa lúc tải ⇒ cổng count=0 ⇒ KHÔNG trả dữ liệu nhạy cảm.
    await prisma.$transaction(async (tx) => {
      const gate = await tx.exportRequest.updateMany({
        where: { id: r.id, status: 'approved', revokedAt: null, expiresAt: { gt: now } },
        data: { downloadCount: { increment: 1 } },
      });
      if (gate.count !== 1) {
        throw conflict('Không tải được — yêu cầu vừa đổi trạng thái (thu hồi/hết hạn). Vui lòng tải lại.');
      }
      await writeAudit(
        { userId: req.auth!.userId, action: 'export.download', objectType: 'export_request', objectId: r.id, newValue: { datasetScope: r.datasetScope, rowCount: rows.length } },
        tx,
      );
    });
    res.json({
      exportId: r.id,
      datasetScope: r.datasetScope,
      generatedAt: now,
      rowCount: rows.length,
      capped: rows.length >= maxRows,
      rows,
    });
  }),
);
