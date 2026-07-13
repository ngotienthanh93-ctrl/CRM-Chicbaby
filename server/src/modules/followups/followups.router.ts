import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { assertBabyBelongsToCustomer } from '../../security/ownership';
import { canRelease, claimableWhereOr } from './claim';
import { addDays } from '../../lib/datetime';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { decideNoAnswer } from '../../engines/consumption';
import { verifyRepurchase } from './repurchase';

export const followupsRouter = Router();
// 🔴 FIX-2: mọi route xử lý việc (result/close/mark-purchased/snooze/claim/heartbeat/
// release/reassign/confirm-baby) chỉ cho vai xử lý việc. Marketing & tro_ly_du_lieu => 403.
// confirm-baby còn siết thêm requirePermission('manageBaby') tại route.
followupsRouter.use(requireAuth, requirePermission('processWork'));

const cfg = DEFAULT_ENGINE_CONFIG;

/** Thông điệp 409 chung cho optimistic locking (CONC-03). */
const STALE_VERSION_MSG = 'Dữ liệu vừa được người khác cập nhật, vui lòng tải lại rồi thử lại.';

/** 🔴 FIX-8: khóa lạc quan cho follow-up. Client gửi version => tăng qua updateMany; count 0 => 409. */
async function guardFollowUpVersion(id: string, version?: number): Promise<void> {
  if (version == null) return;
  const r = await prisma.followUp.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (r.count === 0) throw conflict(STALE_VERSION_MSG);
}

async function loadFollowUp(id: string) {
  const fu = await prisma.followUp.findUnique({ where: { id } });
  if (!fu) throw notFound('Không tìm thấy việc cần làm.');
  return fu;
}

async function recordStatus(
  followUpId: string,
  oldStatus: string,
  newStatus: string,
  userId: string,
  note?: string,
) {
  await prisma.followUpStateHistory.create({
    data: {
      followUpId,
      oldStatus: oldStatus as never,
      newStatus: newStatus as never,
      changedBy: userId,
      note: note ?? null,
    },
  });
}

// FIX-5: ghi/cập nhật follow_up_conversions (1 conversion "sống" / follow-up).
// Tái dùng conversion CHƯA verified của follow-up nếu có, tránh sinh nhiều bản ghi rác.
async function recordConversion(input: {
  followUpId: string;
  verificationStatus: 'pending' | 'verified' | 'not_found';
  attributionStatus: 'attributed' | 'not_attributed';
  customerReport: 'already_purchased' | 'intends_to_purchase';
  invoiceId?: string | null;
  invoiceLineId?: string | null;
  matchedAt?: Date | null;
}) {
  const existing = await prisma.followUpConversion.findFirst({
    where: { followUpId: input.followUpId, verificationStatus: { not: 'verified' } },
    orderBy: { createdAt: 'desc' },
  });
  const data = {
    verificationStatus: input.verificationStatus as never,
    attributionStatus: input.attributionStatus as never,
    customerReport: input.customerReport as never,
    invoiceId: input.invoiceId ?? null,
    invoiceLineId: input.invoiceLineId ?? null,
    matchedAt: input.matchedAt ?? null,
    matchMethod: input.invoiceLineId ? ('auto' as never) : null,
  };
  if (existing) {
    await prisma.followUpConversion.update({ where: { id: existing.id }, data });
  } else {
    await prisma.followUpConversion.create({ data: { followUpId: input.followUpId, ...data } });
  }
}

