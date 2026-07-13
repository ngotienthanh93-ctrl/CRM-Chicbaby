// SCR-12 Đồng bộ KiotViet (§11.4 — SYNC-22..26). 🔴 Vai: chu_shop + tro_ly_du_lieu (manageSync).
// marketing/cskh/crm_officer => 403. Log kỹ thuật chỉ 2 vai này; KHÔNG lộ secret.
// MVP: KHÔNG cần KiotViet thật — hành động chỉ cập nhật state để demo dashboard.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import { formatVnDateTime } from '../../lib/datetime';
import { encryptSecret } from '../../lib/crypto';
import { scrubSyncError } from './sync.helpers';
import { processSyncEventsBatch } from './sync.processor';
import { invalidateWebhookConfigCache } from './webhook.receiver';

export const syncRouter = Router();
// 🔴 §11.4: chỉ chu_shop + tro_ly_du_lieu.
syncRouter.use(requireAuth, requirePermission('manageSync'));

// Đối tượng đồng bộ + bảng mirror tương ứng (đếm số bản ghi).
const SYNC_OBJECTS: { objectType: string; label: string; count: () => Promise<number> }[] = [
  { objectType: 'customer', label: 'Khách hàng', count: () => prisma.kvCustomer.count() },
  { objectType: 'product', label: 'Sản phẩm', count: () => prisma.kvProduct.count() },
  { objectType: 'invoice', label: 'Hóa đơn', count: () => prisma.kvInvoice.count() },
  { objectType: 'invoice_line', label: 'Dòng hóa đơn', count: () => prisma.kvInvoiceLine.count() },
  { objectType: 'return', label: 'Trả hàng', count: () => prisma.kvReturn.count() },
];

// ---------- GET /status ----------
// Theo từng đối tượng: lần đồng bộ cuối · số bản ghi · số lỗi.
syncRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [states, errorGroups] = await Promise.all([
      prisma.syncState.findMany(),
      prisma.syncEvent.groupBy({
        by: ['objectType'],
        where: { status: { in: ['error', 'dead_letter'] } },
        _count: { _all: true },
      }),
    ]);
    const stateByType = new Map(states.map((s) => [s.objectType, s]));
    const errorByType = new Map(errorGroups.map((g) => [g.objectType, g._count._all]));

    const items = await Promise.all(
      SYNC_OBJECTS.map(async (o) => {
        const st = stateByType.get(o.objectType);
        return {
          objectType: o.objectType,
          label: o.label,
          lastSyncAt: st?.lastSyncAt ? formatVnDateTime(st.lastSyncAt) : null,
          recordCount: await o.count(),
          errorCount: errorByType.get(o.objectType) ?? 0,
        };
      }),
    );
    res.json({ items });
  }),
);

// ---------- GET /queue ----------
// Đang chờ/đang xử lý/lỗi/dead-letter + độ trễ (p95, xấp xỉ từ updatedAt - createdAt).
syncRouter.get(
  '/queue',
  asyncHandler(async (_req, res) => {
    const groups = await prisma.syncEvent.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus: Record<string, number> = { pending: 0, processing: 0, done: 0, error: 0, dead_letter: 0 };
    for (const g of groups) byStatus[g.status] = g._count._all;

    const deadLetters = await prisma.syncEvent.findMany({
      where: { status: 'dead_letter' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, objectType: true, objectId: true, attempts: true, error: true, updatedAt: true },
    });
    const done = await prisma.syncEvent.findMany({
      where: { status: 'done' },
      select: { createdAt: true, updatedAt: true },
    });
    const latencies = done
      .map((e) => e.updatedAt.getTime() - e.createdAt.getTime())
      .filter((ms) => ms >= 0)
      .sort((a, b) => a - b);
    const p95Ms = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : null;

    res.json({
      counts: byStatus,
      retryable: byStatus.error,
      deadLetterCount: byStatus.dead_letter,
      webhookLatencyP95Ms: p95Ms,
      deadLetters: deadLetters.map((d) => {
        // 🔴 FIX-7 (SEC-10): KHÔNG trả raw error (có thể chứa URL/token/header/secret).
        // Chỉ trả errorCode + errorSummary đã scrub (cắt stack, che token, cắt độ dài).
        const { errorCode, errorSummary } = scrubSyncError(d.error);
        return {
          id: d.id,
          objectType: d.objectType,
          objectId: d.objectId,
          attempts: d.attempts,
          errorCode,
          errorSummary,
          at: formatVnDateTime(d.updatedAt),
        };
      }),
    });
  }),
);

// ---------- GET /reconciliation ----------
// T-1 khớp tuyệt đối vs hôm nay cho phép lệch do timing.
syncRouter.get(
  '/reconciliation',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.syncReconciliation.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({
      note: 'Kỳ T-1 phải KHỚP TUYỆT ĐỐI; kỳ hôm nay cho phép lệch nhẹ do timing đồng bộ (SYNC-03).',
      items: rows.map((r) => ({
        periodLabel: r.periodLabel,
        objectType: r.objectType,
        kvCount: r.kvCount,
        crmCount: r.crmCount,
        mismatch: r.mismatch,
        matched: (r.mismatch ?? 0) === 0,
        detail: r.detail,
        at: formatVnDateTime(r.createdAt),
      })),
    });
  }),
);

