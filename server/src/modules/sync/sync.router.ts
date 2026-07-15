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
import { runSerializable } from '../../lib/serializable';
import { scrubSyncError } from './sync.helpers';
import { processSyncEventsBatch } from './sync.processor';
import { beginBackfill } from './pull.service';
import { invalidateWebhookConfigCache } from './webhook.receiver';
import { kiotviet, KiotVietNotConfiguredError } from '../../lib/kiotviet/client';

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

// ---------- POST /backfill — KV-05 ----------
// 🔵 Nạp lịch sử sản phẩm + khách từ KiotViet (Public API) qua orchestrator thật: RESUME từ lastCursor (nếu có),
// idempotent theo id KV, KHÔNG đụng dữ liệu CRM. Chủ shop + reauth + audit. Lease trong runBackfill chống chạy
// chồng ⇒ gọi trùng khi đang chạy trả ran=false. Trả tiến độ/kết quả từng đối tượng + 1 lượt rút hàng đợi.
const backfillSchema = z.object({ password: z.string().min(1) });
syncRouter.post(
  '/backfill',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cần nhập lại mật khẩu để chạy nạp dữ liệu KiotViet.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);

    // 🔵 Giành lease ĐỒNG BỘ để biết có thật sự bắt đầu không: đang có lượt khác ⇒ 409 (không báo "đã bắt đầu" nhầm).
    const begun = await beginBackfill();
    if (!begun.started) {
      res.status(409).json({ accepted: false, note: 'Đang có một lượt nạp KiotViet chạy — thử lại sau khi lượt hiện tại xong.' });
      return;
    }
    // 🔴 Đã giành lease: nếu audit lỗi TRƯỚC khi chạy nền ⇒ NHẢ lease ngay (tránh kẹt tới TTL 10').
    try {
      await writeAudit({
        userId: req.auth!.userId,
        action: 'sync.backfill',
        objectType: 'sync_state',
        objectId: null,
        reason: 'Bắt đầu nạp sản phẩm + khách (chủ shop, đã xác minh mật khẩu)',
      });
    } catch (e) {
      await begun.release!().catch(() => {});
      throw e;
    }
    // Chạy NỀN: backfill có thể vài phút (rate-limit KiotViet) ⇒ KHÔNG chặn request. Tiến độ ở GET /status, /queue.
    // Lỗi nền log qua scrubber (SEC-10: không lộ URL/token/secret).
    void begun.run!().catch((e) =>
      console.error('[sync.backfill] lỗi nền:', scrubSyncError(e instanceof Error ? e.message : String(e)).errorSummary),
    );
    res.status(202).json({
      accepted: true,
      note: 'Đã bắt đầu nạp dữ liệu KiotViet ở chế độ nền. Theo dõi ở tab Trạng thái / Hàng đợi.',
    });
  }),
);

// ---------- POST /full-resync ----------
// 🔴 SYNC-24: Chủ shop + xác nhận + mật khẩu. KHÔNG nhân đôi, KHÔNG mất dữ liệu CRM.
// Nối orchestrator THẬT: reset cursor về đầu (nạp lại từ trang 1) rồi chạy backfill (upsert idempotent theo id KV).
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
    // 🔵 Giành lease ĐỒNG BỘ; reset cursor + backfill nằm trong run() (chỉ mutate khi đã giành được lease).
    const begun = await beginBackfill(undefined, { resetCursors: true });
    if (!begun.started) {
      res.status(409).json({ ok: false, accepted: false, note: 'Đang có một lượt đồng bộ KiotViet chạy — thử lại sau.' });
      return;
    }
    // 🔴 Đã giành lease: audit lỗi TRƯỚC khi chạy nền ⇒ NHẢ lease ngay (tránh kẹt tới TTL).
    try {
      await writeAudit({
        userId: req.auth!.userId,
        action: 'sync.full_resync',
        objectType: 'sync_state',
        objectId: null,
        reason: 'Full resync (chủ shop, đã xác minh mật khẩu)',
      });
    } catch (e) {
      await begun.release!().catch(() => {});
      throw e;
    }
    // Chạy NỀN. KHÔNG động dữ liệu CRM; upsert theo id KV ⇒ không nhân đôi (SYNC-24). Lỗi nền log qua scrubber.
    void begun.run!().catch((e) =>
      console.error('[sync.full_resync] lỗi nền:', scrubSyncError(e instanceof Error ? e.message : String(e)).errorSummary),
    );
    res.status(202).json({
      ok: true,
      accepted: true,
      startedAt: formatVnDateTime(now),
      note: 'Đã bắt đầu đồng bộ lại toàn bộ ở chế độ nền. Theo dõi ở tab Trạng thái / Hàng đợi.',
    });
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

