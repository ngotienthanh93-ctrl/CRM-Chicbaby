// 🔴 §12.1 SCR-13 — Quản trị người dùng & phân quyền (SEC-04..16, ADM-01..05).
// CHỈ Chủ shop/Quản trị (manageUsers). Mọi mutation NHẠY CẢM yêu cầu nhập lại mật khẩu (AUTH-12) +
// ghi audit append-only. KHÔNG bao giờ trả passwordHash. KHÔNG xóa cứng user (ADM-04 — chỉ disable).
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit, scrubSensitive } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import { hashPassword } from '../../lib/crypto';
import { isRoleKey, type RoleKeyStr } from '../../security/permissions';
import {
  getRoleMatrix,
  saveRoleOverrides,
  roleOverridesSchema,
} from '../../security/rolePermissions';

export const adminRouter = Router();
// 🔴 Toàn bộ module chỉ cho vai có quyền quản trị người dùng (chỉ chu_shop). Gõ URL trực tiếp vẫn bị chặn (SEC-05).
adminRouter.use(requireAuth, requirePermission('manageUsers'));

/** Trạng thái follow-up ĐÃ ĐÓNG (không bàn giao lại). Các trạng thái khác coi là ĐANG MỞ. */
const CLOSED_FOLLOWUP_STATUSES = ['dong', 'da_mua_lai'] as const;

/** 🔴 Xác minh lại mật khẩu actor cho thao tác nhạy cảm; CÓ chống brute-force (CWE-307): sai => 403, đủ ngưỡng => 429. */
async function requireReauth(
  actorId: string,
  password: string,
  ip: string | undefined,
): Promise<void> {
  await verifyReauth(actorId, password, ip);
}

/** Số chu_shop ĐANG hoạt động KHÁC `excludeId` — guard chống mất chủ shop cuối (đọc TRONG transaction). */
function otherActiveOwners(tx: Prisma.TransactionClient, excludeId: string): Promise<number> {
  return tx.user.count({
    where: { status: 'active', role: { key: 'chu_shop' }, id: { not: excludeId } },
  });
}

/** Đổi RoleKey -> roleId (bảng roles). */
async function roleIdByKey(key: RoleKeyStr): Promise<string> {
  const role = await prisma.role.findUnique({ where: { key } });
  if (!role) throw badRequest('Vai không tồn tại trong hệ thống.');
  return role.id;
}

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ============================================================
// NGƯỜI DÙNG
// ============================================================

// GET /users — tất cả user (kể cả disabled). KHÔNG trả passwordHash.
adminRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const [users, sessionCounts] = await Promise.all([
      prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: 'asc' } }),
      prisma.session.groupBy({
        by: ['userId'],
        where: { revokedAt: null, expiresAt: { gt: now } },
        _count: { _all: true },
      }),
    ]);
    const activeByUser = new Map(sessionCounts.map((s) => [s.userId, s._count._all]));
    res.json({
      items: users.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        roleKey: u.role.key,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        activeSessionCount: activeByUser.get(u.id) ?? 0,
        createdAt: u.createdAt,
      })),
    });
  }),
);

// 🔴 CWE-521: chính sách mật khẩu tối thiểu (mật khẩu MỚI của người dùng — không áp cho reauth actor).
const MIN_PASSWORD_LEN = 8;
const newPasswordField = z.string().min(MIN_PASSWORD_LEN, 'Mật khẩu tối thiểu 8 ký tự.');

// POST /users — tạo user. Reauth. 409 nếu username tồn tại.
const createUserSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().min(1),
  roleKey: z.string().min(1),
  initialPassword: newPasswordField,
  password: z.string().min(1),
});
adminRouter.post(
  '/users',
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest('Thiếu thông tin tạo người dùng (mật khẩu ban đầu tối thiểu 8 ký tự).');
    const { username, fullName, roleKey, initialPassword, password } = parsed.data;
    if (!isRoleKey(roleKey)) throw badRequest('Vai không hợp lệ.');
    await requireReauth(req.auth!.userId, password, req.ip);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) throw conflict('Tên đăng nhập đã tồn tại.');
    const roleId = await roleIdByKey(roleKey);

    let user;
    try {
      // create + audit NGUYÊN TỬ (không có user tạo ra mà thiếu audit).
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username,
            fullName,
            roleId,
            passwordHash: hashPassword(initialPassword),
            createdBy: req.auth!.userId,
          },
          include: { role: true },
        });
        await writeAudit(
          {
            userId: req.auth!.userId,
            action: 'user.create',
            objectType: 'user',
            objectId: created.id,
            newValue: { username, fullName, roleKey },
          },
          tx,
        );
        return created;
      });
    } catch (e) {
      // Đua tạo trùng username => unique constraint (P2002) => 409.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw conflict('Tên đăng nhập đã tồn tại.');
      }
      throw e;
    }

    res.json({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleKey: user.role.key,
      status: user.status,
    });
  }),
);

