import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../lib/env';
import { asyncHandler, badRequest, tooManyRequests, unauthorized } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { permissionsFor } from '../../security/permissions';
import { writeAudit } from '../../security/audit';
import { SESSION_COOKIE, login, revokeSession } from './session.service';
import { loginThrottle, throttleKey } from './login-throttle';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu tên đăng nhập hoặc mật khẩu.');

    // 🔴 SEC-FIX-4 (AUTH-03/04): khóa tạm theo (username+IP) sau nhiều lần sai. Kiểm TRƯỚC khi thử mật khẩu.
    const key = throttleKey(parsed.data.username, req.ip);
    const lock = loginThrottle.isLocked(key);
    if (lock.locked) {
      // Ghi audit lần bị khóa (KHÔNG log mật khẩu — chỉ username + IP).
      await writeAudit({
        userId: null,
        action: 'auth.login_locked',
        objectType: 'user',
        ip: req.ip,
        newValue: { username: parsed.data.username, retryAfterMs: lock.retryAfterMs },
      });
      throw tooManyRequests('Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
    }

    const result = await login(parsed.data.username, parsed.data.password, {
      device: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    // AUTH-10: KHÔNG tiết lộ tài khoản có tồn tại hay không.
    if (!result) {
      // Đếm 1 lần sai (áp cho mọi username kể cả không tồn tại => không lộ tồn tại qua hành vi khóa).
      const st = loginThrottle.recordFailure(key);
      await writeAudit({
        userId: null,
        action: 'auth.login_failed',
        objectType: 'user',
        ip: req.ip,
        newValue: { username: parsed.data.username, fails: st.fails, locked: st.locked },
      });
      throw unauthorized('Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    // Thành công => xóa bộ đếm sai của (username+IP).
    loginThrottle.recordSuccess(key);

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
      permissions: permissionsFor(result.user.role),
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
      permissions: req.permissions,
    });
  }),
);
