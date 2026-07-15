// SCR-11 Gộp khách (§11.3 — CUS-14..20, PHONE-01..04, CONSENT-01..03, MERGE-01..07).
// 🔴 Nguyên tắc #7: KHÔNG tự động gộp; CHỈ Chủ shop duyệt + nhập lại mật khẩu. KHÔNG gợi ý theo tên.
import { Router } from 'express';
import { z } from 'zod';
import { Prisma, CustomerRoleType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { maskPhone } from '../../security/masking';
import { assertCustomerVisible, visibleCustomerWhere } from '../../security/customerVisibility';
import { verifyReauth } from '../../security/reauth';
import { formatVnDateTime } from '../../lib/datetime';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { scoreDedupPair, type MergeCandidateCustomer } from '../../engines/dedup';
import {
  buildMergePreview,
  canUnmerge,
  mergePhoneMetadata,
  resolveMergedConsent,
  type ConsentEventInput,
  type MergeSideInput,
  type PhoneInput,
} from '../../engines/merge';

export const mergeRouter = Router();
mergeRouter.use(requireAuth);

const threshold = DEFAULT_ENGINE_CONFIG.dedup.mergeSuggestThreshold; // ⚙️ dedup.merge_suggest_threshold (90)

// ---------- GET /dedup-candidates ----------
// Masking áp: marketing thấy cặp nghi trùng nhưng SĐT bị mask, KHÔNG thấy bé (MERGE-06).
mergeRouter.get(
  '/dedup-candidates',
  asyncHandler(async (req, res) => {
    const perms = req.permissions!;
    // 🔴 BẤT BIẾN #6: user thiếu viewOrganization KHÔNG thấy khách sỉ trong danh sách nghi trùng ⇒ loại từ nguồn.
    const customers = await prisma.customerCrm.findMany({
      where: { deletedAt: null, ...visibleCustomerWhere(perms) },
      include: { phones: true },
    });
    const cands: MergeCandidateCustomer[] = customers.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phones: c.phones.map((p) => p.phoneRaw),
      facebook: c.facebook,
      zalo: c.zalo,
      address: c.careAddress,
    }));

    const pairs: {
      a: { id: string; displayName: string; phone: string | null };
      b: { id: string; displayName: string; phone: string | null };
      score: number;
      reasons: string[];
    }[] = [];
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        const decision = scoreDedupPair(cands[i]!, cands[j]!, threshold);
        if (!decision.suggest) continue; // 🔴 tên giống / family-phone-risk => không gợi ý
        const ca = customers[i]!;
        const cb = customers[j]!;
        pairs.push({
          a: {
            id: ca.id,
            displayName: ca.displayName ?? ca.fullName,
            phone: maskPhone(ca.phones[0]?.phoneRaw ?? null, perms.viewSensitive),
          },
          b: {
            id: cb.id,
            displayName: cb.displayName ?? cb.fullName,
            phone: maskPhone(cb.phones[0]?.phoneRaw ?? null, perms.viewSensitive),
          },
          score: decision.score,
          reasons: decision.reasons,
        });
      }
    }
    pairs.sort((x, y) => y.score - x.score);
    res.json({
      threshold,
      note: 'Gợi ý KHÔNG BAO GIỜ chỉ vì trùng tên; chung SĐT khác tên (gia đình) không gợi ý.',
      masked: !perms.viewSensitive,
      items: pairs,
    });
  }),
);

