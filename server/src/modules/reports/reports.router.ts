import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// GET /api/reports/data-quality — các khoảng trống dữ liệu cần bổ sung
reportsRouter.get(
  '/data-quality',
  asyncHandler(async (_req, res) => {
    const [productsNoApproved, allocationsUnknown, babiesNoInfo, customersNoConsent] =
      await Promise.all([
        prisma.kvProduct.count({
          where: { kvDeleted: false, crmMeta: { is: { approvedCycleDays: null } } },
        }),
        prisma.invoiceItemBabyAllocation.count({ where: { assignmentStatus: 'suggested' } }),
        prisma.babyProfile.count({
          where: { deletedAt: null, birthDate: null, ageMonthsAtRecording: null },
        }),
        prisma.customerCrm.count({ where: { deletedAt: null, consents: { none: {} } } }),
      ]);
    res.json({
      productsNeedCycle: productsNoApproved,
      allocationsNeedReview: allocationsUnknown,
      babiesMissingAge: babiesNoInfo,
      customersMissingConsent: customersNoConsent,
    });
  }),
);

// GET /api/reports/agency-reasons — chỉ tính reasonStatus=confirmed (loại "chưa xác định")
reportsRouter.get(
  '/agency-reasons',
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