// ---------- GET /webhooks ----------
syncRouter.get(
  '/webhooks',
  asyncHandler(async (_req, res) => {
    const cred = await prisma.apiCredential.findFirst({ where: { provider: 'kiotviet' } });
    const meta = (cred?.meta as { webhooks?: unknown[] } | null) ?? null;
    res.json({
      registered: cred != null,
      // KHÔNG trả secretCipher — chỉ trạng thái đăng ký.
      webhooks: meta?.webhooks ?? [],
    });
  }),
);

// ---------- POST /retry/:eventId ----------
// Trợ lý dữ liệu (và chủ shop) retry sự kiện lỗi/dead-letter => đưa về pending.
syncRouter.post(
  '/retry/:eventId',
  asyncHandler(async (req, res) => {
    const ev = await prisma.syncEvent.findUnique({ where: { id: String(req.params.eventId) } });
    if (!ev) throw notFound('Không tìm thấy sự kiện đồng bộ.');
    if (ev.status !== 'error' && ev.status !== 'dead_letter') {
      throw badRequest('Chỉ retry được sự kiện đang ở trạng thái lỗi / dead-letter.');
    }
    await prisma.syncEvent.update({
      where: { id: ev.id },
      data: { status: 'pending', error: null },
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.retry',
      objectType: 'sync_event',
      objectId: ev.id,
    });
    res.json({ ok: true });
  }),
);

// ---------- POST /full-resync ----------
// 🔴 SYNC-24: Chủ shop + xác nhận + mật khẩu. KHÔNG nhân đôi, KHÔNG mất dữ liệu CRM.
const fullResyncSchema = z.object({ password: z.string().min(1), confirm: z.literal(true) });
syncRouter.post(
  '/full-resync',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = fullResyncSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cần xác nhận + nhập lại mật khẩu để chạy đồng bộ toàn bộ.');
    // 🔴 reauth có chống brute-force (CWE-307: khóa userId+IP, audit lần sai).
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);

    const now = new Date();
    // MVP: đặt lại cursor + mốc để mô phỏng khởi động resync (worker thật sẽ hook sau). KHÔNG động dữ liệu CRM.
    await prisma.syncState.updateMany({ data: { lastCursor: null, lastSyncAt: now } });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.full_resync',
      objectType: 'sync_state',
      objectId: null,
      reason: 'Full resync (chủ shop, đã xác minh mật khẩu)',
    });
    res.json({ ok: true, startedAt: formatVnDateTime(now), note: 'Đã lên lịch đồng bộ lại toàn bộ (mô phỏng MVP).' });
  }),
);

// ---------- POST /webhook-secret ----------
// 🔴 Đặt/đổi SECRET verify chữ ký webhook KiotViet — CHỈ chủ shop + reauth. Lưu MÃ HÓA (AES-GCM), KHÔNG thô.
// 🔴 CWE-326/521: secret HMAC webhook phải ĐỦ MẠNH (≥32 ký tự) — chống dò offline nếu chữ ký/secret lộ.
const secretSchema = z.object({ secret: z.string().min(32).max(200), password: z.string().min(1) });
syncRouter.post(
  '/webhook-secret',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = secretSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Secret tối thiểu 32 ký tự + cần nhập lại mật khẩu.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    const secretCipher = encryptSecret(parsed.data.secret);
    const cred = await prisma.apiCredential.findFirst({ where: { provider: 'kiotviet' } });
    if (cred) await prisma.apiCredential.update({ where: { id: cred.id }, data: { secretCipher } });
    else await prisma.apiCredential.create({ data: { provider: 'kiotviet', secretCipher } });
    invalidateWebhookConfigCache(); // secret mới có hiệu lực ngay (không chờ cache TTL)
    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.webhook_secret_set',
      objectType: 'api_credential',
      objectId: cred?.id ?? null,
    });
    res.json({ ok: true }); // KHÔNG trả lại secret/cipher.
  }),
);

// ---------- POST /process ----------
// Chạy TAY một lượt worker xử lý hàng đợi sync_events (bổ trợ worker tự động). manageSync + audit.
syncRouter.post(
  '/process',
  asyncHandler(async (req, res) => {
    const result = await processSyncEventsBatch();
    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.process',
      objectType: 'sync_event',
      objectId: null,
      newValue: result,
    });
    res.json(result);
  }),
);

// ---------- POST /webhooks/register ----------
syncRouter.post(
  '/webhooks/register',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const cred = await prisma.apiCredential.findFirst({ where: { provider: 'kiotviet' } });
    const webhooks = SYNC_OBJECTS.map((o) => ({
      objectType: o.objectType,
      status: 'active',
      registeredAt: now.toISOString(),
    }));
    if (cred) {
      await prisma.apiCredential.update({ where: { id: cred.id }, data: { meta: { webhooks } as never } });
    } else {
      await prisma.apiCredential.create({ data: { provider: 'kiotviet', meta: { webhooks } as never } });
    }
    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.webhooks_register',
      objectType: 'api_credential',
      objectId: cred?.id ?? null,
    });
    res.json({ ok: true, webhooks });
  }),
);
