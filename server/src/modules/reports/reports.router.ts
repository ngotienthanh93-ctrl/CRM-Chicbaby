// SCR-16 Báo cáo (§11.5 — RPT-03..06, Metric Dictionary). 🔴 Marketing KHÔNG thấy báo cáo có dữ liệu bé.
// 🔴 RPT-04 uplift CHỈ Attributed conversion + chưa đủ mẫu KHÔNG kết luận.
// 🔴 RPT-05 lý do đại lý CHỈ reasonStatus=confirmed. Metric: KHÔNG gọi "LTV" → "Doanh thu tích lũy".
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, forbidden } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import {
  visibleCustomerWhere,
  visibleCustomerRelationWhere,
  allocationBabyWholesaleWhere,
} from '../../security/customerVisibility';
import { computeUplift, countDistinctRepurchaseCustomers } from '../../engines/experiment';
import { diffDaysVn } from '../../lib/datetime';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// GET /api/reports/data-quality — các khoảng trống dữ liệu cần bổ sung (§11.5 RPT-06)
// 🔴 FIX-5 (SEC-06): trả count từ babyProfile + invoiceItemBabyAllocation ⇒ báo cáo CÓ dữ liệu bé.
//    Marketing / tro_ly_du_lieu (viewBaby=false) ⇒ 403, KHÔNG trả rồi ẩn ở client.
reportsRouter.get(
  '/data-quality',
  requirePermission('viewBaby'),
  asyncHandler(async (req, res) => {
    // 🔴 BẤT BIẾN #6: viewBaby nhưng thiếu viewOrganization ⇒ số liệu tổng hợp KHÔNG tính khách sỉ + bé của họ.
    // Các count phân bổ dưới lọc khách sỉ qua allocationBabyWholesaleWhere (bé xác nhận/gợi ý thuộc khách sỉ),
    // spread như các predicate visibleCustomer* khác trong file (predicate chỉ đóng góp key NOT, không đè
    // assignmentStatus). GIỚI HẠN: allocation khách-sỉ CHỈ nhận qua KV identity (không có bé) vẫn KHÔNG lọc
    // được — kv_* là mirror không FK sang customer; các count này là số đếm TỔNG, chấp nhận sai lệch phần này.
    const perms = req.permissions!;
    const [
      productsNoApproved,
      allocationsUnknown,
      babiesNoInfo,
      customersNoConsent,
      allocConfirmed,
      allocSuggested,
      allocCustomerLevel,
      allocTotal,
      customersNoBaby,
    ] = await Promise.all([
      prisma.kvProduct.count({ where: { kvDeleted: false, crmMeta: { is: { approvedCycleDays: null } } } }),
      prisma.invoiceItemBabyAllocation.count({ where: { assignmentStatus: 'suggested', ...allocationBabyWholesaleWhere(perms) } }),
      prisma.babyProfile.count({ where: { deletedAt: null, birthDate: null, ageMonthsAtRecording: null, customer: visibleCustomerRelationWhere(perms) } }),
      prisma.customerCrm.count({ where: { deletedAt: null, consents: { none: {} }, ...visibleCustomerWhere(perms) } }),
      prisma.invoiceItemBabyAllocation.count({ where: { assignmentStatus: { in: ['confirmed', 'auto_assigned'] }, ...allocationBabyWholesaleWhere(perms) } }),
      prisma.invoiceItemBabyAllocation.count({ where: { assignmentStatus: 'suggested', ...allocationBabyWholesaleWhere(perms) } }),
      prisma.invoiceItemBabyAllocation.count({ where: { assignmentStatus: 'customer_level', ...allocationBabyWholesaleWhere(perms) } }),
      prisma.invoiceItemBabyAllocation.count({ where: allocationBabyWholesaleWhere(perms) }),
      prisma.customerCrm.count({ where: { deletedAt: null, babies: { none: { deletedAt: null } }, ...visibleCustomerWhere(perms) } }),
    ]);
    const pct = (n: number) => (allocTotal > 0 ? Math.round((n / allocTotal) * 1000) / 10 : 0);
    res.json({
      productsNeedCycle: productsNoApproved,
      allocationsNeedReview: allocationsUnknown,
      babiesMissingAge: babiesNoInfo,
      customersMissingConsent: customersNoConsent,
      customersWithoutBaby: customersNoBaby,
      allocationQuality: {
        total: allocTotal,
        confirmedPct: pct(allocConfirmed), // % đã xác nhận phân bổ (confirmed + auto)
        suggestedUnconfirmedPct: pct(allocSuggested), // % gợi ý chưa xác nhận
        customerLevelPct: pct(allocCustomerLevel), // % cấp khách
      },
      note: 'Tỷ lệ tự gắn SAI cần đối chiếu mẫu tay (chưa có trong MVP).',
    });
  }),
);