// PUT /users/:id — sửa fullName/roleKey. Reauth. Đổi role => thu hồi NGAY mọi phiên (ADM-01).
const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  roleKey: z.string().min(1).optional(),
  password: z.string().min(1),
});
adminRouter.put(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu cập nhật không hợp lệ.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw notFound('Không tìm thấy người dùng.');

    const data: Prisma.UserUpdateInput = {};
    const oldRoleKey = target.role.key;
    let newRoleKey: RoleKeyStr | null = null;

    if (parsed.data.fullName !== undefined) data.fullName = parsed.data.fullName;

    if (parsed.data.roleKey !== undefined && parsed.data.roleKey !== oldRoleKey) {
      if (!isRoleKey(parsed.data.roleKey)) throw badRequest('Vai không hợp lệ.');
      // 🔴 KHÔNG đổi vai của CHÍNH MÌNH (tránh tự nâng/hạ quyền vòng).
      if (id === req.auth!.userId) throw badRequest('Không thể tự đổi vai của chính mình.');
      const roleId = await roleIdByKey(parsed.data.roleKey);
      data.role = { connect: { id: roleId } };
      newRoleKey = parsed.data.roleKey;
    }

    if (Object.keys(data).length === 0) {
      res.json({ ok: true, changed: false });
      return;
    }

    const now = new Date();
    // 🔴 Serializable: guard "chủ shop cuối" + mutation + audit NGUYÊN TỬ (chống race demote/lock đồng thời).
    await prisma.$transaction(
      async (tx) => {
        // 🔴 KHÔNG hạ chu_shop hoạt động CUỐI CÙNG — RE-COUNT bên trong transaction.
        if (newRoleKey && oldRoleKey === 'chu_shop' && (await otherActiveOwners(tx, id)) < 1) {
          throw badRequest('Không thể đổi vai của chủ shop hoạt động cuối cùng.');
        }
        await tx.user.update({ where: { id }, data });
        if (newRoleKey) {
          // 🔴 ADM-01: đổi quyền => thu hồi NGAY mọi phiên của user đó.
          await tx.session.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: now },
          });
        }
        // 🔴 SEC-12: audit TRONG cùng transaction (không có mutation không audit).
        await writeAudit(
          {
            userId: req.auth!.userId,
            action: newRoleKey ? 'user.role_change' : 'user.update',
            objectType: 'user',
            objectId: id,
            oldValue: newRoleKey ? { roleKey: oldRoleKey } : undefined,
            newValue: newRoleKey
              ? { roleKey: newRoleKey, fullName: parsed.data.fullName ?? undefined }
              : { fullName: parsed.data.fullName },
            reason: newRoleKey ? 'Đổi vai — đã thu hồi mọi phiên NGAY (ADM-01)' : undefined,
          },
          tx,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    res.json({ ok: true, changed: true, roleChanged: newRoleKey != null });
  }),
);

// POST /users/:id/lock — khóa + thu hồi NGAY mọi phiên & thiết bị tin cậy (ADM-02/SEC-14).
const passwordSchema = z.object({ password: z.string().min(1) });
adminRouter.post(
  '/users/:id/lock',
  asyncHandler(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const id = String(req.params.id);
    if (id === req.auth!.userId) throw badRequest('Không thể tự khóa tài khoản của chính mình.');

    const now = new Date();
    // 🔴 Serializable: guard "chủ shop cuối" + khóa + thu hồi phiên/thiết bị + audit NGUYÊN TỬ (chống race).
    await prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({ where: { id }, include: { role: true } });
        if (!target) throw notFound('Không tìm thấy người dùng.');
        // 🔴 KHÔNG khóa chu_shop hoạt động CUỐI CÙNG — RE-COUNT bên trong transaction.
        if (target.role.key === 'chu_shop' && (await otherActiveOwners(tx, id)) < 1) {
          throw badRequest('Không thể khóa chủ shop hoạt động cuối cùng.');
        }
        await tx.user.update({ where: { id }, data: { status: 'disabled' } });
        // 🔴 ADM-02/SEC-14: thu hồi NGAY mọi phiên & thiết bị tin cậy.
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.trustedDevice.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        await writeAudit(
          {
            userId: req.auth!.userId,
            action: 'user.lock',
            objectType: 'user',
            objectId: id,
            reason: 'Khóa tài khoản + thu hồi NGAY phiên & thiết bị (ADM-02/SEC-14)',
          },
          tx,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.json({ ok: true });
  }),
);

