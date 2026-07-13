// 🔴 Gộp 2 hồ sơ bé TRÙNG (cùng một khách) — chỉ Chủ shop. Nguyên tắc BẤT BIẾN #1: không đoán/ghi đè bé.
// Dời mọi bản ghi liên kết từ bé TRÙNG → bé MASTER, gap-fill field master còn trống, soft-delete bé trùng,
// TẤT CẢ trong 1 transaction + audit append-only. Bé trùng chỉ soft-delete ⇒ khôi phục được nếu gộp nhầm.
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/http';
import { writeAudit } from '../../security/audit';
import { planBabyGapFill, type BabyMergeSnapshot } from '../../engines/babyMerge';

export interface BabyMergeResult {
  masterBabyId: string;
  mergedBabyId: string;
  reassigned: {
    consultations: number;
    consents: number;
    consentEvents: number;
    allocations: number;
    suggestedAllocations: number;
    usages: number;
    usagesDropped: number;
    avoidances: number;
    avoidancesDropped: number;
    reminderSourcesToCustomerLevel: number;
  };
  gapFilledFields: string[];
}

/** Trích ảnh chụp field gộp được từ bản ghi BabyProfile (cho engine gap-fill thuần). */
function toSnapshot(b: BabyMergeSnapshot): BabyMergeSnapshot {
  return {
    babyName: b.babyName,
    birthDate: b.birthDate,
    estimatedBirthMonth: b.estimatedBirthMonth,
    ageMonthsAtRecording: b.ageMonthsAtRecording,
    ageRecordedAt: b.ageRecordedAt,
    gender: b.gender,
    allergies: b.allergies,
    condition: b.condition,
    note: b.note,
  };
}

/**
 * 🔴 Gộp bé trùng vào master.
 * - Cả hai phải: tồn tại (chưa soft-delete), CÙNG khách, KHÁC id.
 * - Optimistic lock: nếu truyền expected*Version mà lệch ⇒ 409 (CONC-03).
 * - Dời FK: consultations/consents/consentEvents/allocations dời thẳng (không unique).
 *   usages/avoidances có unique [babyId,kvProductId] ⇒ master THẮNG (xóa dòng trùng của bé trùng, dời phần còn lại).
 *   reminder_sources của bé trùng ⇒ HẠ VỀ CẤP KHÁCH (babyId=null, babyKey='customer_level') — ĐÚNG pattern
 *   soft-delete bé hiện có (giữ việc, không phá hủy; sourceKey giữ nguyên nên KHÔNG collision). Cron tái sinh cho master.
 * - Gap-fill master từ bé trùng (chỉ field master trống). Soft-delete bé trùng. Audit.
 */
