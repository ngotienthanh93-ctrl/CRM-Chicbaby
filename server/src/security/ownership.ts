// 🔴 SEC-FIX-1 (IDOR CWE-639/862): trước MỌI phép gán babyId vào allocation/reminder,
// phải CHỨNG MINH bé thuộc đúng khách CRM suy ra từ hóa đơn (allocations) hoặc từ follow-up.
// Không khớp => 400 với message TRUNG TÍNH (KHÔNG lộ tồn tại id — tránh enumeration).
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/http';

/** Message duy nhất cho mọi trường hợp từ chối (không phân biệt "không tồn tại" vs "khác khách"). */
export const BABY_OWNERSHIP_MSG = 'Không thể gán bé này cho phiếu — bé không thuộc khách hàng của phiếu.';

/**
 * Quyết định thuần: bé (theo customerId của bé) có thuộc đúng khách kỳ vọng không.
 * customerId nào null/undefined => KHÔNG khớp (an toàn: từ chối khi thiếu dữ kiện).
 */
export function babyBelongsToCustomer(
  babyCustomerId: string | null | undefined,
  expectedCustomerId: string | null | undefined,
): boolean {
  return (
    babyCustomerId != null &&
    expectedCustomerId != null &&
    babyCustomerId === expectedCustomerId
  );
}

/**
 * Suy khách CRM từ một dòng hóa đơn KV:
 * kv_invoice_line → kv_invoice.kvCustomerId → customer_external_identities (còn liên kết) → customerId.
 * Trả null nếu không suy được (hóa đơn không có khách / mã KV chưa liên kết).
 */
export async function resolveCustomerIdFromInvoiceLine(
  kvInvoiceLineId: string,
): Promise<string | null> {
  const line = await prisma.kvInvoiceLine.findUnique({
    where: { kvInvoiceLineId },
    include: { invoice: true },
  });
  const kvCustomerId = line?.invoice.kvCustomerId;
  if (!kvCustomerId) return null;
  const identity = await prisma.customerExternalIdentity.findFirst({
    where: { externalCustomerId: kvCustomerId, unlinkedAt: null },
  });
  return identity?.customerId ?? null;
}

/**
 * Load bé và đối chiếu customerId với khách kỳ vọng. Không khớp / không tồn tại => 400 trung tính.
 * Dùng cho followups (khách = follow_up.customerId) và bất kỳ nơi nào đã có sẵn customerId kỳ vọng.
 */
export async function assertBabyBelongsToCustomer(
  babyId: string,
  expectedCustomerId: string | null,
): Promise<void> {
  // 🔴 SEC round 2: loại bé ĐÃ soft-delete (deletedAt != null) — không cho "hồi sinh" hồ sơ bé
  // đã xóa vào allocation/reminder dù cùng khách. findFirst vì where kèm deletedAt không còn unique.
  const baby = await prisma.babyProfile.findFirst({
    where: { id: babyId, deletedAt: null },
    select: { customerId: true },
  });
  if (!baby || !babyBelongsToCustomer(baby.customerId, expectedCustomerId)) {
    throw badRequest(BABY_OWNERSHIP_MSG);
  }
}

/**
 * Tiện ích cho allocations: suy khách từ dòng hóa đơn rồi assert bé thuộc khách đó.
 * Gọi TRƯỚC mọi ghi babyId vào allocation.
 */
export async function assertBabyBelongsToInvoiceLine(
  babyId: string,
  kvInvoiceLineId: string,
): Promise<void> {
  const expectedCustomerId = await resolveCustomerIdFromInvoiceLine(kvInvoiceLineId);
  await assertBabyBelongsToCustomer(babyId, expectedCustomerId);
}
