// SCR-06 Ghi chú tư vấn (§11.2 — CON-01..09). NHẠY CẢM: Marketing/Trợ lý dữ liệu 403 (viewConsultation).
// 🔴 CON-01 temperature KHÔNG mặc định. 🔴 CON-03 sửa KHÔNG ghi đè (consultation_versions).
// 🔴 CON-04 nextContactDate ⇒ follow_up service_contact (không bị trần). 🔴 CON-05 chống hẹn trùng ±3 ngày.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { assertBabyBelongsToCustomer } from '../../security/ownership';
import { appointmentClashesWithin } from '../../engines/consultation';
import { formatVnDate, formatVnDateTime, vnToday } from '../../lib/datetime';

export const consultationsRouter = Router();
// NHẠY CẢM (CON-09): mọi endpoint tư vấn cần quyền xem tư vấn => Marketing/Trợ lý dữ liệu 403.
consultationsRouter.use(requireAuth, requirePermission('viewConsultation'));

const APPOINTMENT_CLASH_WINDOW_DAYS = 3; // CON-05
const STALE_VERSION_MSG = 'Dữ liệu vừa được người khác cập nhật, vui lòng tải lại rồi thử lại.';

function serializeConsultation(c: {
  id: string;
  customerId: string;
  babyId: string | null;
  issue: string;
  temperature: string | null;
  result: string | null;
  reasonNoBuy: string | null;
  nextContactDate: Date | null;
  note: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  advisedProducts?: { kvProductId: string }[];
  _count?: { versions: number };
}) {
  return {
    id: c.id,
    customerId: c.customerId,
    babyId: c.babyId,
    issue: c.issue,
    temperature: c.temperature, // 🔴 KHÔNG mặc định — có thể null
    result: c.result,
    reasonNoBuy: c.reasonNoBuy,
    advisedProductIds: (c.advisedProducts ?? []).map((p) => p.kvProductId),
    nextContactDate: c.nextContactDate ? formatVnDate(c.nextContactDate) : null,
    note: c.note,
    version: c.version,
    editedCount: c._count?.versions ?? 0, // "đã sửa N lần" (CON-03)
    createdAt: formatVnDateTime(c.createdAt),
    updatedAt: formatVnDateTime(c.updatedAt),
  };
}

// ---------- GET /:id ----------
consultationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await prisma.consultation.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
      include: { advisedProducts: true, _count: { select: { versions: true } } },
    });
    if (!c) throw notFound('Không tìm thấy ghi chú tư vấn.');
    res.json(serializeConsultation(c));
  }),
);

const temperatureEnum = z.enum(['nong', 'am', 'lanh']);
const resultEnum = z.enum(['da_chot', 'chua_chot', 'tu_choi']);

// ---------- POST / ----------
const createSchema = z.object({
  customerId: z.string().min(1),
  babyId: z.string().min(1).optional(),
  issue: z.string().min(1), // 🔴 bắt buộc DUY NHẤT (CON-01)
  advisedProductIds: z.array(z.string().min(1)).optional(),
  temperature: temperatureEnum.optional(), // 🔴 KHÔNG mặc định
  result: resultEnum.optional(),
  reasonNoBuy: z.string().optional(),
  nextContactDate: z.string().datetime().optional(),
  note: z.string().optional(),
});

