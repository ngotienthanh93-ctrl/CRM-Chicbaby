import { prisma } from '../../lib/prisma';
import { generateSessionToken, hashSessionToken, verifyPassword } from '../../lib/crypto';
import { isRoleKey, type RoleKeyStr } from '../../security/permissions';

export const SESSION_COOKIE = 'sid';
const IDLE_MS = 8 * 60 * 60 * 1000; // idle 8h

export interface AuthedUser {
  userId: string;
  username: string;
  fullName: string;
  role: RoleKeyStr;
  sessionId: string;
}

/** Đăng nhập: xác thực username+password. KHÔNG tiết lộ tài khoản tồn tại (AUTH-10). */
export async function login(
  username: string,
  password: string,
  meta: { device?: string; ip?: string },
): Promise<{ token: string; user: AuthedUser } | null> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { role: true },
  });
  // Thông điệp lỗi ĐỒNG NHẤT cho mọi trường hợp (không lộ user tồn tại hay sai mật khẩu).
  if (!user || user.status !== 'active') {
    // vẫn thực hiện verify giả để giảm chênh lệch thời gian
    verifyPassword(password, 'scrypt$00$00');
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return null;
  }

  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + IDLE_MS),
      device: meta.device ?? null,
      ip: meta.ip ?? null,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const roleKey: RoleKeyStr = isRoleKey(user.role.key) ? user.role.key : 'tro_ly_du_lieu';
  return {
    token,
    user: {
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      role: roleKey,
      sessionId: session.id,
    },
  };
}

/** Xác thực token phiên. Trả về user hoặc null. Trượt hạn (sliding) + cập nhật lastSeen. */
export async function validateSession(token: string): Promise<AuthedUser | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { role: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== 'active') return null;

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + IDLE_MS) },
  });

  const roleKey: RoleKeyStr = isRoleKey(session.user.role.key)
    ? session.user.role.key
    : 'tro_ly_du_lieu';
  return {
    userId: session.user.id,
    username: session.user.username,
    fullName: session.user.fullName,
    role: roleKey,
    sessionId: session.id,
  };
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
