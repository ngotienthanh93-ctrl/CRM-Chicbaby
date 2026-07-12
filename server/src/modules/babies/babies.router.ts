import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { serializeBaby } from '../../security/serialize';
import { estimatedBirthMonthFrom, hasValidAgeIdentity } from '../../engines/babyAge';

/** Thông điệp 409 chung cho optimistic locking (CONC-03). */
const STALE_VERSION_MSG = 'Dữ liệu vừa được người khác cập nhật, vui lòng tải lại rồi thử lại.';

export const babiesRouter = Router();
// 🔴 Toàn bộ endpoint bé yêu cầu quyền xem bé => Marketing/Trợ lý dữ liệu bị 403 (SEC-06).
babiesRouter.use(requireAuth, requirePermission('viewBaby'));

const createSchema = z
  .object({
    customerId: z.string().min(1),
    babyName: z.string().optional(),
    birthDate: z.string().datetime().optional(),
    ageMonthsAtRecording: z.number().int().min(0).max(18 * 12).optional(),
    gender: z.string().optional(),
    allergies: z.string().optional(),
    condition: z.string().optional(),
    note: z.string().optional(),
  })
  // 🔴 Bắt buộc DUY NHẤT: birthDate HOẶC ageMonthsAtRecording (BABY-02)
  .refine((d) => !!d.birthDate || d.ageMonthsAtRecording != null, {
    message: 'Cần ngày sinh HOẶC số tháng tuổi.',
  });

babiesRouter.post(
  '/',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Dữ liệu bé không hợp lệ.');
    const d = parsed.data;

    const customer = await prisma.customerCrm.findFirst({
      where: { id: d.customerId, deletedAt: null },
    });
    if (!customer) throw notFound('Không tìm thấy khách hàng.');

    const now = new Date();
    const birthDate = d.birthDate ? new Date(d.birthDate) : null;
    const estimatedBirthMonth =
      d.ageMonthsAtRecording != null ? estimatedBirthMonthFrom(now, d.ageMonthsAtRecording) : null;

    const baby = await prisma.babyProfile.create({
      data: {
        customerId: d.customerId,
        babyName: d.babyName ?? null,
        birthDate,
        ageMonthsAtRecording: d.ageMonthsAtRecording ?? null,
        ageRecordedAt: d.ageMonthsAtRecording != null ? now : null,
        estimatedBirthMonth,
        datePrecision: birthDate ? 'exact' : 'month_estimated',
        gender: d.gender ?? null,
        allergies: d.allergies ?? null,
        allergiesSource: d.allergies ? 'me_ke' : null,
        allergiesRecordedAt: d.allergies ? now : null,
        condition: d.condition ?? null,
        note: d.note ?? null,
        createdBy: req.auth!.userId,
      },
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'baby.create',
      objectType: 'baby_profile',
      objectId: baby.id,
    });
    res.status(201).json(serializeBaby(baby, req.permissions!));
  }),
);

const updateSchema = z.object({
  babyName: z.string().nullable().optional(),
  birthDate: z.string().datetime().nullable().optional(),
  ageMonthsAtRecording: z.number().int().min(0).max(18 * 12).nullable().optional(),
  gender: z.string().nullable().optional(),
  allergies: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  version: z.number().int().optional(),
});

babiesRouter.put(
  '/:id',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu cập nhật không hợp lệ.');
    const d = parsed.data;
    const existing = await prisma.babyProfile.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
    });
    if (!existing) throw notFound('Không tìm thấy hồ sơ bé.');

    const now = new Date();
    const birthDate =
      d.birthDate === undefined ? existing.birthDate : d.birthDate ? new Date(d.birthDate) : null;
    // Hợp nhất mốc tuổi: khi client set ageMonthsAtRecording => suy lại estimatedBirthMonth + ageRecordedAt;
    // khi client XÓA (null) => xóa luôn mốc suy diễn để bất biến tuổi được kiểm đúng.
    let ageMonthsAtRecording: number | null;
    let ageRecordedAt: Date | null;
    let estimatedBirthMonth: Date | null;
    if (d.ageMonthsAtRecording === undefined) {
      ageMonthsAtRecording = existing.ageMonthsAtRecording;
      ageRecordedAt = existing.ageRecordedAt;
      estimatedBirthMonth = existing.estimatedBirthMonth;
    } else if (d.ageMonthsAtRecording === null) {
      ageMonthsAtRecording = null;
      ageRecordedAt = null;
      estimatedBirthMonth = null;
    } else {
      ageMonthsAtRecording = d.ageMonthsAtRecording;
      ageRecordedAt = now;
      estimatedBirthMonth = estimatedBirthMonthFrom(now, d.ageMonthsAtRecording);
    }

    // 🔴 FIX-7 (BABY-01/02): sau khi merge, hồ sơ bé PHẢI còn tính được tuổi.
    if (!hasValidAgeIdentity({ birthDate, estimatedBirthMonth, ageMonthsAtRecording, ageRecordedAt })) {
      throw badRequest('Hồ sơ bé phải có ngày sinh HOẶC số tháng tuổi — không thể xóa hết thông tin tuổi.');
    }

    const datePrecision: 'exact' | 'month_estimated' = birthDate ? 'exact' : 'month_estimated';
    const data = {
      babyName: d.babyName === undefined ? existing.babyName : d.babyName,
      birthDate,
      ageMonthsAtRecording,
      ageRecordedAt,
      estimatedBirthMonth,
      datePrecision,
      gender: d.gender === undefined ? existing.gender : d.gender,
      allergies: d.allergies === undefined ? existing.allergies : d.allergies,
      condition: d.condition === undefined ? existing.condition : d.condition,
      note: d.note === undefined ? existing.note : d.note,
      version: { increment: 1 },
    };

    // 🔴 FIX-8 (CONC-03): khóa lạc quan khi client gửi version.
    if (d.version != null) {
      const locked = await prisma.babyProfile.updateMany({
        where: { id: existing.id, version: d.version },
        data,
      });
      if (locked.count === 0) throw conflict(STALE_VERSION_MSG);
    } else {
      await prisma.babyProfile.update({ where: { id: existing.id }, data });
    }
    const baby = await prisma.babyProfile.findUniqueOrThrow({ where: { id: existing.id } });
    res.json(serializeBaby(baby, req.permissions!));
  }),
);

// Xóa mềm (BABY-06): phân bổ đã xác nhận GIỮ NGUYÊN; nhắc mở -> cấp khách.
babiesRouter.delete(
  '/:id',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.babyProfile.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
    });
    if (!existing) throw notFound('Không tìm thấy hồ sơ bé.');

    await prisma.babyProfile.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    // Nhắc mở tham chiếu bé => hạ về cấp khách (không mất việc).
    await prisma.reminderSource.updateMany({
      where: { babyId: existing.id },
      data: { babyId: null, babyKey: 'customer_level' },
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'baby.soft_delete',
      objectType: 'baby_profile',
      objectId: existing.id,
    });
    res.json({ ok: true });
  }),
);
