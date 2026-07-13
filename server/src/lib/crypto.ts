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

// ---- Mã hóa secret 2FA (TOTP) tại nghỉ (AES-256-GCM) ----
// Khóa AES derive TỪ SESSION_SECRET (sub-key riêng, không dùng lại trực tiếp). Secret TOTP phải giải mã được
// (để tính mã) nên KHÔNG băm một chiều mà mã hóa đối xứng có xác thực (GCM chống sửa ciphertext).
const TOTP_ENC_KEY = crypto.scryptSync(env.SESSION_SECRET, 'chicbaby-totp-enc-v1', 32);

/** Mã hóa secret TOTP → chuỗi `ivHex:tagHex:ctHex`. IV ngẫu nhiên mỗi lần. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TOTP_ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

/** Giải mã secret TOTP. Ném lỗi nếu định dạng sai hoặc tag không khớp (chống giả mạo ciphertext). */
export function decryptSecret(enc: string): string {
  const [ivHex, tagHex, ctHex] = enc.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Định dạng secret mã hóa không hợp lệ.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', TOTP_ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Sinh một mã dự phòng (backup code) người-đọc-được: 10 ký tự base32 (nhóm 5-5). */
export function generateBackupCode(): string {
  const raw = crypto.randomBytes(7); // ~56 bit entropy
  const b32 = raw
    .toString('base64')
    .replace(/[^A-Z2-7]/gi, '')
    .toUpperCase()
    .slice(0, 10)
    .padEnd(10, '2');
  return `${b32.slice(0, 5)}-${b32.slice(5, 10)}`;
}

/** Chuẩn hóa mã dự phòng (bỏ gạch/space, in hoa) rồi HMAC-SHA256 (mã entropy cao ⇒ HMAC đủ an toàn). */
export function hashBackupCode(code: string): string {
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(`backup\0${normalized}`).digest('hex');
}
