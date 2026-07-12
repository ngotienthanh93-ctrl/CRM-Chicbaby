// 🔴 Xác minh LẠI mật khẩu cho thao tác nhạy cảm (gộp khách — MERGE-01, full-resync — SYNC-24).
// Tái dùng crypto.verifyPassword (scrypt, so sánh hằng thời gian). KHÔNG log mật khẩu (audit đã scrub).
import { prisma } from '../lib/prisma';
import { verifyPassword } from '../lib/crypto';

/** Trả true nếu `password` khớp mật khẩu hiện tại của user. User không tồn tại/disabled => false. */
export async function verifyCurrentPassword(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'active') return false;
  return verifyPassword(password, user.passwordHash);
}