consultationsRouter.post(
  '/',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest(parsed.error.issues[0]?.message ?? 'Dữ liệu tư vấn không hợp lệ (issue bắt buộc).');
    const d = parsed.data;

    const customer = await prisma.customerCrm.findFirst({ where: { id: d.customerId, deletedAt: null } });
    if (!customer) throw notFound('Không tìm thấy khách hàng.');
    // Bé (nếu có) phải thuộc đúng khách (chống gán chéo — SEC-FIX-1).
    if (d.babyId) await assertBabyBelongsToCustomer(d.babyId, d.customerId);

    const now = new Date();
    const nextContactDate = d.nextContactDate ? new Date(d.nextContactDate) : null;

    const consultation = await prisma.consultation.create({
      data: {
        customerId: d.customerId,
        babyId: d.babyId ?? null,
        issue: d.issue,
        temperature: d.temperature ?? null,
        result: d.result ?? null,
        reasonNoBuy: d.reasonNoBuy ?? null,
        nextContactDate,
        note: d.note ?? null,
        createdBy: req.auth!.userId,
        advisedProducts: d.advisedProductIds?.length
          ? { create: d.advisedProductIds.map((kvProductId) => ({ kvProductId })) }
          : undefined,
      },
      include: { advisedProducts: true, _count: { select: { versions: true } } },
    });

    // 🔴 CON-04: nextContactDate ⇒ follow_up service_contact (không bị trần). CON-05: chống hẹn trùng ±3 ngày.
    const appointment = await maybeCreateAppointment(d.customerId, nextContactDate, d.issue, req.auth!.userId, now);

    await writeAudit({
      userId: req.auth!.userId,
      action: 'consultation.create',
      objectType: 'consultation',
      objectId: consultation.id,
    });
    res.status(201).json({ ...serializeConsultation(consultation), appointment });
  }),
);

// ---------- PUT /:id (🔴 CON-03: sửa KHÔNG ghi đè · 🔴 FIX-3/CONC-03: BẮT BUỘC version) ----------
// 🔴 FIX-3: `version` BẮT BUỘC — thiếu ⇒ 400. Không cho update KHÔNG khóa lạc quan.
export const consultationUpdateSchema = z.object({
  issue: z.string().min(1).optional(),
  babyId: z.string().min(1).nullable().optional(),
  advisedProductIds: z.array(z.string().min(1)).optional(),
  temperature: temperatureEnum.nullable().optional(),
  result: resultEnum.nullable().optional(),
  reasonNoBuy: z.string().nullable().optional(),
  nextContactDate: z.string().datetime().nullable().optional(),
  note: z.string().nullable().optional(),
  version: z.number({
    required_error: 'Thiếu version — cần để khóa lạc quan (tải lại bản mới rồi thử lại).',
    invalid_type_error: 'version phải là số nguyên.',
  }).int(),
});

consultationsRouter.put(
  '/:id',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = consultationUpdateSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest(parsed.error.issues[0]?.message ?? 'Dữ liệu cập nhật tư vấn không hợp lệ.');
    const d = parsed.data;
    const existing = await prisma.consultation.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
      include: { advisedProducts: true },
    });
    if (!existing) throw notFound('Không tìm thấy ghi chú tư vấn.');

    if (d.babyId != null) await assertBabyBelongsToCustomer(d.babyId, existing.customerId);

    const now = new Date();
    const nextContactDate =
      d.nextContactDate === undefined
        ? existing.nextContactDate
        : d.nextContactDate
          ? new Date(d.nextContactDate)
          : null;

    // 🔴 CON-03: lưu SNAPSHOT bản CŨ vào consultation_versions TRƯỚC khi ghi đè.
    const snapshot = {
      issue: existing.issue,
      babyId: existing.babyId,
      temperature: existing.temperature,
      result: existing.result,
      reasonNoBuy: existing.reasonNoBuy,
      nextContactDate: existing.nextContactDate,
      note: existing.note,
      advisedProductIds: existing.advisedProducts.map((p) => p.kvProductId),
      version: existing.version,
    };

    const data = {
      issue: d.issue ?? existing.issue,
      babyId: d.babyId === undefined ? existing.babyId : d.babyId,
      temperature: d.temperature === undefined ? existing.temperature : d.temperature,
      result: d.result === undefined ? existing.result : d.result,
      reasonNoBuy: d.reasonNoBuy === undefined ? existing.reasonNoBuy : d.reasonNoBuy,
      nextContactDate,
      note: d.note === undefined ? existing.note : d.note,
      version: { increment: 1 },
    };

    await prisma.$transaction(async (tx) => {
      // 🔴 FIX-3 (CONC-03): khóa lạc quan BẮT BUỘC — updateMany theo (id, version).
      //    count===0 ⇒ bản đã bị người khác sửa ⇒ 409 (không ghi đè mù). version tăng ⇒ lần sau phải khớp.
      const locked = await tx.consultation.updateMany({
        where: { id: existing.id, version: d.version },
        data,
      });
      if (locked.count === 0) throw conflict(STALE_VERSION_MSG);
      // Lưu SNAPSHOT bản CŨ (CON-03) CHỈ khi khóa lạc quan thành công (tránh sinh version thừa khi 409).
      await tx.consultationVersion.create({
        data: { consultationId: existing.id, snapshot: snapshot as never, changedBy: req.auth!.userId },
      });
      // Đồng bộ SP tư vấn nếu client gửi danh sách mới (thay thế).
      if (d.advisedProductIds) {
        await tx.consultationAdvisedProduct.deleteMany({ where: { consultationId: existing.id } });
        for (const kvProductId of d.advisedProductIds) {
          await tx.consultationAdvisedProduct.create({ data: { consultationId: existing.id, kvProductId } });
        }
      }
    });

    // Nếu ĐỔI sang ngày hẹn mới => tạo follow_up service_contact (chống trùng ±3 ngày).
    let appointment: AppointmentResult = { created: false, reason: 'unchanged' };
    if (d.nextContactDate !== undefined && nextContactDate) {
      appointment = await maybeCreateAppointment(existing.customerId, nextContactDate, data.issue, req.auth!.userId, now);
    }

    await writeAudit({
      userId: req.auth!.userId,
      action: 'consultation.update',
      objectType: 'consultation',
      objectId: existing.id,
    });

    const updated = await prisma.consultation.findUniqueOrThrow({
      where: { id: existing.id },
      include: { advisedProducts: true, _count: { select: { versions: true } } },
    });
    res.json({ ...serializeConsultation(updated), appointment });
  }),
);

