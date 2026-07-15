import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyWebhookSignature,
  nextStatusAfterFailure,
  normalizeSyncWebhook,
  isSyncObjectType,
  recordToSyncEvent,
} from './syncEvent';

const SECRET = 'test-webhook-secret';
function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex');
}

describe('syncEvent — verifyWebhookSignature (chống giả mạo webhook)', () => {
  it('chữ ký đúng ⇒ true', () => {
    const body = '{"events":[]}';
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });
  it('chấp nhận chữ ký in hoa (case-insensitive)', () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(Buffer.from(body), sign(body).toUpperCase(), SECRET)).toBe(true);
  });
  it('chữ ký sai / thiếu / secret rỗng ⇒ false', () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(Buffer.from(body), 'deadbeef', SECRET)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body), undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), '')).toBe(false);
  });
  it('body khác ⇒ chữ ký không khớp', () => {
    expect(verifyWebhookSignature(Buffer.from('{"a":2}'), sign('{"a":1}'), SECRET)).toBe(false);
  });
});

describe('syncEvent — nextStatusAfterFailure (retry/dead-letter)', () => {
  it('dưới trần ⇒ error (retry được)', () => {
    expect(nextStatusAfterFailure(1, 5)).toBe('error');
    expect(nextStatusAfterFailure(4, 5)).toBe('error');
  });
  it('đạt/vượt trần ⇒ dead_letter', () => {
    expect(nextStatusAfterFailure(5, 5)).toBe('dead_letter');
    expect(nextStatusAfterFailure(6, 5)).toBe('dead_letter');
  });
});

describe('syncEvent — normalizeSyncWebhook (chuẩn hóa + idempotency key)', () => {
  it('parse các sự kiện hợp lệ', () => {
    const out = normalizeSyncWebhook({
      events: [
        { objectType: 'customer', objectId: 'KV123', kvModifiedAt: '2026-07-13T00:00:00Z', eventId: 'e1', data: { name: 'A' } },
        { objectType: 'invoice', objectId: 456, data: { total: 10 } }, // objectId số ⇒ ép chuỗi
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ objectType: 'customer', objectId: 'KV123', eventId: 'e1' });
    expect(out[0]!.kvModifiedAt instanceof Date).toBe(true);
    expect(out[1]).toMatchObject({ objectType: 'invoice', objectId: '456', kvModifiedAt: null, eventId: null });
  });
  it('bỏ qua mục thiếu objectType hợp lệ / objectId (không ném)', () => {
    const out = normalizeSyncWebhook({
      events: [
        { objectType: 'unknown', objectId: 'x' },
        { objectType: 'customer' }, // thiếu objectId
        { objectType: 'product', objectId: 'P1', data: {} },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.objectType).toBe('product');
  });
  it('body không có mảng events ⇒ rỗng', () => {
    expect(normalizeSyncWebhook({})).toEqual([]);
    expect(normalizeSyncWebhook(null)).toEqual([]);
    expect(normalizeSyncWebhook({ events: 'x' })).toEqual([]);
  });
  it('isSyncObjectType', () => {
    expect(isSyncObjectType('customer')).toBe(true);
    expect(isSyncObjectType('nope')).toBe(false);
  });
});

describe('syncEvent — recordToSyncEvent (chuẩn hóa nguồn PULL, KV-05)', () => {
  it('objectId từ record.id, kvModifiedAt từ record.modifiedDate, payload = record nguyên bản', () => {
    const rec = { id: 123, code: 'SP1', modifiedDate: '2026-07-14T10:00:00Z' };
    const ev = recordToSyncEvent('product', rec);
    expect(ev.objectType).toBe('product');
    expect(ev.objectId).toBe('123'); // id KiotViet dạng số ⇒ String
    expect(ev.kvModifiedAt instanceof Date).toBe(true);
    expect(ev.kvModifiedAt!.toISOString()).toBe('2026-07-14T10:00:00.000Z');
    expect(ev.eventId).toBeNull(); // nguồn pull không có eventId webhook
    expect(ev.payload).toBe(rec); // giữ nguyên record cho handler map
  });
  it('thiếu modifiedDate ⇒ kvModifiedAt null (idempotency vẫn dùng được, khóa NULL)', () => {
    const ev = recordToSyncEvent('customer', { id: 456 });
    expect(ev.objectId).toBe('456');
    expect(ev.kvModifiedAt).toBeNull();
  });
  it('modifiedDate không hợp lệ ⇒ null (parse an toàn)', () => {
    const ev = recordToSyncEvent('customer', { id: 7, modifiedDate: 'not-a-date' });
    expect(ev.kvModifiedAt).toBeNull();
  });
  it('thiếu id / id khoảng trắng ⇒ objectId RỖNG (caller bỏ qua, không ghi mirror sai khóa)', () => {
    expect(recordToSyncEvent('product', {}).objectId).toBe('');
    expect(recordToSyncEvent('product', { id: null }).objectId).toBe('');
    expect(recordToSyncEvent('product', { id: '   ' }).objectId).toBe(''); // trim ⇒ rỗng
    expect(recordToSyncEvent('product', { Id: 88 }).objectId).toBe('88'); // fallback PascalCase
  });
});