// GET /api/reports/agency-reasons — 🔴 RPT-05: chỉ reasonStatus=confirmed (loại "chưa xác định")
// 🔴 BẤT BIẾN #6: đây là dữ liệu ĐẠI LÝ ⇒ gate viewOrganization. User bị tắt quyền xem đại lý
// KHÔNG được xem cả thống kê lý do ngừng nhập của đại lý (enforce SERVER-SIDE, không chỉ ẩn nav).
reportsRouter.get(
  '/agency-reasons',
  requirePermission('viewOrganization'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.organization.groupBy({
      by: ['declineReason'],
      where: { deletedAt: null, reasonStatus: 'confirmed', declineReason: { not: null } },
      _count: { _all: true },
    });
    res.json({
      note: 'Chỉ tính đại lý có lý do ĐÃ XÁC NHẬN (reasonStatus=confirmed).',
      items: rows.map((r) => ({ declineReason: r.declineReason, count: r._count._all })),
    });
  }),
);

// GET /api/reports/repurchase — 🔴 báo cáo có dữ liệu bé (đúng bé) => Marketing 403.
// Tỷ lệ mua lại theo kỳ 30/60/90; sau nhắc (Attributed) vs tự nhiên; cùng replacement_group (theo verify).
reportsRouter.get(
  '/repurchase',
  requirePermission('viewBaby'),
  asyncHandler(async (req, res) => {
    // 🔴 BẤT BIẾN #6: viewBaby nhưng thiếu viewOrganization ⇒ tỷ lệ mua lại KHÔNG tính follow-up của KHÁCH SỈ.
    // Áp CÓ ĐIỀU KIỆN (follow_up.customer NULLABLE) để không loại nhầm dòng customer=null với user đủ quyền.
    const perms = req.permissions!;
    const [conversions, totalConsumptionFollowUps] = await Promise.all([
      prisma.followUpConversion.findMany({
        where: {
          verificationStatus: 'verified',
          ...(perms.viewOrganization
            ? {}
            : { followUp: { customer: visibleCustomerRelationWhere(perms) } }),
        },
        include: { followUp: { select: { reminderType: true, dueDate: true } } },
      }),
      prisma.followUp.count({
        where: {
          reminderType: 'consumption',
          ...(perms.viewOrganization ? {} : { customer: visibleCustomerRelationWhere(perms) }),
        },
      }),
    ]);

    const verified = conversions.length;
    const attributed = conversions.filter((c) => c.attributionStatus === 'attributed').length; // sau nhắc
    const natural = verified - attributed; // tự nhiên (verified nhưng không attributed)

    // Kỳ 30/60/90: số ngày giữa ngày nhắc và ngày xác minh mua lại.
    const buckets = { d30: 0, d60: 0, d90: 0, over90: 0 };
    for (const c of conversions) {
      if (!c.matchedAt || !c.followUp?.dueDate) continue;
      const days = Math.abs(diffDaysVn(c.matchedAt, c.followUp.dueDate));
      if (days <= 30) buckets.d30++;
      else if (days <= 60) buckets.d60++;
      else if (days <= 90) buckets.d90++;
      else buckets.over90++;
    }

    const rate = (n: number) =>
      totalConsumptionFollowUps > 0 ? Math.round((n / totalConsumptionFollowUps) * 1000) / 10 : 0;

    res.json({
      note: 'Tách "Repurchase verified" (có hóa đơn) vs "Attributed CRM conversion" (sau nhắc, gắn follow-up). Cùng replacement_group + đúng bé theo logic xác minh.',
      totalConsumptionFollowUps,
      repurchaseVerified: verified,
      attributedAfterReminder: attributed, // 🔴 chỉ đây mới dùng cho báo cáo tác động
      naturalRepurchase: natural,
      repurchaseVerifiedRatePct: rate(verified),
      attributedRatePct: rate(attributed),
      byPeriod: buckets,
    });
  }),
);

