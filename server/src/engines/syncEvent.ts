// 🔴 §11.4 / SYNC — Khung xử lý webhook KiotViet (CHỜ API THẬT). Logic THUẦN (test được), KHÔNG chạm DB.
// Gồm: verify chữ ký HMAC (chống giả mạo webhook), quyết định retry/dead-letter, và CHUẨN HÓA payload
// webhook thành các sự kiện đồng bộ có khóa idempotency (SYNC-03: objectType+objectId+kvModifiedAt).
import crypto from 'node:crypto';

/**
 * Xác minh chữ ký webhook = HMAC-SHA256(rawBody, secret) hex, so HẰNG THỜI GIAN.
 * 🔴 Chống giả mạo webhook (bất kỳ ai biết URL). Định dạng header/thuật toán CHÍNH XÁC của KiotViet chốt khi
 * có API Spike — hiện dùng HMAC-SHA256 hex (phổ biến). secret rỗng ⇒ coi như CHƯA cấu hình ⇒ từ chối.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  providedSignature: string | undefined | null,
  secret: string,
): boolean {
  if (!secret || !providedSignature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSignature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Trạng thái sau khi xử lý MỘT sự kiện THẤT BẠI: còn dưới trần thử ⇒ 'error' (retry được),
 * đạt/vượt trần ⇒ 'dead_letter' (ngừng tự retry, chờ người can thiệp). `attempts` = số lần đã thử (sau tăng).
 */
export function nextStatusAfterFailure(attempts: number, maxAttempts: number): 'error' | 'dead_letter' {
  return attempts >= maxAttempts ? 'dead_letter' : 'error';
}

/** Loại đối tượng đồng bộ hợp lệ (khớp mirror kv_*). */
export const SYNC_OBJECT_TYPES = ['customer', 'product', 'invoice', 'invoice_line', 'return'] as const;
export type SyncObjectType = (typeof SYNC_OBJECT_TYPES)[number];

export function isSyncObjectType(v: unknown): v is SyncObjectType {
  return typeof v === 'string' && (SYNC_OBJECT_TYPES as readonly string[]).includes(v);
}

/** Một sự kiện đồng bộ đã chuẩn hóa (sẵn sàng enqueue vào sync_events). */
export interface NormalizedSyncEvent {
  objectType: SyncObjectType;
  objectId: string;
  kvModifiedAt: Date | null;
  eventId: string | null;
  payload: unknown;
}

/** 🔴 CWE-20/400: chặn payload lạm dụng — trần số sự kiện/webhook + trần độ dài id/eventId. */
export const MAX_EVENTS_PER_WEBHOOK = 500;
const MAX_ID_LEN = 200;

/**
 * Chuẩn hóa body webhook → danh sách sự kiện. HỢP ĐỒNG INBOUND (adapter KiotViet→shape này chốt ở Spike):
 *   { events: [ { objectType, objectId, kvModifiedAt?, eventId?, data } ] }
 * VALIDATE: bỏ qua (không ném) mục sai objectType / thiếu objectId / id quá dài; cắt tối đa MAX_EVENTS_PER_WEBHOOK.
 */
export function normalizeSyncWebhook(body: unknown): NormalizedSyncEvent[] {
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: NormalizedSyncEvent[] = [];
  for (const raw of events.slice(0, MAX_EVENTS_PER_WEBHOOK)) {
    const e = raw as Record<string, unknown>;
    if (!isSyncObjectType(e.objectType)) continue;
    const objectId = typeof e.objectId === 'string' ? e.objectId : String(e.objectId ?? '');
    if (!objectId || objectId.length > MAX_ID_LEN) continue;
    const eventId = typeof e.eventId === 'string' && e.eventId.length <= MAX_ID_LEN ? e.eventId : null;
    out.push({ objectType: e.objectType, objectId, kvModifiedAt: parseKvDate(e.kvModifiedAt), eventId, payload: e.data ?? null });
  }
  return out;
}

/** Parse mốc thời gian KiotViet (ISO string / epoch ms) → Date; không hợp lệ ⇒ null (idempotency vẫn dùng được). */
function parseKvDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 🔵 KV-05 — Chuẩn hóa MỘT bản ghi nguồn PULL (fetch phân trang) → NormalizedSyncEvent, để đi CHUNG đường ống
 * `enqueueSyncEvent` + processor + mapper như webhook (một đường mapping duy nhất). Nguồn pull KHÔNG có eventId
 * webhook ⇒ null; khóa idempotency vẫn là (objectType, objectId, kvModifiedAt) — SYNC-03.
 *   objectId    = String(record.id)     (id KiotViet dạng số, §7)
 *   kvModifiedAt = parse(record.modifiedDate)  (ISO an toàn; thiếu/không hợp lệ ⇒ null)
 *   payload     = record nguyên bản (để handler map sang mirror)
 */
export function recordToSyncEvent(objectType: SyncObjectType, record: unknown): NormalizedSyncEvent {
  const r = (record == null || typeof record !== 'object' ? {} : record) as Record<string, unknown>;
  const rawId = r.id ?? r.Id;
  // 🔴 objectId RỖNG nếu thiếu id (bản ghi dị dạng) — caller (drainPages) BỎ QUA, không enqueue để tránh ghi
  // mirror sai khóa. Trim để id chỉ toàn khoảng trắng cũng bị coi là rỗng.
  return {
    objectType,
    objectId: rawId == null ? '' : String(rawId).trim(),
    kvModifiedAt: parseKvDate(r.modifiedDate ?? r.ModifiedDate),
    eventId: null,
    payload: record ?? null,
  };
}