// ---------- helper: nạp 1 phía để dựng preview/merge ----------
async function loadSide(id: string): Promise<MergeSideInput | null> {
  const c = await prisma.customerCrm.findFirst({
    where: { id, deletedAt: null },
    include: {
      phones: true,
      externalIdentities: true,
      consentEvents: { include: { consentType: true } },
      _count: {
        select: {
          babies: { where: { deletedAt: null } },
          consultations: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!c) return null;
  const phones: PhoneInput[] = c.phones.map((p) => ({
    phoneRaw: p.phoneRaw,
    type: p.type,
    isPrimary: p.isPrimary,
    source: p.source,
  }));
  const consentEvents: ConsentEventInput[] = c.consentEvents.map((e) => ({
    consentKey: e.consentType.key,
    subjectKey: e.subjectType === 'baby' ? `baby:${e.babyId ?? ''}` : 'customer',
    status: e.status as 'granted' | 'revoked',
    at: e.createdAt,
  }));
  return {
    id: c.id,
    fullName: c.fullName,
    displayName: c.displayName,
    facebook: c.facebook,
    zalo: c.zalo,
    careAddress: c.careAddress,
    phones,
    consentEvents,
    babyCount: c._count.babies,
    consultationCount: c._count.consultations,
    kvCodes: c.externalIdentities.map((e) => e.externalCode ?? e.externalCustomerId),
    createdAt: c.createdAt,
  };
}

// ---------- POST /merge/preview ----------
// Đề xuất gộp: chu_shop/crm_officer/cskh (manageCustomer). Marketing => 403.
const previewSchema = z.object({ masterId: z.string().min(1), mergedId: z.string().min(1) });
mergeRouter.post(
  '/merge/preview',
  requirePermission('manageCustomer'),
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cần chọn khách GIỮ (master) và khách gộp vào.');
    if (parsed.data.masterId === parsed.data.mergedId)
      throw badRequest('Không thể gộp một khách với chính nó.');
    // 🔴 BẤT BIẾN #6: manageCustomer nhưng thiếu viewOrganization (cskh/crm_officer bị hạ quyền) KHÔNG
    // được preview gộp khi bất kỳ phía nào là KHÁCH SỈ. 404 KHỚP message not-found (không lộ tồn tại).
    const perms = req.permissions!;
    await assertCustomerVisible(parsed.data.masterId, perms, 'Không tìm thấy khách hàng để gộp.');
    await assertCustomerVisible(parsed.data.mergedId, perms, 'Không tìm thấy khách hàng để gộp.');
    const [master, merged] = await Promise.all([
      loadSide(parsed.data.masterId),
      loadSide(parsed.data.mergedId),
    ]);
    if (!master || !merged) throw notFound('Không tìm thấy khách hàng để gộp.');
    res.json(buildMergePreview(master, merged));
  }),
);

// ---------- POST /merge ----------
// 🔴 MERGE-01: CHỈ Chủ shop (approveMerge) + nhập lại mật khẩu.
const mergeSchema = z.object({
  masterId: z.string().min(1),
  mergedId: z.string().min(1),
  password: z.string().min(1),
});
mergeRouter.post(
  '/merge',
  requirePermission('approveMerge'),
  asyncHandler(async (req, res) => {
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu thông tin gộp hoặc mật khẩu xác minh.');
    if (parsed.data.masterId === parsed.data.mergedId)
      throw badRequest('Không thể gộp một khách với chính nó.');
    // 🔴 xác minh lại mật khẩu chủ shop — CÓ chống brute-force (CWE-307: khóa userId+IP, audit lần sai).
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);

    // 🔴 BẤT BIẾN #6 (phòng thủ chiều sâu): chặn gộp khi phía nào là KHÁCH SỈ mà thiếu viewOrganization.
    // (approveMerge chỉ chu_shop ⇒ luôn viewOrganization=true ⇒ vô hại; giữ nếu ma trận quyền đổi sau.)
    await assertCustomerVisible(parsed.data.masterId, req.permissions!);
    await assertCustomerVisible(parsed.data.mergedId, req.permissions!);

    const { masterId, mergedId } = parsed.data;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // 🔴 FIX-2 (chống gộp ĐÔI / race): validation + guard NGUYÊN TỬ nằm TRONG transaction.
      // Master phải còn sống — không gộp vào khách đã bị gộp/xóa.
      const master = await tx.customerCrm.findFirst({
        where: { id: masterId, deletedAt: null },
        select: { id: true },
      });
      if (!master) throw notFound('Không tìm thấy khách hàng GIỮ (master) hoặc đã bị gộp/xóa.');
      // Guard nguyên tử: soft-delete merged NGAY, yêu cầu đúng 1 dòng CÒN SỐNG (deletedAt=null).
      // 2 request cùng mergedId chạy song song ⇒ request sau thấy count=0 ⇒ 409 (không gộp đôi).
      const guard = await tx.customerCrm.updateMany({
        where: { id: mergedId, deletedAt: null },
        data: { deletedAt: now, retentionStatus: 'masked' },
      });
      if (guard.count !== 1) throw conflict('Khách này đã được gộp hoặc không còn khả dụng.');

      // 🔴 KHÔNG gộp hồ sơ bé — chuyển sang master, gắn cờ nghi trùng để người dùng kiểm.
      await tx.babyProfile.updateMany({
        where: { customerId: mergedId },
        data: { customerId: masterId, suspectedDuplicateBaby: true },
      });
      // GIỮ TẤT CẢ: tư vấn, mã KV, follow-up, nhắc, consent (FULL lịch sử).
      await tx.consultation.updateMany({ where: { customerId: mergedId }, data: { customerId: masterId } });
      await tx.customerExternalIdentity.updateMany({ where: { customerId: mergedId }, data: { customerId: masterId } });
      await tx.customerConsent.updateMany({ where: { customerId: mergedId }, data: { customerId: masterId } });
      await tx.consentEvent.updateMany({ where: { customerId: mergedId }, data: { customerId: masterId } });
      await tx.followUp.updateMany({ where: { customerId: mergedId }, data: { customerId: masterId } });
      await tx.reminderSource.updateMany({ where: { customerId: mergedId }, data: { customerId: masterId } });

      // 🔴 Snapshot vai của khách BỊ GỘP TRƯỚC khi moveDedup chuyển vai sang master (lúc mergedId còn nguyên
      //    vai) — để unmerge sau này khôi phục ĐÚNG vai (đặc biệt wholesale_contact). Lưu vào mergeHistory bên dưới.
      const mergedRoleRows = await tx.customerRole.findMany({ where: { customerId: mergedId } });
      const mergedRolesSnapshot: string[] = mergedRoleRows.map((r) => r.role);
      // Vai (unique customerId+role): dedupe khi chuyển.
      await moveDedup(
        Promise.resolve(mergedRoleRows),
        (row) => tx.customerRole.findFirst({ where: { customerId: masterId, role: row.role } }),
        (id) => tx.customerRole.update({ where: { id }, data: { customerId: masterId } }),
        (id) => tx.customerRole.delete({ where: { id } }),
      );
      // Nhãn (unique customerId+tag).
      await moveDedup(
        tx.customerTagAssignment.findMany({ where: { customerId: mergedId } }),
        (row) => tx.customerTagAssignment.findFirst({ where: { customerId: masterId, tag: row.tag } }),
        (id) => tx.customerTagAssignment.update({ where: { id }, data: { customerId: masterId } }),
        (id) => tx.customerTagAssignment.delete({ where: { id } }),
      );
      // Vai tổ chức (unique customerId+organizationId+role).
      await moveDedup(
        tx.customerOrganizationRole.findMany({ where: { customerId: mergedId } }),
        (row) =>
          tx.customerOrganizationRole.findFirst({
            where: { customerId: masterId, organizationId: row.organizationId, role: row.role },
          }),
        (id) => tx.customerOrganizationRole.update({ where: { id }, data: { customerId: masterId } }),
        (id) => tx.customerOrganizationRole.delete({ where: { id } }),
      );
      // Nhóm thí nghiệm (unique experimentId+customerId).
      await moveDedup(
        tx.experimentAssignment.findMany({ where: { customerId: mergedId } }),
        (row) =>
          tx.experimentAssignment.findFirst({
            where: { customerId: masterId, experimentId: row.experimentId },
          }),
        (id) => tx.experimentAssignment.update({ where: { id }, data: { customerId: masterId } }),
        (id) => tx.experimentAssignment.delete({ where: { id } }),
      );

      // 🔴 PHONE-01 canonical: KHÔNG nhân đôi số. Trùng canonical ⇒ HỢP NHẤT nhãn/nguồn vào bản ghi
      //    master (FIX-1: KHÔNG xóa để mất type/source) rồi bỏ bản trùng của merged.
      const masterPhones = await tx.customerPhone.findMany({ where: { customerId: masterId } });
      const masterByNorm = new Map(masterPhones.map((p) => [p.phoneNormalized, p]));
      const masterHadPhones = masterPhones.length > 0;
      const mergedPhones = await tx.customerPhone.findMany({ where: { customerId: mergedId } });
      for (const p of mergedPhones) {
        const masterPhone = masterByNorm.get(p.phoneNormalized);
        if (masterPhone) {
          // Gộp metadata cả hai vào bản ghi master (giữ nhãn cụ thể, union is_primary, ưu tiên nguồn KV).
          const meta = mergePhoneMetadata(
            { type: masterPhone.type, isPrimary: masterPhone.isPrimary, source: masterPhone.source },
            { type: p.type, isPrimary: p.isPrimary, source: p.source },
          );
          const updated = await tx.customerPhone.update({
            where: { id: masterPhone.id },
            data: { type: meta.type as never, isPrimary: meta.isPrimary, source: meta.source as never },
          });
          masterByNorm.set(p.phoneNormalized, updated); // để lần trùng kế tiếp (nếu có) tích lũy tiếp
          await tx.customerPhone.delete({ where: { id: p.id } });
        } else {
          const moved = await tx.customerPhone.update({
            where: { id: p.id },
            data: { customerId: masterId, isPrimary: masterHadPhones ? false : p.isPrimary },
          });
          masterByNorm.set(p.phoneNormalized, moved);
        }
      }

      // 🔴 CONSENT-01: hợp nhất trạng thái consent hiện hành (sự kiện mới nhất thắng; revoked thắng khi hòa).
      await reconcileConsent(tx, masterId);

      // Khách bị gộp ĐÃ soft-delete ở guard nguyên tử phía trên (MERGE-07 giữ nguồn, KHÔNG xóa cứng).
      // mergeHistory CHỈ ghi khi guard qua ⇒ đảm bảo không sinh lịch sử gộp trùng.
      await tx.mergeHistory.create({
        data: {
          masterId,
          mergedId,
          mergedBy: req.auth!.userId,
          mergedAt: now,
          revertible: true,
          // Snapshot vai khách bị gộp (mảng role string) ⇒ unmerge khôi phục đúng vai. Mảng rỗng nếu không có vai.
          mergedRoles: mergedRolesSnapshot,
        },
      });
    });

    await writeAudit({
      userId: req.auth!.userId,
      action: 'customer.merge',
      objectType: 'customer',
      objectId: masterId,
      newValue: { masterId, mergedId },
      reason: 'Gộp khách (chủ shop, đã xác minh mật khẩu)',
      ip: req.ip,
    });
    res.json({
      ok: true,
      masterId,
      mergedId,
      note: 'KHÔNG XÓA dữ liệu nguồn; hồ sơ bé GIỮ RIÊNG (gắn cờ nghi trùng), consent giữ FULL lịch sử.',
    });
  }),
);

