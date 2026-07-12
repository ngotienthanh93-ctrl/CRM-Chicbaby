import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';

export const configRouter = Router();
configRouter.use(requireAuth);

// GET /api/config — các giá trị đang active
configRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.configurationVersion.findMany({
      where: { isActive: true },
      orderBy: { key: 'asc' },
    });
    res.json({
      items: rows.map((r) => ({ key: r.key, value: r.value, version: r.version })),
    });
  }),
);

// PUT /api/config/:key — CHỈ Chủ shop, ghi change log + version mới (nguyên tắc #9)
const putSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  reason: z.string().optional(),
  appliesTo: z.enum(['new_only', 'recalculate']).default('new_only'),
});
configRouter.put(
  '/:key',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Giá trị cấu hình không hợp lệ.');
    const key = String(req.params.key);
    // Chặn sửa tham số khóa cứng.
    if (key === 'contact_cap.service') throw badRequest('Tham số này bị khóa (∞), không sửa được.');

    const current = await prisma.configurationVersion.findFirst({
      where: { key, isActive: true },
    });
    if (!current) throw notFound('Không tìm thấy khóa cấu hình.');

    await prisma.$transaction([
      prisma.configurationVersion.update({
        where: { id: current.id },
        data: { isActive: false },
      }),
      prisma.configurationVersion.create({
        data: {
          key,
          value: parsed.data.value as never,
          version: current.version + 1,
          isActive: true,
          createdBy: req.auth!.userId,
        },
      }),
      prisma.configurationChangeLog.create({
        data: {
          key,
          oldValue: current.value as never,
          newValue: parsed.data.value as never,
          changedBy: req.auth!.userId,
          reason: parsed.data.reason ?? null,
          appliesTo: parsed.data.appliesTo,
        },
      }),
    ]);
    await writeAudit({
      userId: req.auth!.userId,
      action: 'config.update',
      objectType: 'configuration',
      objectId: key,
      oldValue: current.value,
      newValue: parsed.data.value,
    });
    res.json({ ok: true });
  }),
);
