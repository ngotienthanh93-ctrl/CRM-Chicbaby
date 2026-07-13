// 🔴 Xác minh LẠI mật khẩu cho thao tác nhạy cảm (gộp khách — MERGE-01, full-resync — SYNC-24, SCR-13).
// Tái dùng crypto.verifyPassword (scrypt, so sánh hằng thời gian). KHÔNG log mật khẩu (audit đã scrub).
import { prisma } from '../lib/prisma';
import { verifyPassword } from '../lib/crypto';
import { forbidden, tooManyRequests } from '../lib/http';
import { throttleKey } from '../modules/auth/login-throttle';
import { reserveAttemptDb, recordSuccessDb } from '../modules/auth/throttle-store';
import { writeAudit } from './audit';

/** Trả true nếu `password` khớp mật khẩu hiện tại của user. User không tồn tại/disabled => false. */
export async function verifyCurrentPassword(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'active') return false;
  return verifyPassword(password, user.passwordHash);
}

// 🔴 SEC (CWE-307): reauth cũng bị brute-force nếu phiên admin bị đánh cắp — khóa theo (userId+IP),
//    ghi audit mỗi lần sai/khóa. Bộ đếm scope RIÊNG 'reauth' (không lây khóa qua lại với login),
//    PERSIST ở DB (throttle_entries) — chia sẻ đa-instance, không mất khi restart.

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
  // 🔴 ĐẶT CHỖ (đếm) NGUYÊN TỬ trước khi verify ⇒ đóng cửa sổ burst song song (như login).
  const reservation = await reserveAttemptDb('reauth', key);
  if (!reservation.allowed) {
    await writeAudit({
      userId,
      action: 'auth.reauth_locked',
      objectType: 'user',
      objectId: userId,
      ip: ip ?? null,
      newValue: { retryAfterMs: reservation.retryAfterMs },
    });
    throw tooManyRequests('Bạn đã xác minh sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
  }
  const ok = await verifyCurrentPassword(userId, password);
  if (!ok) {
    // Lần thử đã được đếm khi đặt chỗ.
    await writeAudit({
      userId,
      action: 'auth.reauth_failed',
      objectType: 'user',
      objectId: userId,
      ip: ip ?? null,
      newValue: { fails: reservation.fails, locked: reservation.locked },
    });
    if (reservation.locked) {
      throw tooManyRequests('Bạn đã xác minh sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
    }
    throw forbidden('Mật khẩu xác minh không đúng.');
  }
  await recordSuccessDb('reauth', key);
}
