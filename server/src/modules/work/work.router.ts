import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { formatVnDate, formatVnDateTime, vnToday } from '../../lib/datetime';
import { maskPhone } from '../../security/masking';
import { serializeBaby, serializeFollowUpContent } from '../../security/serialize';
import { pickAgencyContact } from '../../engines/replenishment';
import { serializeConfirmableBaby, workTargetIds } from './work.helpers';

export const workRouter = Router();

const OPEN_STATUSES = ['cho_toi_han', 'den_han', 'da_lien_he', 'hen_lai'] as const;

const querySchema = z.object({
  scope: z.enum(['mine', 'team']).default('mine'),
});

workRouter.get(
  '/today',
  requireAuth,
  // 🔴 FIX-1: chỉ vai xử lý việc mới xem "Việc hôm nay" (nội dung có thể chứa tên bé).
  // Marketing & tro_ly_du_lieu => 403 (SEC-06).
  requirePermission('processWork'),
  asyncHandler(async (req, res) => {
    const { scope } = querySchema.parse(req.query);
    const auth = req.auth!;
    const perms = req.permissions!;
    const now = new Date();
    const today = vnToday(now);

    const whereBase = {
      isHoldout: false, // 🔴 WORK-02: việc holdout KHÔNG hiện
      status: { in: [...OPEN_STATUSES] },
      ...(scope === 'mine' ? { assigneeId: auth.userId } : {}),
    };

    const followUps = await prisma.followUp.findMany({
      where: whereBase,
      include: {
        customer: {
          include: {
            phones: true,
            babies: { where: { deletedAt: null } },
            externalIdentities: true,
          },
        },
        organization: { include: { contacts: true } },
        reminderSources: true,
      },
    });

    // last purchase per customer (gộp mọi mã KV)
    const kvIds = followUps.flatMap(
      (f) => f.customer?.externalIdentities.map((e) => e.externalCustomerId) ?? [],
    );
    const lastPurchaseByKv = new Map<string, Date>();
    if (kvIds.length > 0) {
      const invs = await prisma.kvInvoice.findMany({
        where: { kvCustomerId: { in: kvIds }, status: 'completed' },
        select: { kvCustomerId: true, purchaseDate: true },
      });
      for (const inv of invs) {
        if (!inv.kvCustomerId) continue;
        const cur = lastPurchaseByKv.get(inv.kvCustomerId);
        if (!cur || inv.purchaseDate > cur) lastPurchaseByKv.set(inv.kvCustomerId, inv.purchaseDate);
      }
    }

    const cards = followUps.map((f) => {
      const overdue = f.dueDate.getTime() < today.getTime();
      let rank = f.priority;
      if (overdue && rank > 2) rank = 2; // quá hạn nâng ưu tiên (nhưng at_risk vẫn 1)

      // SĐT + tên hiển thị
      let targetName = 'Không rõ';
      let phone: string | null = null;
      let phoneOf: string | null = null;
      let babies: unknown[] = [];
      // §11.1: danh sách bé của khách để hành động "Xác nhận bé" (chỉ khi có quyền xem bé).
      let confirmableBabies: { id: string; displayName: string }[] = [];
      let lastPurchaseAt: Date | null = null;

      if (f.targetType === 'customer' && f.customer) {
        targetName = f.customer.displayName ?? f.customer.fullName;
        const primary = f.customer.phones.find((p) => p.isPrimary) ?? f.customer.phones[0];
        phone = primary ? maskPhone(primary.phoneRaw, perms.viewSensitive) : null;
        // hồ sơ bé chỉ khi CONFIRMED và có quyền
        const confirmedBabyIds = new Set(
          f.reminderSources
            .filter((s) => s.babyKey !== 'customer_level' && s.assignmentStatus !== 'suggested')
            .map((s) => s.babyId)
            .filter((x): x is string => !!x),
        );
        if (perms.viewBaby && confirmedBabyIds.size > 0) {
          babies = f.customer.babies
            .filter((b) => confirmedBabyIds.has(b.id))
            .map((b) => serializeBaby(b, perms, now));
        }
        // §11.1: toàn bộ bé của khách (id + tên hiển thị theo masking) để chọn khi "Xác nhận bé".
        if (perms.viewBaby) {
          confirmableBabies = f.customer.babies.map((b) => serializeConfirmableBaby(b, perms));
        }
        for (const e of f.customer.externalIdentities) {
          const lp = lastPurchaseByKv.get(e.externalCustomerId);
          if (lp && (!lastPurchaseAt || lp > lastPurchaseAt)) lastPurchaseAt = lp;
        }
      } else if (f.targetType === 'organization' && f.organization) {
        targetName = f.organization.orgName;
        // 🔴 UAT-58: đại lý hiện SĐT NGƯỜI ĐẶT HÀNG (fallback isPrimary)
        const contact = pickAgencyContact(
          f.organization.contacts.map((c) => ({
            role: c.role,
            name: c.name,
            phone: c.phone,
            isPrimary: c.isPrimary,
          })),
        );
        phone = contact ? maskPhone(contact.phone, perms.viewSensitive) : null;
        phoneOf = contact ? `${contact.name} (${roleVi(contact.role)})` : null;
        lastPurchaseAt = f.organization.lastPurchaseAt;
      }

      const ids = workTargetIds(f);
      return {
        id: f.id,
        targetType: f.targetType,
        reminderType: f.reminderType,
        // §11.1: id đối tượng để SCR-02 gọi hành động inline (Xác nhận bé / Tạm dừng cảnh báo).
        customerId: ids.customerId,
        organizationId: ids.organizationId,
        targetName,
        phone,
        phoneOf,
        // 🔴 FIX-1 (phòng vệ theo tầng): không lộ tên bé qua content nếu thiếu quyền.
        content: serializeFollowUpContent(perms, {
          reminderType: f.reminderType,
          targetType: f.targetType,
          content: f.content,
        }),
        dueDate: formatVnDate(f.dueDate),
        overdue,
        status: f.status,
        priorityRank: rank,
        badge: badgeFor(f),
        claim: {
          state: f.claimState,
          by: f.claimedBy,
          since: f.claimedAt ? formatVnDateTime(f.claimedAt) : null,
        },
        babies,
        // §11.1: bé để chọn khi "Xác nhận bé" (suggested -> confirmed qua followups/:id/confirm-baby).
        confirmableBabies,
        lastPurchaseAt: lastPurchaseAt ? formatVnDate(lastPurchaseAt) : null,
        canMentionBabyName: babies.length > 0,
      };
    });

    cards.sort((a, b) => {
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      return a.dueDate.localeCompare(b.dueDate);
    });

    // KPI (số ĐÚNG, đã loại holdout)
    const atRisk = cards.filter((c) => c.priorityRank === 1).length;
    const overdueCount = cards.filter((c) => c.overdue).length;
    const doneToday = await prisma.followUp.count({
      where: {
        isHoldout: false,
        status: { in: ['da_mua_lai', 'dong'] },
        updatedAt: { gte: today },
        ...(scope === 'mine' ? { assigneeId: auth.userId } : {}),
      },
    });

    res.json({
      scope,
      updatedAt: formatVnDateTime(now),
      kpi: {
        atRisk,
        overdue: overdueCount,
        needCall: cards.length,
        doneToday,
      },
      items: cards,
    });
  }),
);

function badgeFor(f: {
  targetType: string;
  reminderType: string;
  reminderSources: { assignmentStatus: string }[];
}): { level: string; label: string } {
  if (f.targetType === 'organization') {
    if (f.reminderType === 'agency_investigation') return { level: 'at_risk', label: 'Nguy cơ mất' };
    return { level: 'agency', label: 'Đại lý' };
  }
  const statuses = f.reminderSources.map((s) => s.assignmentStatus);
  if (statuses.includes('confirmed') || statuses.includes('auto_assigned'))
    return { level: 'confirmed', label: 'Đã xác nhận bé' };
  if (statuses.includes('suggested')) return { level: 'suggested', label: 'Gợi ý bé' };
  return { level: 'customer_level', label: 'Cấp khách' };
}

function roleVi(role: string): string {
  switch (role) {
    case 'nguoi_dat_hang':
      return 'người đặt hàng';
    case 'chu_shop':
      return 'chủ shop';
    case 'ke_toan':
      return 'kế toán';
    case 'nguoi_nhan_hang':
      return 'người nhận hàng';
    default:
      return role;
  }
}
