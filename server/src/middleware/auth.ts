import type { NextFunction, Request, Response } from 'express';
import { asyncHandler, forbidden, unauthorized } from '../lib/http';
import type { Permissions, RoleKeyStr } from '../security/permissions';
import { getEffectivePermissions } from '../security/rolePermissions';
import { SESSION_COOKIE, validateSession } from '../modules/auth/session.service';

/** Bắt buộc đăng nhập. Gắn req.auth + req.permissions. Chặn server-side (SEC-05). */
export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? '';
    const user = await validateSession(token);
    if (!user) throw unauthorized();
    req.auth = user;
    // 🔴 §12.1: quyền HIỆU LỰC (code-default phủ bởi override ma trận quyền, versioned) — áp thật ở mọi request.
    req.permissions = await getEffectivePermissions(user.role);
    next();
  },
);

/** Chỉ cho các vai chỉ định. Gõ URL/API trực tiếp vẫn bị chặn. */
export function requireRole(...roles: RoleKeyStr[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}

/** Chặn theo cờ quyền (masking/RBAC). VD requirePermission('viewBaby') => Marketing 403 (SEC-06). */
export function requirePermission(flag: keyof Permissions) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.permissions) return next(unauthorized());
    if (req.permissions[flag] !== true) return next(forbidden());
    next();
  };
}