// POST /users/:id/unlock — mở khóa.
adminRouter.post(
  '/users/:id/unlock',
  asyncHandler(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('Không tìm thấy người dùng.');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'active' } });
      await writeAudit(
        { userId: req.auth!.userId, action: 'user.unlock', objectType: 'user', objectId: id },
        tx,
      );
    });
    res.json({ ok: true });
  }),
);

// POST /users/:id/reset-password — đặt lại mật khẩu + thu hồi mọi phiên (buộc đăng nhập lại). KHÔNG log mật khẩu.
const resetPwSchema = z.object({ newPassword: newPasswordField, password: z.string().min(1) });
adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const parsed = resetPwSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest('Mật khẩu mới tối thiểu 8 ký tự; cần cả mật khẩu xác minh.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('Không tìm thấy người dùng.');

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: hashPassword(parsed.data.newPassword) },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAudit(
        {
          userId: req.auth!.userId,
          action: 'user.reset_password',
          objectType: 'user',
          objectId: id,
          reason: 'Đặt lại mật khẩu — đã thu hồi mọi phiên (buộc đăng nhập lại)',
        },
        tx,
      );
    });
    res.json({ ok: true });
  }),
);

// POST /users/:id/handoff — chuyển giao khách/việc đang phụ trách (ADM-03/SEC-15).
const handoffSchema = z.object({ toUserId: z.string().min(1), password: z.string().min(1) });
adminRouter.post(
  '/users/:id/handoff',
  asyncHandler(async (req, res) => {
    const parsed = handoffSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu người nhận bàn giao hoặc mật khẩu xác minh.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const id = String(req.params.id);
    const { toUserId } = parsed.data;
    if (toUserId === id) throw badRequest('Người nhận bàn giao phải khác người bàn giao.');
    const [from, to] = await Promise.all([
      prisma.user.findUnique({ where: { id } }),
      prisma.user.findUnique({ where: { id: toUserId } }),
    ]);
    if (!from) throw notFound('Không tìm thấy người bàn giao.');
    if (!to || to.status !== 'active')
      throw badRequest('Người nhận bàn giao không hợp lệ hoặc đang bị khóa.');

    const { reassigned, resetClaims } = await prisma.$transaction(async (tx) => {
      // Chuyển follow-up ĐANG MỞ (status ∉ đã đóng) sang người nhận.
      const reassigned = await tx.followUp.updateMany({
        where: { assigneeId: id, status: { notIn: [...CLOSED_FOLLOWUP_STATUSES] } },
        data: { assigneeId: toUserId },
      });
      // Reset claim còn treo của người bàn giao (tránh khóa việc vĩnh viễn khi họ nghỉ).
      const resetClaims = await tx.followUp.updateMany({
        where: { claimedBy: id },
        data: {
          claimState: 'unclaimed',
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      await writeAudit(
        {
          userId: req.auth!.userId,
          action: 'user.handoff',
          objectType: 'user',
          objectId: id,
          newValue: {
            toUserId,
            reassignedFollowUps: reassigned.count,
            resetClaims: resetClaims.count,
          },
          reason: 'Chuyển giao việc đang phụ trách (ADM-03/SEC-15)',
        },
        tx,
      );
      return { reassigned, resetClaims };
    });
    res.json({
      ok: true,
      reassignedFollowUps: reassigned.count,
      resetClaims: resetClaims.count,
    });
  }),
);

// ============================================================
// PHIÊN & THIẾT BỊ TIN CẬY
// ============================================================

// GET /users/:id/sessions — phiên active + thiết bị tin cậy.
adminRouter.get(
  '/users/:id/sessions',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('Không tìm thấy người dùng.');
    const now = new Date();
    const [sessions, devices] = await Promise.all([
      prisma.session.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { lastSeenAt: 'desc' },
      }),
      prisma.trustedDevice.findMany({
        where: { userId: id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        device: s.device,
        ip: s.ip,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
      })),
      trustedDevices: devices.map((d) => ({
        id: d.id,
        deviceLabel: d.deviceLabel,
        lastUsedAt: d.lastUsedAt,
        createdAt: d.createdAt,
      })),
    });
  }),
);

