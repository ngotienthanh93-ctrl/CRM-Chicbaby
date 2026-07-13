// FIX-5 (CONV-01): xác minh "đã mua lại" với hóa đơn KV thật trước khi đóng follow-up.
// Đọc DB, dựng ứng viên, dùng primitive so khớp THUẦN `matchRepurchaseForVerify`.
// 🔴 Không khớp => KHÔNG đóng. Chống double-attribution: loại dòng/hóa đơn đã xác minh cho follow-up khác.
import type { PrismaClient } from '@prisma/client';
import type { EngineConfig } from '../../lib/config';
import { addDays } from '../../lib/datetime';
import {
  matchRepurchaseForVerify,
  type RepurchaseCandidate,
  type RepurchaseSource,
} from '../../engines/consumption';
import { CUSTOMER_LEVEL_KEY } from '../../engines/types';

export interface VerifyRepurchaseResult {
  verified: boolean;
  invoiceId?: string;
  invoiceLineId?: string;
  /** Purchase date của dòng khớp (để quyết định attribution). */
  purchaseDate?: Date;
}

/**
 * Tìm hóa đơn KV chứng minh khách đã mua lại trong cửa sổ ⚙️ verification_window_days.
 * Chỉ ĐỌC — không ghi. Endpoint quyết định ghi conversion + đổi trạng thái.
 */
export async function verifyRepurchase(
  db: PrismaClient,
  followUpId: string,
  config: EngineConfig,
  now: Date,
): Promise<VerifyRepurchaseResult> {
  const fu = await db.followUp.findUnique({
    where: { id: followUpId },
    include: { reminderSources: true },
  });
  if (!fu || fu.targetType !== 'customer' || !fu.customerId) {
    return { verified: false };
  }

  // Nguồn nhắc => tiêu chí khớp (babyKey + replacementGroup). Loại nguồn thiếu replacementGroup.
  const sources: RepurchaseSource[] = fu.reminderSources
    .filter((s) => s.replacementGroupId != null)
    .map((s) => ({
      customerId: fu.customerId!,
      babyKey: s.babyKey,
      replacementGroupId: s.replacementGroupId,
    }));
  if (sources.length === 0) return { verified: false };

  const sourceInvoiceIds = new Set(fu.reminderSources.map((s) => s.invoiceId));

  // Mã KV của khách (gộp mọi mã đã liên kết).
  const identities = await db.customerExternalIdentity.findMany({
    where: { customerId: fu.customerId, unlinkedAt: null },
    select: { externalCustomerId: true },
  });
  const kvIds = identities.map((i) => i.externalCustomerId);
  if (kvIds.length === 0) return { verified: false };

  // Chống double-attribution: loại dòng/hóa đơn đã được xác minh cho follow-up khác (CONV-02).
  const takenConversions = await db.followUpConversion.findMany({
    where: {
      verificationStatus: 'verified',
      followUpId: { not: followUpId },
    },
    select: { invoiceId: true, invoiceLineId: true },
  });
  const takenInvoiceIds = new Set(
    takenConversions.map((c) => c.invoiceId).filter((x): x is string => !!x),
  );
  const takenLineIds = new Set(
    takenConversions.map((c) => c.invoiceLineId).filter((x): x is string => !!x),
  );

  const windowStart = addDays(now, -config.purchase.verificationWindowDays);

  const lines = await db.kvInvoiceLine.findMany({
    where: {
      invoice: {
        kvCustomerId: { in: kvIds },
        status: 'completed',
        kvDeleted: false,
        purchaseDate: { gte: windowStart, lte: now },
      },
    },
    include: {
      invoice: true,
      product: { include: { crmMeta: true } },
      allocations: true,
    },
  });

  const candidates: RepurchaseCandidate[] = [];
  for (const l of lines) {
    // Chỉ tính hóa đơn MỚI (khác hóa đơn gốc đã sinh nhắc) và chưa bị xác minh cho follow-up khác.
    if (sourceInvoiceIds.has(l.invoice.kvInvoiceId)) continue;
    if (takenInvoiceIds.has(l.invoice.kvInvoiceId)) continue;
    if (takenLineIds.has(l.kvInvoiceLineId)) continue;
    // Bé của dòng mua lại (nếu đã phân bổ cho một bé cụ thể).
    const allocWithBaby = l.allocations.find((a) => a.babyId != null);
    const babyKey = allocWithBaby?.babyId ?? CUSTOMER_LEVEL_KEY;
    candidates.push({
      customerId: fu.customerId,
      babyKey,
      replacementGroupId: l.product.crmMeta?.replacementGroupId ?? null,
      invoiceId: l.invoice.kvInvoiceId,
      invoiceLineId: l.kvInvoiceLineId,
      purchaseDate: l.invoice.purchaseDate,
    });
  }

  const match = matchRepurchaseForVerify(sources, candidates);
  if (!match) return { verified: false };
  return {
    verified: true,
    invoiceId: match.candidate.invoiceId,
    invoiceLineId: match.candidate.invoiceLineId,
    purchaseDate: match.candidate.purchaseDate,
  };
}