// ---- Claim (chống 2 người gọi trùng, LOCK-01..11) ----
followupsRouter.post(
  '/:id/claim',
  asyncHandler(async (req, res) => {
    const fu = await loadFollowUp(String(req.params.id)); // 404 nếu không tồn tại
    const now = new Date();
    const userId = req.auth!.userId;
    // 🔴 SEC-FIX-3: chiếm việc NGUYÊN TỬ ở tầng DB. Guard nằm trong where => 2 request đồng thời
    // chỉ MỘT cái khớp & lật cờ; cái còn lại count===0 => 409 (không còn read-then-write đua nhau).
    const result = await prisma.followUp.updateMany({
      where: { id: fu.id, OR: claimableWhereOr(now, userId) },
      data: {
        claimState: 'in_progress',
        claimedBy: userId,
        claimedAt: now,
        lastHeartbeatAt: now,
        claimExpiresAt: addMinutes(now, cfg.claim.inProgressTtlMinutes),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw conflict('Việc này đang được người khác xử lý.');
    res.json({ ok: true, claimedBy: userId });
  }),
);

followupsRouter.post(
  '/:id/heartbeat',
  asyncHandler(async (req, res) => {
    const fu = await loadFollowUp(String(req.params.id));
    if (fu.claimedBy !== req.auth!.userId) throw conflict('Bạn không giữ việc này.');
    const now = new Date();
    await prisma.followUp.update({
      where: { id: fu.id },
      data: { lastHeartbeatAt: now, claimExpiresAt: addMinutes(now, cfg.claim.inProgressTtlMinutes) },
    });
    res.json({ ok: true });
  }),
);

followupsRouter.post(
  '/:id/release',
  asyncHandler(async (req, res) => {
    const fu = await loadFollowUp(String(req.params.id));
    // 🔴 SEC-FIX-3: chỉ người ĐANG giữ được release; người khác override phải là chu_shop (LOCK-10).
    const decision = canRelease(fu.claimedBy, req.auth!.userId, req.auth!.role);
    if (!decision.allowed) {
      throw forbidden('Chỉ người đang giữ việc hoặc chủ shop mới được giải phóng việc này.');
    }
    // 🔴 SEC-FIX-3 (round 2): release NGUYÊN TỬ — chặn TOCTOU. Vai thường chỉ giải phóng khi việc
    // vẫn do CHÍNH mình giữ (hoặc chưa ai giữ); nếu người khác vừa nhận giữa read↔write => count 0 => 409.
    const releaseWhere = decision.isOverride
      ? { id: fu.id } // chu_shop override: giải phóng bất kể ai đang giữ (LOCK-10)
      : { id: fu.id, OR: [{ claimedBy: req.auth!.userId }, { claimedBy: null }] };
    const released = await prisma.followUp.updateMany({
      where: releaseWhere,
      data: { claimState: 'unclaimed', claimedBy: null, claimedAt: null, claimExpiresAt: null },
    });
    if (released.count === 0) {
      throw conflict('Việc này vừa được người khác nhận — không thể giải phóng. Vui lòng tải lại.');
    }
    if (decision.isOverride) {
      // Ghi audit khi chủ shop cưỡng chế giải phóng claim của người khác.
      await writeAudit({
        userId: req.auth!.userId,
        action: 'followup.release_override',
        objectType: 'follow_up',
        objectId: fu.id,
        newValue: { overriddenClaimBy: fu.claimedBy },
      });
    }
    res.json({ ok: true });
  }),
);

// ---- Ghi kết quả liên hệ (CONV-01..04) ----
const resultSchema = z.object({
  outcome: z.enum(['already_purchased', 'intends_to_purchase', 'no_answer']),
  note: z.string().optional(),
  version: z.number().int().optional(),
});
followupsRouter.post(
  '/:id/result',
  asyncHandler(async (req, res) => {
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Kết quả không hợp lệ.');
    const fu = await loadFollowUp(String(req.params.id));
    await guardFollowUpVersion(fu.id, parsed.data.version);
    const now = new Date();
    const userId = req.auth!.userId;

    if (parsed.data.outcome === 'no_answer') {
      // "Không nghe máy" = attempt, KHÔNG phải lý do đóng (CONV-04)
      const attemptCount = fu.attemptCount + 1;
      const decision = decideNoAnswer(attemptCount, cfg);
      await prisma.followUp.update({
        where: { id: fu.id },
        data: {
          attemptCount,
          contactedAt: now,
          status: 'da_lien_he',
          dueDate: decision.action === 'allow_close' ? fu.dueDate : addDays(now, decision.deferDays),
          result: `no_answer:${decision.action}`,
        },
      });
      await recordStatus(fu.id, fu.status, 'da_lien_he', userId, `Không nghe máy (lần ${attemptCount})`);
      res.json({ ok: true, attemptCount, decision });
      return;
    }

    if (parsed.data.outcome === 'already_purchased') {
      // 🔴 CONV-01 (FIX-5): xác minh với hóa đơn KV trong cửa sổ ⚙️ verification_window_days.
      // Ghi nhận thời điểm liên hệ TRƯỚC khi verify để tính attribution đúng.
      await prisma.followUp.update({
        where: { id: fu.id },
        data: { status: 'da_lien_he', contactedAt: now, result: 'already_purchased' },
      });
      const verification = await verifyRepurchase(prisma, fu.id, cfg, now);
      if (verification.verified) {
        // 🔴 CONV-03 (ISSUE-9): attribution CHỈ khi khách mua SAU lần liên hệ đủ điều kiện TRƯỚC ĐÓ.
        // fu.contactedAt ở đây là mốc liên hệ CŨ (nạp trước update). "Đã mua rồi" mà chưa từng
        // liên hệ (contactedAt cũ = null) => mua tự nhiên => NOT attributed (repurchase verified thôi).
        const contactAt = fu.contactedAt ?? now;
        const attributed =
          verification.purchaseDate != null && verification.purchaseDate >= contactAt;
        await recordConversion({
          followUpId: fu.id,
          verificationStatus: 'verified',
          attributionStatus: attributed ? 'attributed' : 'not_attributed',
          customerReport: 'already_purchased',
          invoiceId: verification.invoiceId,
          invoiceLineId: verification.invoiceLineId,
          matchedAt: now,
        });
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'da_mua_lai', claimState: 'completed' },
        });
        await recordStatus(fu.id, 'da_lien_he', 'da_mua_lai', userId, 'Xác minh có hóa đơn mua lại');
        res.json({ ok: true, verification: 'verified' });
        return;
      }
      // Chưa thấy hóa đơn khớp => pending, KHÔNG tính conversion, GIỮ MỞ (da_lien_he).
      await recordConversion({
        followUpId: fu.id,
        verificationStatus: 'pending',
        attributionStatus: 'not_attributed',
        customerReport: 'already_purchased',
      });
      await recordStatus(fu.id, fu.status, 'da_lien_he', userId, 'Khách báo đã mua (chờ đối soát)');
      res.json({ ok: true, verification: 'pending' });
      return;
    }

    // intends_to_purchase => lịch kiểm tra lại sau intent.recheck_days (KHÔNG tính conversion).
    await recordConversion({
      followUpId: fu.id,
      verificationStatus: 'pending',
      attributionStatus: 'not_attributed',
      customerReport: 'intends_to_purchase',
    });
    await prisma.followUp.update({
      where: { id: fu.id },
      data: {
        status: 'hen_lai',
        contactedAt: now,
        dueDate: addDays(now, cfg.intent.recheckDays),
        result: 'intends_to_purchase',
      },
    });
    await recordStatus(fu.id, fu.status, 'hen_lai', userId, 'Khách nói sẽ mua — hẹn kiểm tra lại');
    res.json({ ok: true, recheckInDays: cfg.intent.recheckDays });
  }),
);

