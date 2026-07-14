// Trung tâm thông báo hoạt động nhân viên (IN-APP) cho Chủ shop.
// Nguồn dữ liệu = audit_logs append-only (chỉ đọc). Chỉ hiển thị hoạt động của NGƯỜI KHÁC.
// Gate chu_shop ở server (403 với vai khác). KHÔNG trả oldValue/newValue thô ra client.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, forbidden } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import type { RoleKeyStr } from '../../security/permissions';
import { WORK_ACTIONS, formatActivity } from './notifications.format';

export const notificationsRouter = Router();

/** Vai được nhận thông báo hoạt động. Mảng để dễ mở rộng sau (VD thêm vai quản lý). */
const OWNER_ROLES: RoleKeyStr[] = ['chu_shop'];

notificationsRouter.use(
  requireAuth,
  (req, _res, next) => {
    if (!OWNER_ROLES.includes(req.auth!.role)) {
      return next(forbidden('Chỉ chủ shop xem được thông báo.'));
    }
    next();
  },
);

/** Điều kiện feed: chỉ thao tác làm việc, của người KHÁC (loại chính viewer + loại log không có actor). */
function feedWhere(viewerId: string): Prisma.AuditLogWhereInput {
  return {
    action: { in: WORK_ACTIONS },
    userId: { not: viewerId },
    NOT: { userId: null },
  };
}

/**
 * Batch-resolve tên đối tượng theo objectType (mỗi loại tối đa 1 query — tránh N+1).
 * Trả Map key `${objectType}:${objectId}` -> tên hiển thị.
 * 🔴 Bé: KHÔNG lộ tên bé (nhạy cảm) — hiển thị theo tên KHÁCH của bé.
 */
async function resolveTargetNames(
  logs: { objectType: string; objectId: string | null }[],
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const l of logs) {
    if (!l.objectId) continue;
    const set = byType.get(l.objectType) ?? new Set<string>();
    set.add(l.objectId);
    byType.set(l.objectType, set);
  }

  const out = new Map<string, string>();
  const put = (type: string, id: string, name: string | null | undefined) => {
    if (name) out.set(`${type}:${id}`, name);
  };
  const ids = (type: string) => [...(byType.get(type) ?? [])];
  const custName = (c: { displayName: string | null; fullName: string } | null | undefined) =>
    c ? (c.displayName ?? c.fullName) : null;

  if (byType.has('customer')) {
    const rows = await prisma.customerCrm.findMany({
      where: { id: { in: ids('customer') } },
      select: { id: true, displayName: true, fullName: true },
    });
    for (const r of rows) put('customer', r.id, custName(r));
  }

  if (byType.has('organization')) {
    const rows = await prisma.organization.findMany({
      where: { id: { in: ids('organization') } },
      select: { id: true, orgName: true },
    });
    for (const r of rows) put('organization', r.id, r.orgName);
  }

  if (byType.has('follow_up')) {
    const rows = await prisma.followUp.findMany({
      where: { id: { in: ids('follow_up') } },
      select: {
        id: true,
        customer: { select: { displayName: true, fullName: true } },
        organization: { select: { orgName: true } },
      },
    });
    for (const r of rows) put('follow_up', r.id, custName(r.customer) ?? r.organization?.orgName);
  }

  // baby.create/soft_delete dùng objectType 'baby_profile'; baby.merge dùng 'baby'. Cả hai -> BabyProfile.
  const babyIds = new Set<string>([...ids('baby'), ...ids('baby_profile')]);
  if (babyIds.size > 0) {
    const rows = await prisma.babyProfile.findMany({
      where: { id: { in: [...babyIds] } },
      select: { id: true, customer: { select: { displayName: true, fullName: true } } },
    });
    for (const r of rows) {
      const name = custName(r.customer);
      if (byType.get('baby')?.has(r.id)) put('baby', r.id, name);
      if (byType.get('baby_profile')?.has(r.id)) put('baby_profile', r.id, name);
    }
  }

  if (byType.has('consultation')) {
    const rows = await prisma.consultation.findMany({
      where: { id: { in: ids('consultation') } },
      select: { id: true, customer: { select: { displayName: true, fullName: true } } },
    });
    for (const r of rows) put('consultation', r.id, custName(r.customer));
  }

  return out;
}

async function loadSeenAt(viewerId: string): Promise<Date | null> {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { activitySeenAt: true },
  });
  return viewer?.activitySeenAt ?? null;
}

