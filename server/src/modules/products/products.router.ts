import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';

export const productsRouter = Router();
productsRouter.use(requireAuth);

// GET /api/products — bảng SP + meta (SCR-08)
productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const products = await prisma.kvProduct.findMany({
      where: { kvDeleted: false },
      orderBy: { name: 'asc' },
      include: { crmMeta: { include: { replacementGroup: true } } },
      take: 500,
    });
    res.json({
      items: products.map((p) => ({
        kvProductId: p.kvProductId,
        code: p.code,
        name: p.name,
        unit: p.unit,
        price: p.price ? Number(p.price) : null,
        babyAssignmentMode: p.crmMeta?.babyAssignmentMode ?? 'multi_audience',
        suggestedCycleDays: p.crmMeta?.suggestedCycleDays ?? null,
        suggestionSampleSize: p.crmMeta?.suggestionSampleSize ?? null,
        suggestionConfidence: p.crmMeta?.suggestionConfidence ?? null,
        approvedCycleDays: p.crmMeta?.approvedCycleDays ?? null,
        approvedAt: p.crmMeta?.approvedAt ?? null,
        replacementGroup: p.crmMeta?.replacementGroup
          ? { id: p.crmMeta.replacementGroup.id, name: p.crmMeta.replacementGroup.name }
          : null,
        autoRemindEnabled: p.crmMeta?.autoRemindEnabled ?? true,
        needsApproval: p.crmMeta?.approvedCycleDays == null,
      })),
    });
  }),
);

const metaSchema = z.object({
  babyAssignmentMode: z.enum(['baby_specific', 'multi_audience', 'not_baby_applicable']).optional(),
  replacementGroupId: z.string().nullable().optional(),
  autoRemindEnabled: z.boolean().optional(),
  cycleMinDays: z.number().int().positive().nullable().optional(),
  cycleMaxDays: z.number().int().positive().nullable().optional(),
});

// PUT /api/products/:id/meta — CRM Officer đề xuất, Chủ shop cũng sửa được
productsRouter.put(
  '/:id/meta',
  requireRole('chu_shop', 'crm_officer'),
  asyncHandler(async (req, res) => {
    const parsed = metaSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu meta không hợp lệ.');
    const kvProductId = String(req.params.id);
    const product = await prisma.kvProduct.findUnique({ where: { kvProductId } });
    if (!product) throw notFound('Không tìm thấy sản phẩm.');

    const meta = await prisma.productCrmMeta.upsert({
      where: { kvProductId },
      create: { kvProductId, ...cleanUndefined(parsed.data) },
      update: cleanUndefined(parsed.data),
    });
    res.json({ ok: true, meta: { babyAssignmentMode: meta.babyAssignmentMode } });
  }),
);

// POST /api/products/:id/approve-cycle — CHỈ Chủ shop (CYC-03/05)
const approveSchema = z.object({ approvedCycleDays: z.number().int().positive(), preview: z.boolean().optional() });
productsRouter.post(
  '/:id/approve-cycle',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Chu kỳ duyệt không hợp lệ.');
    const kvProductId = String(req.params.id);
    const product = await prisma.kvProduct.findUnique({ where: { kvProductId } });
    if (!product) throw notFound('Không tìm thấy sản phẩm.');

    // Preview ảnh hưởng: số dòng phân bổ sẽ dùng chu kỳ này để tính nhắc.
    const affected = await prisma.invoiceItemBabyAllocation.count({
      where: { invoiceLine: { kvProductId } },
    });
    if (parsed.data.preview) {
      res.json({ preview: true, affectedAllocations: affected, approvedCycleDays: parsed.data.approvedCycleDays });
      return;
    }

    await prisma.productCrmMeta.upsert({
      where: { kvProductId },
      create: {
        kvProductId,
        approvedCycleDays: parsed.data.approvedCycleDays,
        approvedBy: req.auth!.userId,
        approvedAt: new Date(),
      },
      update: {
        approvedCycleDays: parsed.data.approvedCycleDays,
        approvedBy: req.auth!.userId,
        approvedAt: new Date(),
      },
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'product.approve_cycle',
      objectType: 'product',
      objectId: kvProductId,
      newValue: { approvedCycleDays: parsed.data.approvedCycleDays },
    });
    res.json({ ok: true, affectedAllocations: affected });
  }),
);

function cleanUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