// POST /sessions/:id/revoke — thu hồi 1 phiên.
adminRouter.post(
  '/sessions/:id/revoke',
  asyncHandler(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const sid = String(req.params.id);
    await prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count === 0) throw notFound('Không tìm thấy phiên đang hoạt động.');
      await writeAudit(
        { userId: req.auth!.userId, action: 'user.session_revoke', objectType: 'session', objectId: sid },
        tx,
      );
    });
    res.json({ ok: true });
  }),
);

// POST /users/:id/revoke-all — "đăng xuất mọi thiết bị": thu hồi mọi phiên + mọi thiết bị tin cậy.
adminRouter.post(
  '/users/:id/revoke-all',
  asyncHandler(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);

    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('Không tìm thấy người dùng.');
    const now = new Date();
    const { sessions, devices } = await prisma.$transaction(async (tx) => {
      const sessions = await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      const devices = await tx.trustedDevice.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAudit(
        {
          userId: req.auth!.userId,
          action: 'user.revoke_all',
          objectType: 'user',
          objectId: id,
          newValue: { revokedSessions: sessions.count, revokedDevices: devices.count },
          reason: 'Đăng xuất mọi thiết bị',
        },
        tx,
      );
      return { sessions, devices };
    });
    res.json({ ok: true, revokedSessions: sessions.count, revokedDevices: devices.count });
  }),
);

// ============================================================
// NHẬT KÝ HOẠT ĐỘNG + LỊCH SỬ ĐỔI QUYỀN
// ============================================================

// GET /audit-logs — lọc; mới nhất trước; kèm username actor; scrub phòng thủ (SEC-12).
const auditQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  objectType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
adminRouter.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Tham số lọc nhật ký không hợp lệ.');
    const q = parsed.data;
    const limit = Math.min(q.limit ?? 50, 200);

    const where: Prisma.AuditLogWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = q.action;
    if (q.objectType) where.objectType = q.objectType;
    const from = parseDate(q.from);
    const to = parseDate(q.to);
    if (from || to) {
      where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
    const actors = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, fullName: true },
        })
      : [];
    const byId = new Map(actors.map((u) => [u.id, u]));

    res.json({
      limit,
      items: logs.map((l) => ({
        id: l.id,
        userId: l.userId,
        actorUsername: l.userId ? (byId.get(l.userId)?.username ?? null) : null,
        actorFullName: l.userId ? (byId.get(l.userId)?.fullName ?? null) : null,
        action: l.action,
        objectType: l.objectType,
        objectId: l.objectId,
        // 🔴 SEC-12: scrub phòng thủ lần nữa khi trả ra (dù đã scrub lúc ghi).
        oldValue: scrubSensitive(l.oldValue),
        newValue: scrubSensitive(l.newValue),
        reason: l.reason,
        ip: l.ip,
        device: l.device,
        createdAt: l.createdAt,
      })),
    });
  }),
);

// ============================================================
// MA TRẬN VAI & QUYỀN
// ============================================================

// GET /roles — ma trận Vai × Hành động + quyền field nhạy cảm (hiệu lực + code-default để reset).
adminRouter.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    res.json(await getRoleMatrix());
  }),
);

// PUT /roles — lưu override versioned. Reauth. TỪ CHỐI chu_shop (khóa cứng).
const putRolesSchema = z.object({ overrides: roleOverridesSchema, password: z.string().min(1) });
adminRouter.put(
  '/roles',
  asyncHandler(async (req, res) => {
    const parsed = putRolesSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu ma trận quyền không hợp lệ.');
    await requireReauth(req.auth!.userId, parsed.data.password, req.ip);
    const matrix = await saveRoleOverrides(parsed.data.overrides, req.auth!.userId);
    res.json(matrix);
  }),
);
