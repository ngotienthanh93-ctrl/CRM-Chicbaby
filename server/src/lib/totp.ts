// TOTP (RFC 6238, dựa trên HOTP RFC 4226) — xác thực 2 lớp bằng authenticator app (Google/Microsoft/Authy).
// Thuần node:crypto (HMAC-SHA1), KHÔNG lib ngoài. Test được bằng vector chuẩn RFC 6238.
import crypto from 'node:crypto';
import { base32Encode, base32Decode } from './base32';

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const ALGO = 'sha1'; // chuẩn phổ biến nhất cho authenticator app

/** Sinh secret TOTP mới: 20 byte ngẫu nhiên → base32 (định dạng authenticator app dùng). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** Mã HOTP cho một counter (8 byte big-endian) từ secret bytes. */
function hotp(secretBytes: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // counter là số nguyên < 2^53; ghi big-endian 64-bit (32 cao thường 0 với thời gian hiện tại).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac(ALGO, secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** Mã TOTP hiện tại cho secret (base32) tại thời điểm `nowMs`. */
export function totpCode(secretBase32: string, nowMs: number = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Xác minh mã người dùng nhập so với secret, cho phép trôi ±`window` bước thời gian (mặc định 1 = ±30s)
 * để bù lệch đồng hồ. So sánh HẰNG THỜI GIAN từng ứng viên. Mã sai định dạng ⇒ false ngay.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
  window = 1,
): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(nowMs / 1000 / PERIOD_SECONDS);
  const target = Buffer.from(trimmed);
  let ok = false;
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secretBytes, counter + i));
    // timingSafeEqual đòi cùng độ dài; mọi mã đều 6 ký tự nên an toàn.
    if (candidate.length === target.length && crypto.timingSafeEqual(candidate, target)) ok = true;
  }
  return ok;
}

/** URI otpauth:// để authenticator app quét QR (issuer + tên tài khoản). */
export function totpAuthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