export async function mergeBabies(params: {
  masterBabyId: string;
  duplicateBabyId: string;
  actorUserId: string;
  expectedMasterVersion?: number;
  expectedDuplicateVersion?: number;
}): Promise<BabyMergeResult> {
  const { masterBabyId, duplicateBabyId, actorUserId } = params;
  if (masterBabyId === duplicateBabyId) throw badRequest('Không thể gộp một bé với chính nó.');

  return prisma.$transaction(async (tx) => {
    const master = await tx.babyProfile.findFirst({ where: { id: masterBabyId, deletedAt: null } });
    const duplicate = await tx.babyProfile.findFirst({ where: { id: duplicateBabyId, deletedAt: null } });
    if (!master) throw notFound('Không tìm thấy hồ sơ bé giữ lại (master).');
    if (!duplicate) throw notFound('Không tìm thấy hồ sơ bé trùng.');
    if (master.customerId !== duplicate.customerId) {
      // 🔴 Chỉ gộp bé CÙNG một khách — bé thuộc về đúng một khách; gộp chéo khách là sai nghiệp vụ.
      throw badRequest('Chỉ gộp được hai bé thuộc CÙNG một khách hàng.');
    }
    if (params.expectedMasterVersion != null && master.version !== params.expectedMasterVersion) {
      throw conflict('Hồ sơ bé giữ lại vừa được cập nhật, vui lòng tải lại rồi thử lại.');
    }
    if (params.expectedDuplicateVersion != null && duplicate.version !== params.expectedDuplicateVersion) {
      throw conflict('Hồ sơ bé trùng vừa được cập nhật, vui lòng tải lại rồi thử lại.');
    }

    // --- Dời FK không ràng buộc unique ---
    const consultations = await tx.consultation.updateMany({
      where: { babyId: duplicateBabyId },
      data: { babyId: masterBabyId },
    });
    const consents = await tx.customerConsent.updateMany({
      where: { babyId: duplicateBabyId },
      data: { babyId: masterBabyId },
    });
    const consentEvents = await tx.consentEvent.updateMany({
      where: { babyId: duplicateBabyId },
      data: { babyId: masterBabyId },
    });
    const allocations = await tx.invoiceItemBabyAllocation.updateMany({
      where: { babyId: duplicateBabyId },
      data: { babyId: masterBabyId },
    });
    const suggestedAllocations = await tx.invoiceItemBabyAllocation.updateMany({
      where: { suggestedBabyId: duplicateBabyId },
      data: { suggestedBabyId: masterBabyId },
    });

    // --- usages/avoidances: unique [babyId, kvProductId] ⇒ master THẮNG khi trùng sản phẩm ---
    const masterUsageProducts = new Set(
      (await tx.babyProductUsage.findMany({ where: { babyId: masterBabyId }, select: { kvProductId: true } })).map(
        (r) => r.kvProductId,
      ),
    );
    const dupUsages = await tx.babyProductUsage.findMany({ where: { babyId: duplicateBabyId }, select: { id: true, kvProductId: true } });
    const usageIdsToDrop = dupUsages.filter((u) => masterUsageProducts.has(u.kvProductId)).map((u) => u.id);
    const usageIdsToMove = dupUsages.filter((u) => !masterUsageProducts.has(u.kvProductId)).map((u) => u.id);
    if (usageIdsToDrop.length) await tx.babyProductUsage.deleteMany({ where: { id: { in: usageIdsToDrop } } });
    if (usageIdsToMove.length)
      await tx.babyProductUsage.updateMany({ where: { id: { in: usageIdsToMove } }, data: { babyId: masterBabyId } });

    const masterAvoidProducts = new Set(
      (await tx.babyProductAvoidance.findMany({ where: { babyId: masterBabyId }, select: { kvProductId: true } })).map(
        (r) => r.kvProductId,
      ),
    );
    const dupAvoids = await tx.babyProductAvoidance.findMany({ where: { babyId: duplicateBabyId }, select: { id: true, kvProductId: true } });
    const avoidIdsToDrop = dupAvoids.filter((a) => masterAvoidProducts.has(a.kvProductId)).map((a) => a.id);
    const avoidIdsToMove = dupAvoids.filter((a) => !masterAvoidProducts.has(a.kvProductId)).map((a) => a.id);
    if (avoidIdsToDrop.length) await tx.babyProductAvoidance.deleteMany({ where: { id: { in: avoidIdsToDrop } } });
    if (avoidIdsToMove.length)
      await tx.babyProductAvoidance.updateMany({ where: { id: { in: avoidIdsToMove } }, data: { babyId: masterBabyId } });

    // --- reminder_sources của bé trùng: HẠ về cấp khách (ĐÚNG pattern soft-delete bé; sourceKey giữ nguyên
    //     ⇒ không collision; việc không mất; cron tái sinh cho master) ---
    const remindersToCustomerLevel = await tx.reminderSource.updateMany({
      where: { babyId: duplicateBabyId },
      data: { babyId: null, babyKey: 'customer_level' },
    });

    // --- Gap-fill master (chỉ field trống) + bump version + xóa cờ nghi trùng ---
    // 🔴 CONC-03: khóa lạc quan Ở THỜI ĐIỂM GHI — ràng version=bản đã đọc + chưa soft-delete; count≠1 ⇒ có
    // người vừa sửa/xóa bé giữa chừng ⇒ ném lỗi ⇒ CẢ transaction (kể cả dời FK) rollback (không ghi từ snapshot cũ).
    const gapPatch = planBabyGapFill(toSnapshot(master), toSnapshot(duplicate));
    const gapFilledFields = Object.keys(gapPatch);
    const masterUpd = await tx.babyProfile.updateMany({
      where: { id: masterBabyId, version: master.version, deletedAt: null },
      data: { ...gapPatch, suspectedDuplicateBaby: false, version: { increment: 1 } },
    });
    if (masterUpd.count !== 1) {
      throw conflict('Hồ sơ bé giữ lại vừa được cập nhật, vui lòng tải lại rồi thử lại.');
    }

    // --- Soft-delete bé trùng (không hủy dữ liệu — DM-02) — cũng ràng version chống ghi từ snapshot cũ ---
    const dupUpd = await tx.babyProfile.updateMany({
      where: { id: duplicateBabyId, version: duplicate.version, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (dupUpd.count !== 1) {
      throw conflict('Hồ sơ bé trùng vừa được cập nhật, vui lòng tải lại rồi thử lại.');
    }

    const result: BabyMergeResult = {
      masterBabyId,
      mergedBabyId: duplicateBabyId,
      reassigned: {
        consultations: consultations.count,
        consents: consents.count,
        consentEvents: consentEvents.count,
        allocations: allocations.count,
        suggestedAllocations: suggestedAllocations.count,
        usages: usageIdsToMove.length,
        usagesDropped: usageIdsToDrop.length,
        avoidances: avoidIdsToMove.length,
        avoidancesDropped: avoidIdsToDrop.length,
        reminderSourcesToCustomerLevel: remindersToCustomerLevel.count,
      },
      gapFilledFields,
    };

    // 🔴 SEC-12: KHÔNG ghi giá trị hồ sơ bé thô vào audit (audit append-only không được thành kho dữ liệu bé).
    // Chỉ lưu ĐỊNH DANH bé trùng + TÊN field được điền bổ sung (không phải giá trị) + số bản ghi đã dời.
    await writeAudit(
      {
        userId: actorUserId,
        action: 'baby.merge',
        objectType: 'baby',
        objectId: masterBabyId,
        oldValue: { duplicateBabyId },
        newValue: { ...result.reassigned, gapFilledFields },
      },
      tx,
    );

    return result;
  });
}