// ---------- POST /unmerge ----------
// 🔴 MERGE-05/CUS-19: chỉ khi CHƯA phát sinh dữ liệu mới sau gộp; đã phát sinh => tạo ticket xử lý tay.
const unmergeSchema = z.object({ mergedId: z.string().min(1), reason: z.string().optional() });
mergeRouter.post(
  '/unmerge',
  requirePermission('approveMerge'),
  asyncHandler(async (req, res) => {
    const parsed = unmergeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu khách cần tách.');
    const history = await prisma.mergeHistory.findFirst({
      where: { mergedId: parsed.data.mergedId },
      orderBy: { mergedAt: 'desc' },
    });
    if (!history) throw notFound('Không tìm thấy lịch sử gộp cho khách này.');

    // 🔴 BẤT BIẾN #6 (phòng thủ chiều sâu): không tách khách sỉ nếu thiếu viewOrganization.
    // (approveMerge chỉ chu_shop ⇒ vô hại; message khớp not-found ở trên để không lộ tồn tại.)
    await assertCustomerVisible(history.masterId, req.permissions!, 'Không tìm thấy lịch sử gộp cho khách này.');
    await assertCustomerVisible(history.mergedId, req.permissions!, 'Không tìm thấy lịch sử gộp cho khách này.');

    // Mốc dữ liệu mới nhất gắn với master SAU khi gộp (follow-up/tư vấn/consent/bé/nhắc).
    const newestDataAt = await newestDataAfterMerge(history.masterId);
    if (!canUnmerge(history.mergedAt, newestDataAt)) {
      // Đã phát sinh dữ liệu mới => KHÔNG tự tách; tạo ticket xử lý tay (bản gọn an toàn).
      const ticket = await prisma.mergeUnmergeTicket.create({
        data: {
          mergeHistoryId: history.id,
          masterId: history.masterId,
          mergedId: history.mergedId,
          reason:
            parsed.data.reason ??
            'Đã phát sinh dữ liệu mới sau khi gộp — cần xử lý tay để tránh mất/nhầm dữ liệu.',
          requestedBy: req.auth!.userId,
        },
      });
      await writeAudit({
        userId: req.auth!.userId,
        action: 'customer.unmerge_ticket',
        objectType: 'customer',
        objectId: history.masterId,
        newValue: { ticketId: ticket.id, mergedId: history.mergedId },
      });
      throw conflict(
        `Đã phát sinh dữ liệu mới sau khi gộp — không thể tự tách. Đã tạo ticket xử lý tay #${ticket.id}.`,
      );
    }

    // 🔴 BẤT BIẾN #6 — khôi phục vai khi tách (ISSUE-1, fix CHUẨN):
    //  - Gộp MỚI đã snapshot vai của khách bị gộp (mergedRoles != null, kể cả mảng rỗng) ⇒ tự tách AN TOÀN cho
    //    MỌI loại khách (gồm khách sỉ): khôi phục vai từ snapshot bên dưới ⇒ KHÔNG còn ép ticket oan.
    //  - Gộp CŨ trước migration (mergedRoles == null) ⇒ không thể khôi phục vai an toàn: GIỮ mitigation — nếu
    //    master ĐANG mang wholesale_contact (lần gộp liên quan khách sỉ) thì định tuyến ticket xử lý tay để
    //    tránh khách sỉ hồi sinh MẤT vai và lộ với user thiếu viewOrganization. Vai bán lẻ cũ vẫn tự tách như trước.
    const roleSnapshot = history.mergedRoles; // Prisma.JsonValue | null
    const hasRoleSnapshot = roleSnapshot !== null; // null ⇒ lịch sử gộp cũ (trước migration)
    if (!hasRoleSnapshot) {
      const masterRoles = await prisma.customerRole.findMany({
        where: { customerId: history.masterId },
        select: { role: true },
      });
      if (masterRoles.some((r) => r.role === 'wholesale_contact')) {
        const ticket = await prisma.mergeUnmergeTicket.create({
          data: {
            mergeHistoryId: history.id,
            masterId: history.masterId,
            mergedId: history.mergedId,
            reason:
              parsed.data.reason ??
              'Lần gộp CŨ (chưa snapshot vai) liên quan KHÁCH SỈ — cần xử lý tay để khôi phục đúng vai wholesale_contact khi tách.',
            requestedBy: req.auth!.userId,
          },
        });
        await writeAudit({
          userId: req.auth!.userId,
          action: 'customer.unmerge_ticket',
          objectType: 'customer',
          objectId: history.masterId,
          newValue: { ticketId: ticket.id, mergedId: history.mergedId, reason: 'wholesale' },
        });
        throw conflict(
          `Lần gộp liên quan khách sỉ (lịch sử cũ chưa lưu vai) — không thể tự tách để tránh mất vai. Đã tạo ticket xử lý tay #${ticket.id}.`,
        );
      }
    }

    // Chưa phát sinh dữ liệu mới => cho tách: khôi phục khách bị gộp (bỏ soft-delete) + khôi phục vai từ snapshot.
    const rolesToRestore = parseSnapshotRoles(roleSnapshot);
    await prisma.$transaction(async (tx) => {
      await tx.customerCrm.update({
        where: { id: history.mergedId },
        data: { deletedAt: null, retentionStatus: 'active' },
      });
      // 🔴 Khôi phục vai khách bị gộp từ snapshot (gồm wholesale_contact). skipDuplicates phòng trùng do
      //    unique [customerId, role]. KHÔNG xóa vai khỏi master (bảo thủ: master giữ union, tránh gỡ nhầm vai
      //    vốn có của master). Snapshot null/rỗng ⇒ không có vai để khôi phục (fallback đã chặn khách sỉ ở trên).
      if (rolesToRestore.length > 0) {
        await tx.customerRole.createMany({
          data: rolesToRestore.map((role) => ({ customerId: history.mergedId, role })),
          skipDuplicates: true,
        });
      }
      await tx.mergeHistory.update({ where: { id: history.id }, data: { revertible: false } });
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: 'customer.unmerge',
      objectType: 'customer',
      objectId: history.masterId,
      newValue: { mergedId: history.mergedId, restoredRoles: rolesToRestore },
      reason: 'Tách khách (chưa phát sinh dữ liệu mới sau gộp)',
    });
    res.json({
      ok: true,
      note: 'Đã khôi phục khách bị gộp cùng vai (nếu có snapshot). Lưu ý: FK khác (bé/tư vấn/consent/nhắc) đã chuyển sang master KHÔNG tự động trả lại — trường hợp phức tạp dùng ticket.',
      restoredRoles: rolesToRestore,
      mergedAt: formatVnDateTime(history.mergedAt),
    });
  }),
);