// GET /api/reports/incremental-uplift — 🔴 RPT-04: treatment vs holdout, CHỈ Attributed conversion.
// 🔴 Chưa đủ mẫu ⇒ KHÔNG kết luận + trạng thái + khoảng tin cậy.
reportsRouter.get(
  '/incremental-uplift',
  asyncHandler(async (req, res) => {
    // 🔴 BÁO CÁO tác động thí nghiệm CHỈ chủ shop xem (số liệu holdout/uplift nhạy cảm chiến lược).
    // Enforce SERVER-SIDE, không chỉ ẩn section ở client.
    if (req.auth!.role !== 'chu_shop') {
      throw forbidden('Chỉ chủ shop xem được báo cáo tác động thí nghiệm.');
    }
    // Thí nghiệm đang chạy (mới nhất). Không có ⇒ collecting.
    const experiment = await prisma.experiment.findFirst({
      where: { status: 'running' },
      orderBy: { startAt: 'desc' },
    });
    if (!experiment) {
      res.json({ note: 'Chưa có thí nghiệm đang chạy.', result: null });
      return;
    }

    const assignments = await prisma.experimentAssignment.findMany({
      where: { experimentId: experiment.id },
      select: { customerId: true, group: true },
    });
    const treatmentIds = assignments.filter((a) => a.group === 'treatment').map((a) => a.customerId);
    const holdoutIds = assignments.filter((a) => a.group === 'holdout').map((a) => a.customerId);

    // 🔴 FIX-6 / RPT-04: cửa sổ thí nghiệm nửa mở [startAt, COALESCE(endAt, now)).
    const now = new Date();
    const window = { startAt: experiment.startAt, endAt: experiment.endAt ?? now };

    // Nạp conversion rows (verified + thuộc nhóm) kèm customerId + matchedAt; ĐẾM DISTINCT khách
    // trong cửa sổ ở engine (chống phồng tử số khi 1 khách có nhiều conversion).
    const loadRows = async (ids: string[]) =>
      ids.length > 0
        ? (
            await prisma.followUpConversion.findMany({
              where: { verificationStatus: 'verified', followUp: { customerId: { in: ids } } },
              select: {
                matchedAt: true,
                attributionStatus: true,
                verificationStatus: true,
                followUp: { select: { customerId: true } },
              },
            })
          ).map((r) => ({
            customerId: r.followUp?.customerId ?? null,
            matchedAt: r.matchedAt,
            attributionStatus: r.attributionStatus,
            verificationStatus: r.verificationStatus,
          }))
        : [];

    const [treatmentRows, holdoutRows] = await Promise.all([loadRows(treatmentIds), loadRows(holdoutIds)]);
    // 🔴 treatment: CHỈ Attributed conversion; holdout: mua lại TỰ NHIÊN (verified) — không nhận nhắc.
    const treatmentConversions = countDistinctRepurchaseCustomers(treatmentRows, window, {
      attributedOnly: true,
    });
    const holdoutConversions = countDistinctRepurchaseCustomers(holdoutRows, window, {
      attributedOnly: false,
    });

    const result = computeUplift(
      { n: treatmentIds.length, conversions: treatmentConversions },
      { n: holdoutIds.length, conversions: holdoutConversions },
      {
        minSampleTreatment: experiment.minSampleTreatment,
        minSampleHoldout: experiment.minSampleHoldout,
      },
    );

    res.json({
      experiment: { id: experiment.id, name: experiment.name },
      groups: {
        treatment: { n: treatmentIds.length, conversions: treatmentConversions },
        holdout: { n: holdoutIds.length, conversions: holdoutConversions },
      },
      minSample: {
        treatment: experiment.minSampleTreatment,
        holdout: experiment.minSampleHoldout,
      },
      // 🔴 hasConclusion=false ⇒ frontend KHÔNG hiển thị kết luận (chỉ trạng thái + CI).
      result,
    });
  }),
);