// ---- Snooze (+7/+14/+30/ngày chọn) ----
const snoozeSchema = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
  date: z.string().datetime().optional(),
});
followupsRouter.post(
  '/:id/snooze',
  asyncHandler(async (req, res) => {
    const parsed = snoozeSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.days && !parsed.data.date))
      throw badRequest('Cần chọn số ngày hoặc ngày cụ thể.');
    const fu = await loadFollowUp(String(req.params.id));
    const newDue = parsed.data.date
      ? new Date(parsed.data.date)
      : addDays(new Date(), parsed.data.days!);
    await prisma.followUp.update({
      where: { id: fu.id },
      data: { dueDate: newDue, status: 'hen_lai', reminderCount: { increment: 1 } },
    });
    await recordStatus(fu.id, fu.status, 'hen_lai', req.auth!.userId, 'Dời nhắc');
    res.json({ ok: true });
  }),
);

// ---- Đóng (bắt buộc chọn lý do) ----
const closeSchema = z.object({
  closeReason: z.enum([
    'khong_dung_nua',
    'doi_sp',
    'mua_noi_khac',
    'khong_phan_hoi',
    'be_da_lon',
    'khac',
  ]),
  note: z.string().optional(),
  version: z.number().int().optional(),
});
followupsRouter.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Đóng việc BẮT BUỘC chọn lý do.');
    const fu = await loadFollowUp(String(req.params.id));
    await guardFollowUpVersion(fu.id, parsed.data.version);
    await prisma.followUp.update({
      where: { id: fu.id },
      data: { status: 'dong', closeReason: parsed.data.closeReason, claimState: 'completed' },
    });
    await recordStatus(fu.id, fu.status, 'dong', req.auth!.userId, parsed.data.note);
    res.json({ ok: true });
  }),
);