// ---------- helpers ----------

// Tập vai hợp lệ lấy TỪ enum Prisma (không hard-code, tự đồng bộ nếu enum đổi).
const VALID_CUSTOMER_ROLES = new Set<string>(Object.values(CustomerRoleType));

/**
 * Đọc snapshot vai (MergeHistory.mergedRoles) an toàn từ Json: chỉ giữ phần tử là CHUỖI khớp enum
 * CustomerRoleType (lọc dữ liệu rác/JSON lạ). Không phải mảng (null/object/…) ⇒ trả [].
 */
export function parseSnapshotRoles(value: Prisma.JsonValue | null): CustomerRoleType[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is CustomerRoleType => typeof v === 'string' && VALID_CUSTOMER_ROLES.has(v),
  );
}

/** Chuyển các dòng con sang master, bỏ dòng trùng (theo unique) để không vi phạm ràng buộc. */
async function moveDedup<T extends { id: string }>(
  rowsPromise: Promise<T[]>,
  findConflict: (row: T) => Promise<{ id: string } | null>,
  move: (id: string) => Promise<unknown>,
  drop: (id: string) => Promise<unknown>,
): Promise<void> {
  const rows = await rowsPromise;
  for (const row of rows) {
    const conflictRow = await findConflict(row);
    if (conflictRow) await drop(row.id);
    else await move(row.id);
  }
}

