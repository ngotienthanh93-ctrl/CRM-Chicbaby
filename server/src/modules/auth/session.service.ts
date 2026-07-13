import { prisma } from '../../lib/prisma';
import type { Prisma } from '@prisma/client';
import { generateSessionToken, hashSessionToken, verifyPassword } from '../../lib/crypto';
import { isRoleKey, type RoleKeyStr } from '../../security/permissions';
import { isDeviceTrusted, verifyTwoFactorCode } from './twofa.service';

export const SESSION_COOKIE = 'sid';
/** Cookie mang token "thiết bị tin cậy" (bỏ qua 2FA trong hạn). */
export const TRUST_COOKIE = 'tdid';
const IDLE_MS = 8 * 60 * 60 * 1000; // idle 8h
/** Thời hạn "thử thách 2FA" (phiên pending sau bước mật khẩu) — buộc nhập TOTP nhanh. */
const PENDING_2FA_MS = 5 * 60 * 1000;

export interface AuthedUser {
  userId: string;
  username: string;
  fullName: string;
  role: RoleKeyStr;
  sessionId: string;
}

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

function toAuthedUser(user: UserWithRole, sessionId: string): AuthedUser {
  const roleKey: RoleKeyStr = isRoleKey(user.role.key) ? user.role.key : 'tro_ly_du_lieu';
  return { userId: user.id, username: user.username, fullName: user.fullName, role: roleKey, sessionId };
}

/** Tạo phiên ĐẦY ĐỦ (đã qua xác thực) + cập nhật lastLoginAt. */
async function createFullSession(
  user: UserWithRole,
  meta: { device?: string; ip?: string },
): Promise<{ token: string; user: AuthedUser }> {
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
  return { token, user: toAuthedUser(user, session.id) };
}

/** Kết quả đăng nhập: đã vào thẳng, hoặc CẦN nhập 2FA (challenge), hoặc thất bại (null). */
export type LoginOutcome =
  | { kind: 'authed'; token: string; user: AuthedUser }
  | { kind: 'twofa_required'; challengeToken: string }
  | null;

/**
 * Đăng nhập bước 1: xác thực username+password. KHÔNG tiết lộ tài khoản tồn tại (AUTH-10).
 * - 2FA TẮT ⇒ vào thẳng (authed).
 * - 2FA BẬT + thiết bị đã tin cậy (trustToken hợp lệ) ⇒ vào thẳng (bỏ qua 2FA).
 * - 2FA BẬT + thiết bị chưa tin cậy ⇒ tạo phiên PENDING (chưa dùng được) + trả challenge để nhập TOTP.
 */
export async function login(
  username: string,
  password: string,
  meta: { device?: string; ip?: string; trustToken?: string },
): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({ where: { username }, include: { role: true } });
  // Thông điệp lỗi ĐỒNG NHẤT cho mọi trường hợp (không lộ user tồn tại hay sai mật khẩu).
  if (!user || user.status !== 'active') {
    verifyPassword(password, 'scrypt$00$00'); // verify giả giảm chênh lệch thời gian
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) return null;

  if (user.twoFactorEnabled) {
    const trusted = await isDeviceTrusted(user.id, meta.trustToken);
    if (!trusted) {
      // Tạo phiên PENDING (pendingTwoFactor=true) hết hạn nhanh — CHƯA truy cập API được.
      const token = generateSessionToken();
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + PENDING_2FA_MS),
          device: meta.device ?? null,
          ip: meta.ip ?? null,
          pendingTwoFactor: true,
        },
      });
      return { kind: 'twofa_required', challengeToken: token };
    }
  }

  return { kind: 'authed', ...(await createFullSession(user, meta)) };
}

/** Kết quả hoàn tất 2FA: thành công (phiên nâng cấp) hoặc lý do lỗi. */
export type CompleteTwoFactorResult =
  | { ok: true; token: string; user: AuthedUser }
  | { ok: false; reason: 'challenge_invalid' | 'code_invalid' };

/**
 * Đăng nhập bước 2: xác minh mã 2FA cho phiên PENDING (challenge). Đúng ⇒ NÂNG CẤP phiên (bỏ pending, gia hạn).
 * Challenge chỉ dùng cho phiên pending còn hạn của user active; sai mã ⇒ giữ pending (throttle ở router).
 */
export async function completeTwoFactorLogin(
  challengeToken: string,
  code: string,
): Promise<CompleteTwoFactorResult> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(challengeToken) },
    include: { user: { include: { role: true } } },
  });
  if (
    !session ||
    !session.pendingTwoFactor ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.user.status !== 'active'
  ) {
    return { ok: false, reason: 'challenge_invalid' };
  }
  const valid = await verifyTwoFactorCode(session.userId, code);
  if (!valid) return { ok: false, reason: 'code_invalid' };

  await prisma.session.update({
    where: { id: session.id },
    data: { pendingTwoFactor: false, expiresAt: new Date(Date.now() + IDLE_MS), lastSeenAt: new Date() },
  });
  await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
  return { ok: true, token: challengeToken, user: toAuthedUser(session.user, session.id) };
}

/** userId của phiên pending theo challenge (để throttle theo user ở router). null nếu không hợp lệ. */
export async function pendingUserIdForChallenge(challengeToken: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(challengeToken) },
    select: { userId: true, pendingTwoFactor: true, revokedAt: true, expiresAt: true },
  });
  if (!session || !session.pendingTwoFactor || session.revokedAt || session.expiresAt < new Date()) return null;
  return session.userId;
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
  // 🔴 Phiên PENDING (mới qua mật khẩu, CHƯA qua 2FA) KHÔNG được truy cập API.
  if (session.pendingTwoFactor) return null;
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