// ---- Đánh dấu đã mua lại ----
// 🔴 CONV-01 (FIX-5): KHÔNG set thẳng da_mua_lai. Phải XÁC MINH với hóa đơn KV trước.
followupsRouter.post(
  '/:id/mark-purchased',
  asyncHandler(async (req, res) => {
    const fu = await loadFollowUp(String(req.params.id));
    const now = new Date();
    const userId = req.auth!.userId;
    const verification = await verifyRepurchase(prisma, fu.id, cfg, now);

    if (!verification.verified) {
      // Không có hóa đơn khớp => KHÔNG đóng. Ghi pending, giữ việc MỞ.
      await recordConversion({
        followUpId: fu.id,
        verificationStatus: 'not_found',
        attributionStatus: 'not_attributed',
        customerReport: 'already_purchased',
      });
      res.json({
        ok: false,
        verified: false,
        reason: 'not_found',
        message: 'Chưa tìm thấy hóa đơn mua lại khớp trong cửa sổ đối soát — giữ việc mở.',
      });
      return;
    }

    // 🔴 CONV-03 (ISSUE-9): attribution chỉ khi mua SAU lần liên hệ trước đó (fu.contactedAt ?? now).
    const contactAt = fu.contactedAt ?? now;
    const attributed =
      verification.purchaseDate != null && verification.purchaseDate >= contactAt;
    await recordConversion({
      followUpId: fu.id,
      verificationStatus: 'verified',
      attributionStatus: attributed ? 'attributed' : 'not_attributed',
      customerReport: 'already_purchased',
      invoiceId: verification.invoiceId,
      invoiceLineId: verification.invoiceLineId,
      matchedAt: now,
    });
    await prisma.followUp.update({
      where: { id: fu.id },
      data: { status: 'da_mua_lai', claimState: 'completed' },
    });
    await recordStatus(fu.id, fu.status, 'da_mua_lai', userId, 'Xác minh có hóa đơn mua lại (KV)');
    res.json({ ok: true, verified: true, invoiceLineId: verification.invoiceLineId });
  }),
);

// ---- Chuyển người phụ trách ----
const reassignSchema = z.object({ assigneeId: z.string().min(1) });
followupsRouter.post(
  '/:id/reassign',
  asyncHandler(async (req, res) => {
    const parsed = reassignSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu người phụ trách mới.');
    const fu = await loadFollowUp(String(req.params.id));
    await prisma.followUp.update({
      where: { id: fu.id },
      data: { assigneeId: parsed.data.assigneeId, claimState: 'unclaimed', claimedBy: null },
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'followup.reassign',
      objectType: 'follow_up',
      objectId: fu.id,
      newValue: { assigneeId: parsed.data.assigneeId },
    });
    res.json({ ok: true });
  }),
);

// ---- Xác nhận bé (suggested -> confirmed) ----
const confirmBabySchema = z.object({ babyId: z.string().min(1) });
followupsRouter.post(
  '/:id/confirm-baby',
  requirePermission('manageBaby'),
  asyncHandler(async (req, res) => {
    const parsed = confirmBabySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu bé cần xác nhận.');
    const fu = await loadFollowUp(String(req.params.id));
    // 🔴 SEC-FIX-1: bé xác nhận phải thuộc đúng khách của follow-up (chống IDOR gán bé chéo khách).
    await assertBabyBelongsToCustomer(parsed.data.babyId, fu.customerId);

    const sources = await prisma.reminderSource.findMany({
      where: { followUpId: fu.id },
      include: { lines: true },
    });
    let updatedAllocations = 0;
    for (const s of sources) {
      if (s.assignmentStatus !== 'suggested') continue;
      await prisma.reminderSource.update({
        where: { id: s.id },
        data: { babyId: parsed.data.babyId, babyKey: parsed.data.babyId, assignmentStatus: 'confirmed', confidenceLevel: 'high' },
      });
      for (const line of s.lines) {
        if (!line.allocationId) continue;
        await prisma.invoiceItemBabyAllocation.update({
          where: { id: line.allocationId },
          data: {
            babyId: parsed.data.babyId,
            assignmentStatus: 'confirmed',
            assignmentConfidence: 'high',
            confirmedBy: req.auth!.userId,
            confirmedAt: new Date(),
            version: { increment: 1 },
          },
        });
        updatedAllocations++;
      }
    }
    await writeAudit({
      userId: req.auth!.userId,
      action: 'followup.confirm_baby',
      objectType: 'follow_up',
      objectId: fu.id,
      newValue: { babyId: parsed.data.babyId, updatedAllocations },
    });
    res.json({ ok: true, updatedAllocations });
  }),
);

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000);
}