/** 🔴 CONSENT-01: đặt lại customer_consents hiện hành của master theo sự kiện mới nhất (revoked thắng khi hòa). */
async function reconcileConsent(
  tx: Prisma.TransactionClient,
  masterId: string,
): Promise<void> {
  const events = await tx.consentEvent.findMany({ where: { customerId: masterId } });
  if (events.length === 0) return;
  const resolved = resolveMergedConsent(
    events.map((e) => ({
      consentKey: e.consentTypeId,
      subjectKey: e.subjectType === 'baby' ? `baby:${e.babyId ?? ''}` : 'customer',
      status: e.status as 'granted' | 'revoked',
      at: e.createdAt,
    })),
  );
  const resolvedByKey = new Map(
    resolved.map((r) => [`${r.consentKey}__${r.subjectKey}`, r]),
  );
  const consents = await tx.customerConsent.findMany({ where: { customerId: masterId } });
  const seen = new Set<string>();
  for (const cc of consents) {
    const key = `${cc.consentTypeId}__${cc.subjectType === 'baby' ? `baby:${cc.babyId ?? ''}` : 'customer'}`;
    const winner = resolvedByKey.get(key);
    if (!winner) continue;
    if (seen.has(key)) {
      // dedupe: giữ 1 dòng hiện hành / khóa, xóa dòng thừa (lịch sử vẫn ở consent_events).
      await tx.customerConsent.delete({ where: { id: cc.id } });
      continue;
    }
    seen.add(key);
    await tx.customerConsent.update({
      where: { id: cc.id },
      data: {
        status: winner.status,
        grantedAt: winner.status === 'granted' ? winner.at : null,
        revokedAt: winner.status === 'revoked' ? winner.at : null,
      },
    });
  }
}

/** Mốc tạo mới nhất của dữ liệu gắn với master (dùng cho guard unmerge). */
async function newestDataAfterMerge(masterId: string): Promise<Date | null> {
  const [fu, con, ev, baby] = await Promise.all([
    prisma.followUp.findFirst({ where: { customerId: masterId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.consultation.findFirst({ where: { customerId: masterId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.consentEvent.findFirst({ where: { customerId: masterId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.babyProfile.findFirst({ where: { customerId: masterId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  const dates = [fu?.createdAt, con?.createdAt, ev?.createdAt, baby?.createdAt].filter(
    (d): d is Date => d != null,
  );
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}
