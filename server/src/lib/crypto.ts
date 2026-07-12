import crypto from 'node:crypto';
import { env } from './env';

// Mật khẩu: scrypt (salt ngẫu nhiên). Lưu dạng `scrypt$<saltHex>$<hashHex>`.
// Session token: token ngẫu nhiên cao entropy đưa vào cookie httpOnly; DB chỉ lưu sha256(token).

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const derived = crypto.scryptSync(password, salt, expected.length);
  // So sánh hằng thời gian, tránh timing attack.
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/** Sinh token phiên ngẫu nhiên (đưa vào cookie). */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Băm token để lưu DB (không lưu token thô). Có trộn SESSION_SECRET (HMAC). */
export function hashSessionToken(token: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}
