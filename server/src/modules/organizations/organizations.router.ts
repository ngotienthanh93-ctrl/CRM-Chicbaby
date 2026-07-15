import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit, writeAuditBestEffort } from '../../security/audit';
import { maskPhone } from '../../security/masking';
import { formatVnDate } from '../../lib/datetime';
import { requiresDeclineReason } from '../../engines/replenishment';
import { normalizeFacebook, normalizeZalo, socialLinksSchema } from '../customers/socialLinks';

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth, requirePermission('viewOrganization'));

organizationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: { contacts: true },
    });
    res.json({
      items: orgs.map((o) => ({
        id: o.id,
        orgName: o.orgName,
        status: o.status,
        medianCadenceDays: o.medianCadenceDays,
        cadenceSampleSize: o.cadenceSampleSize,
        lastPurchaseAt: o.lastPurchaseAt ? formatVnDate(o.lastPurchaseAt) : null,
        revenueTrend: o.revenueTrend,
        paused: o.paused,
        supplierStockoutAffected: o.supplierStockoutAffected,
        badges: buildBadges(o),
      })),
    });
  }),
);

organizationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const perms = req.permissions!;
    const o = await prisma.organization.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
      include: { contacts: true, excludedPeriods: true },
    });
    if (!o) throw notFound('Không tìm thấy đại lý.');
    res.json({
      id: o.id,
      orgName: o.orgName,
      // FB/Zalo là dữ liệu CRM-owned, hiển thị cho MỌI vai xem được hồ sơ đại lý (đã gate viewOrganization ở router).
      facebook: o.facebook,
      zalo: o.zalo,
      status: o.status,
      province: o.province,
      district: o.district,
      health: {
        medianCadenceDays: o.medianCadenceDays,
        cadenceSampleSize: o.cadenceSampleSize,
        lastPurchaseAt: o.lastPurchaseAt ? formatVnDate(o.lastPurchaseAt) : null,
        revenue90d: o.revenue90d ? Number(o.revenue90d) : null,
        revenuePrev90d: o.revenuePrev90d ? Number(o.revenuePrev90d) : null,
        revenueTrend: o.revenueTrend,
      },
      contacts: o.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        isPrimary: c.isPrimary,
        phone: maskPhone(c.phone, perms.viewSensitive),
      })),
      competition: { competitorOffers: o.competitorOffers, complaints: o.complaints },
      exceptions: {
        paused: o.paused,
        pausedUntil: o.pausedUntil ? formatVnDate(o.pausedUntil) : null,
        supplierStockoutAffected: o.supplierStockoutAffected,
        excludedPeriods: o.excludedPeriods.map((p) => ({
          from: formatVnDate(p.fromDate),
          to: formatVnDate(p.toDate),
          reason: p.reason,
        })),
      },
      declineReason: o.declineReason,
      reasonStatus: o.reasonStatus,
      badges: buildBadges(o),
    });
  }),
);

// 🔴 Ghi FB/Zalo đại lý cần manageOrganization: vai thiếu quyền => 403 tại server, không chỉ ẩn ở UI.
organizationsRouter.put(
  '/:id/social-links',
  requirePermission('manageOrganization'),
  asyncHandler(async (req, res) => {
    const parsed = socialLinksSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu kênh liên hệ không hợp lệ.');

    const o = await prisma.organization.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
    });
    if (!o) throw notFound('Không tìm thấy đại lý.');

    // Chỉ đụng field được gửi lên; chuẩn hóa + kiểm tra XSS/host ở SERVER (ném 400 nếu link sai).
    const data: { facebook?: string | null; zalo?: string | null } = {};
    if (parsed.data.facebook !== undefined) data.facebook = normalizeFacebook(parsed.data.facebook);
    if (parsed.data.zalo !== undefined) data.zalo = normalizeZalo(parsed.data.zalo);
    if (Object.keys(data).length === 0) throw badRequest('Không có kênh liên hệ nào để cập nhật.');

    const updated = await prisma.organization.update({ where: { id: o.id }, data });

    await writeAudit({
      userId: req.auth!.userId,
      action: 'organization.update_social_links',
      objectType: 'organization',
      objectId: o.id,
      oldValue: { facebook: o.facebook, zalo: o.zalo },
      newValue: { facebook: updated.facebook, zalo: updated.zalo },
      ip: req.ip,
    });

    res.json({ ok: true, facebook: updated.facebook, zalo: updated.zalo });
  }),
);

