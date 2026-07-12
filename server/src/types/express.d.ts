import type { Permissions, RoleKeyStr } from '../security/permissions';

// Bổ sung kiểu cho req.auth / req.permissions (gắn bởi middleware requireAuth).
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        username: string;
        fullName: string;
        role: RoleKeyStr;
        sessionId: string;
      };
      permissions?: Permissions;
    }
  }
}

export {};
