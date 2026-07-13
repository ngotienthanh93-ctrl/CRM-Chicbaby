import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../lib/env';
import { asyncHandler, badRequest, tooManyRequests, unauthorized } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { getEffectivePermissions } from '../../security/rolePermissions';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import {
  SESSION_COOKIE,
  TRUST_COOKIE,
  login,
  completeTwoFactorLogin,
  pendingUserIdForChallenge,
  revokeSession,
} from './session.service';
import { trustDevice as trustThisDevice } from './twofa.service';
import { throttleKey } from './login-throttle';
import { reserveAttemptDb, recordSuccessDb } from './throttle-store';

export const authRouter = Router();

/** Cookie phiên (đã xác thực đầy đủ) dùng chung tùy chọn. */
function sessionCookieOpts(remember: boolean) {
  return {
    httpOnly: true,
    // 🔴 SEC-FIX-5 (CSRF CWE-352): 'strict' — công cụ nội bộ cùng site (localhost) nên KHÔNG vỡ ở dev.
    sameSite: 'strict' as const,
    secure: env.isProd,
    maxAge: remember ? 7 * 24 * 60 * 60 * 1000 : undefined,
  };
}

const loginSchema = z.object({
  // 🔴 max(100): chặn username khổng lồ (khóa throttle/DoS) — user thật ngắn hơn nhiều.
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional(),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu tên đăng nhập hoặc mật khẩu.');

    // 🔴 SEC-FIX-4 (AUTH-03/04): khóa tạm theo (username+IP). ĐẶT CHỖ (đếm) NGUYÊN TỬ TRƯỚC khi thử mật khẩu
    // ⇒ đóng cửa sổ burst song song. Đang khóa => 429; mật khẩu ĐÚNG => xóa đếm ở dưới.
    const key = throttleKey(parsed.data.username, req.ip);
    const reservation = await reserveAttemptDb('login', key);
    if (!reservation.allowed) {
      // Ghi audit lần bị khóa (KHÔNG log mật khẩu — chỉ username + IP).
      await writeAudit({
        userId: null,
        action: 'auth.login_locked',
        objectType: 'user',
        ip: req.ip,
        newValue: { username: parsed.data.username, retryAfterMs: reservation.retryAfterMs },
      });
      throw tooManyRequests('Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
    }

    const trustToken = (req.cookies?.[TRUST_COOKIE] as string | undefined) ?? undefined;
    const outcome = await login(parsed.data.username, parsed.data.password, {
      device: req.get('user-agent') ?? undefined,
      ip: req.ip,
      trustToken,
    });
    // AUTH-10: KHÔNG tiết lộ tài khoản có tồn tại hay không. Lần thử đã được đếm khi đặt chỗ.
    if (!outcome) {
      await writeAudit({
        userId: null,
        action: 'auth.login_failed',
        objectType: 'user',
        ip: req.ip,
        newValue: { username: parsed.data.username, fails: reservation.fails, locked: reservation.locked },
      });
      throw unauthorized('Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    // Mật khẩu ĐÚNG (dù có cần 2FA hay không) => xóa bộ đếm sai của (username+IP).
    await recordSuccessDb('login', key);

    // 🔴 2FA BẬT + thiết bị chưa tin cậy ⇒ CHƯA cấp phiên; trả challenge để client nhập TOTP (bước 2).
    if (outcome.kind === 'twofa_required') {
      res.json({ twoFactorRequired: true, challenge: outcome.challengeToken });
      return;
    }

    res.cookie(SESSION_COOKIE, outcome.token, sessionCookieOpts(parsed.data.remember === true));
    await writeAudit({
      userId: outcome.user.userId,
      action: 'auth.login',
      objectType: 'user',
      objectId: outcome.user.userId,
      ip: req.ip,
    });

    res.json({
      user: {
        id: outcome.user.userId,
        username: outcome.user.username,
        fullName: outcome.user.fullName,
        role: outcome.user.role,
      },
      // 🔴 §12.1: quyền HIỆU LỰC (đã áp override ma trận quyền versioned).
      permissions: await getEffectivePermissions(outcome.user.role),
    });
  }),
);

// 🔴 Đăng nhập BƯỚC 2 (2FA): nhập mã TOTP/backup cho challenge (phiên pending). Throttle TOÀN CỤC theo userId
// (không kèm IP) chống dò mã 6 số kể cả xoay IP. Đúng ⇒ nâng cấp phiên + set cookie phiên; tùy chọn "tin thiết bị này".
const twofaLoginSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().min(1).max(20),
  trustDevice: z.boolean().optional(),
  remember: z.boolean().optional(),
});
authRouter.post(
  '/login/2fa',
  asyncHandler(async (req, res) => {
    const parsed = twofaLoginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu challenge hoặc mã xác thực.');

    // Xác định user của challenge để throttle theo (userId+IP). Challenge hỏng ⇒ 401 (không lộ chi tiết).
    const userId = await pendingUserIdForChallenge(parsed.data.challenge);
    if (!userId) throw unauthorized('Phiên xác thực không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');

    // 🔴 CWE-307: throttle mã 2FA theo userId TOÀN CỤC (KHÔNG kèm IP) — kẻ có mật khẩu KHÔNG thể xoay IP để
    // dò mã 6 số không giới hạn. Đếm gộp mọi lần thử (mọi IP/mọi challenge) của user ⇒ khóa sau softThreshold.
    const key = `user:${userId}`;
    const reservation = await reserveAttemptDb('twofa', key);
    if (!reservation.allowed) {
      await writeAudit({
        userId,
        action: 'auth.twofa_locked',
        objectType: 'user',
        objectId: userId,
        ip: req.ip,
        newValue: { retryAfterMs: reservation.retryAfterMs },
      });
      throw tooManyRequests('Bạn đã nhập sai mã quá nhiều lần. Vui lòng thử lại sau ít phút.');
    }

    const result = await completeTwoFactorLogin(parsed.data.challenge, parsed.data.code);
    if (!result.ok) {
      await writeAudit({
        userId,
        action: 'auth.twofa_failed',
        objectType: 'user',
        objectId: userId,
        ip: req.ip,
        newValue: { reason: result.reason },
      });
      throw unauthorized('Mã xác thực không đúng.');
    }
    await recordSuccessDb('twofa', key);

    res.cookie(SESSION_COOKIE, result.token, sessionCookieOpts(parsed.data.remember === true));
    // Tùy chọn: tin thiết bị này (bỏ qua 2FA trong hạn cấu hình) — set cookie tin cậy httpOnly.
    if (parsed.data.trustDevice === true) {
      const { token: tt, maxAgeMs } = await trustThisDevice(userId, req.get('user-agent') ?? null);
      res.cookie(TRUST_COOKIE, tt, {
        httpOnly: true,
        sameSite: 'strict',
        secure: env.isProd,
        maxAge: maxAgeMs,
      });
    }
    await writeAudit({
      userId: result.user.userId,
      action: 'auth.login',
      objectType: 'user',
      objectId: result.user.userId,
      ip: req.ip,
      newValue: { via: '2fa', trustedDevice: parsed.data.trustDevice === true },
    });

    res.json({
      user: {
        id: result.user.userId,
        username: result.user.username,
        fullName: result.user.fullName,
        role: result.user.role,
      },
      permissions: await getEffectivePermissions(result.user.role),
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? '';
    await revokeSession(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    res.json({
      user: {
        id: auth.userId,
        username: auth.username,
        fullName: auth.fullName,
        role: auth.role,
      },
      // req.permissions do requireAuth gắn = quyền HIỆU LỰC (getEffectivePermissions).
      permissions: req.permissions,
    });
  }),
);

// 🔴 §12.1 (AUTH-12): xác minh LẠI mật khẩu cho thao tác nhạy cảm (dùng chung cho SCR-13).
const reauthSchema = z.object({ password: z.string().min(1) });
authRouter.post(
  '/reauth',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    // 🔴 CWE-307: reauth có chống brute-force (khóa theo userId+IP, audit lần sai). Sai => 403/429.
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    // audit tự scrub 'password' — không log mật khẩu.
    await writeAudit({
      userId: req.auth!.userId,
      action: 'auth.reauth',
      objectType: 'user',
      objectId: req.auth!.userId,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);