// ---------- helper: tạo lịch hẹn gọi lại (CON-04/05) ----------
interface AppointmentResult {
  created: boolean;
  reason: 'created' | 'duplicate_within_window' | 'no_date' | 'unchanged';
  followUpId?: string;
}

async function maybeCreateAppointment(
  customerId: string,
  nextContactDate: Date | null,
  issue: string,
  userId: string,
  now: Date,
): Promise<AppointmentResult> {
  if (!nextContactDate) return { created: false, reason: 'no_date' };
  // 🔴 FIX-4 (CON-05 race): bọc kiểm-tra-rồi-tạo trong TRANSACTION + advisory lock theo customerId,
  //    re-check TRONG lock ⇒ 2 request đồng thời KHÔNG tạo 2 follow_up hẹn trùng ±3 ngày (bản gọn an toàn).
  return await prisma.$transaction(async (tx) => {
    // Advisory lock theo khách (tự nhả cuối transaction) ⇒ tuần tự hóa việc tạo hẹn của CÙNG khách.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt:${customerId}`})::bigint)`;

    // CON-05: chống hẹn trùng — xét các follow_up service_contact ĐANG MỞ của khách (re-check trong lock).
    const openAppointments = await tx.followUp.findMany({
      where: {
        customerId,
        reminderType: 'consultation_followup',
        status: { in: ['cho_toi_han', 'den_han', 'hen_lai', 'da_lien_he'] },
      },
      select: { dueDate: true },
    });
    if (
      appointmentClashesWithin(
        openAppointments.map((f) => f.dueDate),
        nextContactDate,
        APPOINTMENT_CLASH_WINDOW_DAYS,
      )
    ) {
      return { created: false, reason: 'duplicate_within_window' };
    }
    const today = vnToday(now);
    const status = nextContactDate.getTime() <= today.getTime() ? 'den_han' : 'cho_toi_han';
    const fu = await tx.followUp.create({
      data: {
        targetType: 'customer',
        customerId,
        reminderType: 'consultation_followup',
        dueDate: nextContactDate,
        assigneeId: userId,
        status: status as never,
        priority: 3,
        // 🔴 CON-04: service_contact KHÔNG bao giờ bị trần chống làm phiền.
        frequencyCapScope: 'service_contact',
        content: `Gọi lại tư vấn: ${issue}`,
      },
    });
    await tx.followUpStateHistory.create({
      data: { followUpId: fu.id, newStatus: status as never, changedBy: userId, note: 'Hẹn gọi lại từ tư vấn (CON-04)' },
    });
    return { created: true, reason: 'created', followUpId: fu.id };
  });
}
