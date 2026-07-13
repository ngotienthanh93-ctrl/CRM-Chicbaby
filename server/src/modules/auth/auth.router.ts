import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../lib/env';
import { asyncHandler, badRequest, tooManyRequests, unauthorized } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { getEffectivePermissions } from '../../security/rolePermissions';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import { SESSION_COOKIE, login, revokeSession } from './session.service';
import { throttleKey } from './login-throttle';
import { reserveAttemptDb, recordSuccessDb } from './throttle-store';

export const authRouter = Router();

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

    const result = await login(parsed.data.username, parsed.data.password, {
      device: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    // AUTH-10: KHÔNG tiết lộ tài khoản có tồn tại hay không. Lần thử đã được đếm khi đặt chỗ.
    if (!result) {
      await writeAudit({
        userId: null,
        action: 'auth.login_failed',
        objectType: 'user',
        ip: req.ip,
        newValue: { username: parsed.data.username, fails: reservation.fails, locked: reservation.locked },
      });
      throw unauthorized('Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    // Thành công => xóa bộ đếm sai của (username+IP) (hủy lần đặt chỗ vừa cộng).
    await recordSuccessDb('login', key);

    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      // 🔴 SEC-FIX-5 (CSRF CWE-352): 'strict' — công cụ nội bộ, client 5173 & server 4000 cùng site
      // (localhost) nên KHÔNG vỡ ở dev; chặn gửi cookie phiên trong request cross-site (chống CSRF).
      sameSite: 'strict',
      secure: env.isProd,
      // "Ghi nhớ" KHÔNG tick sẵn: chỉ set maxAge dài khi remember=true.
      maxAge: parsed.data.remember ? 7 * 24 * 60 * 60 * 1000 : undefined,
    });
    await writeAudit({
      userId: result.user.userId,
      action: 'auth.login',
      objectType: 'user',
      objectId: result.user.userId,
      ip: req.ip,
    });

    res.json({
      user: {
        id: result.user.userId,
        username: result.user.username,
        fullName: result.user.fullName,
        role: result.user.role,
      },
      // 🔴 §12.1: quyền HIỆU LỰC (đã áp override ma trận quyền versioned).
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
