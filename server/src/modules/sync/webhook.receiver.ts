// 🔴 §11.4 / SYNC — Endpoint NHẬN webhook KiotViet (máy-tới-máy, KHÔNG phiên đăng nhập). Xác thực bằng
// CHỮ KÝ HMAC (secret lưu mã hóa ở api_credentials), KHÔNG bằng cookie. Body RAW để verify (mount TRƯỚC
// express.json). Nhận → verify → enqueue idempotent → 200 nhanh. Xử lý thật do worker (sync.processor) làm sau.
//
// 🔴 Chống lạm dụng (endpoint public): (1) rate-limit TOÀN CỤC cửa sổ cố định (429 khi vượt) — chặn ngay,
// KHÔNG chạm DB; (2) CACHE secret+header (TTL ngắn) ⇒ flood KHÔNG đọc DB mỗi request; (3) giới hạn body 1MB +
// trần số sự kiện. Chống thể tích lớn theo IP/subnet vẫn nên đặt ở EDGE (WAF/proxy) — xem backlog.
import { Router, raw, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { decryptSecret } from '../../lib/crypto';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { verifyWebhookSignature, normalizeSyncWebhook } from '../../engines/syncEvent';
import { enqueueSyncEvent } from './sync.processor';

export const syncWebhookRouter = Router();

// ---- Rate-limit toàn cục (cửa sổ cố định) — bounded, không state theo IP (chống memory-DoS nhiều IP) ----
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX = 300; // ~30 req/s trung bình — dư cho một provider webhook, chặn flood.
let windowStart = 0;
let windowCount = 0;
function rateLimited(now: number): boolean {
  if (now - windowStart >= RATE_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount++;
  return windowCount > RATE_MAX;
}

/** 🔴 Rate-limit là MIDDLEWARE ĐẦU TIÊN — chặn TRƯỚC cả raw() (không để Express buffer 1MB rồi mới 429). */
function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (rateLimited(Date.now())) {
    res.status(429).json({ error: 'Quá nhiều yêu cầu.' });
    return;
  }
  next();
}

// ---- Cache secret + header (TTL ngắn) — flood không đọc DB mỗi request; đổi secret có hiệu lực sau ≤ TTL ----
const CONFIG_TTL_MS = 60 * 1000;
let cache: { secret: string | null; header: string; at: number } | null = null;

/** Xóa cache verify (gọi ngay khi đổi secret ⇒ có hiệu lực tức thì, không chờ TTL). */
export function invalidateWebhookConfigCache(): void {
  cache = null;
}
async function getVerifyConfig(now: number): Promise<{ secret: string | null; header: string }> {
  if (cache && now - cache.at < CONFIG_TTL_MS) return cache;
  const [cred, headerRow] = await Promise.all([
    prisma.apiCredential.findFirst({ where: { provider: 'kiotviet' }, select: { secretCipher: true } }),
    prisma.configurationVersion.findFirst({ where: { key: 'sync.webhook_signature_header', isActive: true } }),
  ]);
  let secret: string | null = null;
  if (cred?.secretCipher) {
    try {
      secret = decryptSecret(cred.secretCipher);
    } catch {
      secret = null; // cipher hỏng ⇒ coi như chưa cấu hình
    }
  }
  const header =
    typeof headerRow?.value === 'string' ? headerRow.value : DEFAULT_ENGINE_CONFIG.sync.webhookSignatureHeader;
  cache = { secret, header, at: now };
  return cache;
}

/** Log nhẹ (không audit — tránh flood audit) sự cố xác thực webhook. */
function warnAuth(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[webhook auth] ${msg}`);
}

// POST /api/sync/kiotviet/webhook — KiotViet gọi vào đây.
syncWebhookRouter.post(
  '/webhook',
  rateLimitMiddleware, // 🔴 rate-limit TRƯỚC raw() — không buffer 1MB rồi mới từ chối.
  raw({ type: '*/*', limit: '1mb' }), // body RAW (Buffer) để tính HMAC; giới hạn 1MB chống payload khổng lồ.
  asyncHandler(async (req, res) => {
    const now = Date.now();
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const { secret, header } = await getVerifyConfig(now);

    // 2) Chưa cấu hình secret ⇒ 503 (không nhận webhook khi chưa có secret để verify).
    if (!secret) {
      res.status(503).json({ error: 'Webhook chưa được cấu hình secret.' });
      return;
    }

    // 3) Verify chữ ký HMAC (chống giả mạo). Sai ⇒ 401 (không tiết lộ chi tiết) + log.
    if (!verifyWebhookSignature(rawBody, req.get(header.toLowerCase()), secret)) {
      warnAuth(`chữ ký không hợp lệ từ ip=${req.ip ?? '?'}`);
      res.status(401).json({ error: 'Chữ ký webhook không hợp lệ.' });
      return;
    }

    // 4) Parse + chuẩn hóa (có trần số sự kiện/độ dài id) + enqueue IDEMPOTENT (giao lại KHÔNG nhân đôi).
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Payload không phải JSON hợp lệ.' });
      return;
    }
    const events = normalizeSyncWebhook(body);
    let enqueued = 0;
    let duplicate = 0;
    for (const ev of events) {
      const r = await enqueueSyncEvent(ev);
      if (r === 'enqueued') enqueued++;
      else duplicate++;
    }
    res.json({ received: events.length, enqueued, duplicate });
  }),
);