// Chuyển at_risk/lost => bắt declineReason (UAT-54)
const declineSchema = z.object({
  toStatus: z.enum(['at_risk', 'lost', 'slow', 'active']),
  declineReason: z
    .enum([
      'gia_cao',
      'doi_thu_chao_gia',
      'hang_ban_cham',
      'shop_het_hang',
      'giao_hang_cham',
      'cong_no',
      'dai_ly_dong_cua',
      'khong_lien_he_duoc',
      'khac',
    ])
    .optional(),
  note: z.string().optional(),
});
organizationsRouter.post(
  '/:id/decline-reason',
  // 🔴 SEC-FIX-2: mutation đại lý cần manageOrganization (cskh/marketing/tro_ly => 403).
  requirePermission('manageOrganization'),
  asyncHandler(async (req, res) => {
    const parsed = declineSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu không hợp lệ.');
    const o = await prisma.organization.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!o) throw notFound('Không tìm thấy đại lý.');

    // Chuyển thủ công sang at_risk/lost BẮT BUỘC lý do.
    if (requiresDeclineReason(parsed.data.toStatus, true) && !parsed.data.declineReason) {
      throw badRequest('Chuyển sang trạng thái này BẮT BUỘC chọn lý do.');
    }
    await prisma.organization.update({
      where: { id: o.id },
      data: {
        status: parsed.data.toStatus,
        declineReason: parsed.data.declineReason ?? o.declineReason,
        declineReasonNote: parsed.data.note ?? o.declineReasonNote,
        reasonStatus: parsed.data.declineReason ? 'confirmed' : o.reasonStatus,
        recordedBy: req.auth!.userId,
        recordedAt: new Date(),
      },
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'organization.decline_reason',
      objectType: 'organization',
      objectId: o.id,
      newValue: { toStatus: parsed.data.toStatus, declineReason: parsed.data.declineReason },
    });
    res.json({ ok: true });
  }),
);

const pauseSchema = z.object({ pausedUntil: z.string().datetime().optional(), reason: z.string().optional() });
organizationsRouter.post(
  '/:id/pause',
  requirePermission('manageOrganization'),
  asyncHandler(async (req, res) => {
    const parsed = pauseSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu không hợp lệ.');
    const o = await prisma.organization.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!o) throw notFound('Không tìm thấy đại lý.');
    await prisma.organization.update({
      where: { id: o.id },
      data: {
        paused: true,
        pausedUntil: parsed.data.pausedUntil ? new Date(parsed.data.pausedUntil) : null,
        pausedReason: parsed.data.reason ?? null,
      },
    });
    await writeAuditBestEffort({
      userId: req.auth!.userId,
      action: 'organization.pause',
      objectType: 'organization',
      objectId: o.id,
      newValue: { pausedUntil: parsed.data.pausedUntil ?? null, reason: parsed.data.reason ?? null },
      ip: req.ip,
    });
    res.json({ ok: true, note: 'Tạm dừng cảnh báo NHẬP (công nợ/khiếu nại vẫn theo dõi).' });
  }),
);

const stockoutSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  reason: z.string().default('shop_het_hang'),
});
organizationsRouter.post(
  '/:id/stockout',
  requirePermission('manageOrganization'),
  asyncHandler(async (req, res) => {
    const parsed = stockoutSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cần khoảng thời gian hết hàng.');
    const o = await prisma.organization.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!o) throw notFound('Không tìm thấy đại lý.');
    await prisma.organization.update({
      where: { id: o.id },
      data: { supplierStockoutAffected: true },
    });
    await prisma.organizationExcludedPeriod.create({
      data: {
        organizationId: o.id,
        fromDate: new Date(parsed.data.fromDate),
        toDate: new Date(parsed.data.toDate),
        reason: parsed.data.reason,
      },
    });
    await writeAuditBestEffort({
      userId: req.auth!.userId,
      action: 'organization.stockout',
      objectType: 'organization',
      objectId: o.id,
      newValue: {
        fromDate: parsed.data.fromDate,
        toDate: parsed.data.toDate,
        reason: parsed.data.reason,
      },
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

organizationsRouter.post(
  '/:id/investigate',
  requirePermission('manageOrganization'),
  asyncHandler(async (req, res) => {
    const o = await prisma.organization.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!o) throw notFound('Không tìm thấy đại lý.');
    await prisma.organization.update({
      where: { id: o.id },
      data: { reasonStatus: 'investigating' },
    });
    res.json({ ok: true });
  }),
);

function buildBadges(o: {
  status: string;
  revenueTrend: string | null;
  supplierStockoutAffected: boolean;
  paused: boolean;
}): string[] {
  const badges: string[] = [];
  if (o.status === 'at_risk') badges.push('Nguy cơ mất');
  if (o.status === 'slow') badges.push('Chậm nhịp');
  if (o.status === 'collecting') badges.push('Đang thu thập');
  if (o.revenueTrend === 'down') badges.push('Đang teo dần');
  if (o.supplierStockoutAffected) badges.push('Shop hết hàng');
  if (o.paused) badges.push('Tạm nghỉ');
  return badges;
}