// GET / — danh sách hoạt động (mới nhất trước) + tổng số chưa đọc.
const listQuerySchema = z.object({ limit: z.coerce.number().int().positive().optional() });
notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    const limit = Math.min(parsed.success ? (parsed.data.limit ?? 30) : 30, 100);
    const viewerId = req.auth!.userId;
    // 🔴 Watermark: mốc thời điểm CHẠY query. Client gửi lại làm `readUntil` khi bấm "đã đọc" =>
    // không đánh dấu đã đọc các hoạt động ĐẾN SAU lúc mở màn (tránh mất thông báo mới).
    const asOf = new Date();

    const seenAt = await loadSeenAt(viewerId);
    const logs = await prisma.auditLog.findMany({
      where: feedWhere(viewerId),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Tên nhân viên (actor) — batch resolve.
    const actorIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const actorById = new Map(actors.map((u) => [u.id, u.fullName]));

    const targetNames = await resolveTargetNames(logs);

    // Đếm ảnh bằng chứng CHƯA xóa cho các follow-up trong trang (batch — tránh N+1).
    // Chỉ áp dụng cho log gắn follow-up; dùng để bật affordance "xem ảnh" ở màn Thông báo.
    const followUpIds = [
      ...new Set(
        logs
          .filter((l) => l.objectType === 'follow_up' && l.objectId)
          .map((l) => l.objectId as string),
      ),
    ];
    const attachmentCountById = new Map<string, number>();
    if (followUpIds.length > 0) {
      const grouped = await prisma.followUpAttachment.groupBy({
        by: ['followUpId'],
        where: { followUpId: { in: followUpIds }, deletedAt: null },
        _count: { _all: true },
      });
      for (const g of grouped) attachmentCountById.set(g.followUpId, g._count._all);
    }

    const unreadCount = await prisma.auditLog.count({
      where: { ...feedWhere(viewerId), createdAt: { gt: seenAt ?? new Date(0) } },
    });

    res.json({
      unreadCount,
      asOf: asOf.toISOString(),
      items: logs.map((l) => {
        // Chỉ log gắn follow-up mới có việc cần làm để xem ảnh bằng chứng.
        const followUpId = l.objectType === 'follow_up' ? l.objectId : null;
        return {
          id: l.id,
          actorName: (l.userId && actorById.get(l.userId)) || 'Nhân viên',
          // Chỉ trả cụm mô tả đã format — KHÔNG lộ action/objectType thô hay oldValue/newValue.
          summary: formatActivity(l.action, l.newValue).verb,
          targetName: l.objectId ? (targetNames.get(`${l.objectType}:${l.objectId}`) ?? null) : null,
          createdAt: l.createdAt.toISOString(),
          isUnread: seenAt == null ? true : l.createdAt > seenAt,
          followUpId,
          attachmentCount: followUpId ? (attachmentCountById.get(followUpId) ?? 0) : 0,
        };
      }),
    });
  }),
);

// GET /unread-count — nhẹ, cho chuông poll định kỳ.
notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const viewerId = req.auth!.userId;
    const seenAt = await loadSeenAt(viewerId);
    const unreadCount = await prisma.auditLog.count({
      where: { ...feedWhere(viewerId), createdAt: { gt: seenAt ?? new Date(0) } },
    });
    res.json({ unreadCount });
  }),
);

// POST /read — đánh dấu đã đọc TỚI mốc watermark (`readUntil` = `asOf` client nhận lúc mở màn).
// Kẹp không vượt quá now (chống client gửi mốc tương lai) và KHÔNG lùi về quá khứ so với mốc đã lưu
// (max) => hoạt động đến SAU lúc mở màn vẫn còn unread; không bao giờ "bỏ đánh dấu" cái đã đọc.
const readSchema = z.object({ readUntil: z.string().datetime().optional() });
notificationsRouter.post(
  '/read',
  asyncHandler(async (req, res) => {
    const parsed = readSchema.safeParse(req.body ?? {});
    const now = new Date();
    const viewerId = req.auth!.userId;

    // readUntil hợp lệ thì dùng (kẹp <= now); không có thì fallback = now (tương thích cũ).
    let target = now;
    if (parsed.success && parsed.data.readUntil) {
      const ru = new Date(parsed.data.readUntil);
      if (!Number.isNaN(ru.getTime()) && ru < now) target = ru;
    }

    // 🔴 Atomic (chống race giữa 2 tab): chỉ TIẾN mốc — cập nhật khi mốc hiện tại NULL hoặc CŨ HƠN target.
    // Nếu count=0 (mốc đã mới hơn) => không làm gì, tránh read-then-write ghi đè lùi mốc.
    await prisma.user.updateMany({
      where: { id: viewerId, OR: [{ activitySeenAt: null }, { activitySeenAt: { lt: target } }] },
      data: { activitySeenAt: target },
    });
    res.json({ ok: true });
  }),
);