// ---------- Public API (pull) credentials — KV-01 ----------
// 🔵 Lưu credential Public API KiotViet để PULL (backfill + đối soát + đăng ký webhook). Row api_credentials
// RIÊNG provider='kiotviet_public_api' (TÁCH khỏi secret webhook 'kiotviet'). client_secret MÃ HÓA (AES-GCM);
// clientId + retailer (không bí mật) ở meta. CHỈ chủ shop + reauth. KHÔNG bao giờ trả secret xuống client.
const PUBLIC_API_PROVIDER = 'kiotviet_public_api';

// GET: chỉ trạng thái cấu hình (đã có chưa + retailer + clientId che), KHÔNG lộ client_secret.
syncRouter.get(
  '/public-api-credentials',
  asyncHandler(async (_req, res) => {
    const cred = await prisma.apiCredential.findFirst({ where: { provider: PUBLIC_API_PROVIDER } });
    const meta = (cred?.meta as { clientId?: string; retailer?: string } | null) ?? null;
    const clientId = meta?.clientId ?? null;
    const clientIdMasked = clientId
      ? clientId.length <= 8
        ? '***'
        : `${clientId.slice(0, 4)}…${clientId.slice(-4)}`
      : null;
    res.json({
      configured: cred != null && cred.secretCipher != null,
      retailer: meta?.retailer ?? null,
      clientIdMasked,
    });
  }),
);

// POST: đặt/đổi credential. chu_shop + reauth. Lưu mã hóa, KHÔNG trả lại secret.
const publicApiCredsSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
  retailer: z.string().trim().min(1).max(200),
  password: z.string().min(1),
});
syncRouter.post(
  '/public-api-credentials',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = publicApiCredsSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest('Cần clientId, clientSecret, tên shop (retailer) và nhập lại mật khẩu.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    const secretCipher = encryptSecret(parsed.data.clientSecret);
    const meta = { clientId: parsed.data.clientId, retailer: parsed.data.retailer };
    // 🔴 CONC: provider KHÔNG unique ⇒ findFirst-then-create có thể tạo 2 row khi 2 POST đua nhau. Serializable
    // + gộp trùng: giữ row cũ nhất (cập nhật), xóa row thừa (phòng dữ liệu đã lỡ trùng). runSerializable retry P2034.
    const credId = await runSerializable(async (tx) => {
      const rows = await tx.apiCredential.findMany({
        where: { provider: PUBLIC_API_PROVIDER },
        orderBy: { createdAt: 'asc' },
      });
      if (rows.length === 0) {
        const created = await tx.apiCredential.create({
          data: { provider: PUBLIC_API_PROVIDER, secretCipher, meta: meta as never },
        });
        return created.id;
      }
      const keep = rows[0]!;
      if (rows.length > 1) {
        await tx.apiCredential.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
      }
      await tx.apiCredential.update({ where: { id: keep.id }, data: { secretCipher, meta: meta as never } });
      return keep.id;
    });
    // 🔴 Đổi credential ⇒ vô hiệu token cache cũ NGAY (không dùng token của creds cũ tới khi hết hạn).
    kiotviet.invalidateToken();
    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.public_api_credentials_set',
      objectType: 'api_credential',
      objectId: credId,
    });
    res.json({ ok: true }); // KHÔNG trả secret/cipher/clientId.
  }),
);

// ---------- POST /public-api/test-connection — KV-02 ----------
// 🔵 Smoke credential Public API: kiểm lấy token (xác thực) + gọi thử /categories (API tới được). Chỉ báo
// ok/lỗi ĐÃ SCRUB — KHÔNG lộ token/secret/URL. manageSync (chu_shop + trợ lý dữ liệu).
syncRouter.post(
  '/public-api/test-connection',
  asyncHandler(async (req, res) => {
    const result: {
      tokenOk: boolean;
      apiOk: boolean;
      sampleCount: number | null;
      error: string | null;
    } = { tokenOk: false, apiOk: false, sampleCount: null, error: null };

    try {
      await kiotviet.getAccessToken();
      result.tokenOk = true;
    } catch (e) {
      result.error =
        e instanceof KiotVietNotConfiguredError
          ? 'Chưa cấu hình credential Public API.'
          : scrubSyncError(e instanceof Error ? e.message : String(e)).errorSummary;
      res.json(result);
      return;
    }

    try {
      const data = await kiotviet.kvGet<{ data?: unknown[] }>('/categories', { pageSize: 1 });
      result.apiOk = true;
      result.sampleCount = Array.isArray(data?.data) ? data.data.length : null;
    } catch (e) {
      result.error = scrubSyncError(e instanceof Error ? e.message : String(e)).errorSummary;
    }

    await writeAudit({
      userId: req.auth!.userId,
      action: 'sync.public_api_test_connection',
      objectType: 'api_credential',
      objectId: null,
      newValue: { tokenOk: result.tokenOk, apiOk: result.apiOk },
    });
    res.json(result);
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
