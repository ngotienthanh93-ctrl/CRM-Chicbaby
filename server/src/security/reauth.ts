// 🔴 Xác minh LẠI mật khẩu cho thao tác nhạy cảm (gộp khách — MERGE-01, full-resync — SYNC-24, SCR-13).
// Tái dùng crypto.verifyPassword (scrypt, so sánh hằng thời gian). KHÔNG log mật khẩu (audit đã scrub).
import { prisma } from '../lib/prisma';
import { verifyPassword } from '../lib/crypto';
import { forbidden, tooManyRequests } from '../lib/http';
import { LoginThrottle, throttleKey } from '../modules/auth/login-throttle';
import { writeAudit } from './audit';

/** Trả true nếu `password` khớp mật khẩu hiện tại của user. User không tồn tại/disabled => false. */
export async function verifyCurrentPassword(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'active') return false;
  return verifyPassword(password, user.passwordHash);
}

// 🔴 SEC (CWE-307): reauth cũng bị brute-force nếu phiên admin bị đánh cắp — khóa theo (userId+IP),
//    ghi audit mỗi lần sai/khóa. Bộ đếm RIÊNG với login (không lây khóa qua lại). HẠN CHẾ MVP: in-memory
//    (giống loginThrottle) — production đa-instance cần chuyển DB/Redis.
const reauthThrottle = new LoginThrottle();

/** Dọn bộ đếm reauth (chỉ dùng cho test). */
export function resetReauthThrottle(): void {
  reauthThrottle.reset();
}

/**
 * 🔴 Xác minh lại mật khẩu CÓ chống brute-force cho thao tác nhạy cảm (SCR-13 AUTH-12).
 * - Đang bị khóa => 429 (tooManyRequests) + audit 'auth.reauth_locked'.
 * - Sai mật khẩu => đếm sai + audit 'auth.reauth_failed'; đủ ngưỡng => 429, chưa đủ => 403.
 * - Đúng => xóa bộ đếm (im lặng — caller tự audit hành động nghiệp vụ).
 */
export async function verifyReauth(
  userId: string,
  password: string,
  ip: string | undefined,
): Promise<void> {
  const key = throttleKey(userId, ip);
  const lock = reauthThrottle.isLocked(key);
  if (lock.locked) {
    await writeAudit({
      userId,
      action: 'auth.reauth_locked',
      objectType: 'user',
      objectId: userId,
      ip: ip ?? null,
      newValue: { retryAfterMs: lock.retryAfterMs },
    });
    throw tooManyRequests('Bạn đã xác minh sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
  }
  const ok = await verifyCurrentPassword(userId, password);
  if (!ok) {
    const st = reauthThrottle.recordFailure(key);
    await writeAudit({
      userId,
      action: 'auth.reauth_failed',
      objectType: 'user',
      objectId: userId,
      ip: ip ?? null,
      newValue: { fails: st.fails, locked: st.locked },
    });
    if (st.locked) {
      throw tooManyRequests('Bạn đã xác minh sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
    }
    throw forbidden('Mật khẩu xác minh không đúng.');
  }
  reauthThrottle.recordSuccess(key);
}
