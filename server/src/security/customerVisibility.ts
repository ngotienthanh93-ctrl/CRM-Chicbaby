// 🔴 BẤT BIẾN #6 (SEC): user thiếu viewOrganization TUYỆT ĐỐI không xem/sửa/tổng-hợp được
// dữ liệu KHÁCH SỈ (customer có vai wholesale_contact, kể cả dual-role lẻ+sỉ) LẪN dữ liệu con của họ
// (bé, tư vấn, phân bổ) theo BẤT KỲ đường nào. Enforce SERVER-SIDE, không chỉ ẩn ở UI.
// chu_shop luôn viewOrganization=true (khóa cứng) ⇒ mọi helper là no-op với chủ shop.
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import type { Permissions } from './permissions';
import type { Prisma } from '@prisma/client';

/**
 * Predicate lọc KHÁCH SỈ khỏi truy vấn CustomerCrm khi user thiếu viewOrganization.
 * viewOrganization=true ⇒ {} (spread an toàn, không lọc). Dùng SPREAD vào where:
 *   where: { deletedAt: null, ...visibleCustomerWhere(perms) }
 */
export function visibleCustomerWhere(perms: Permissions): Prisma.CustomerCrmWhereInput {
  return perms.viewOrganization ? {} : { roles: { none: { role: 'wholesale_contact' } } };
}

/**
 * Predicate cho quan hệ to-one `customer` trong where của bảng con (baby/consultation/follow-up...).
 * viewOrganization=true ⇒ {} (với quan hệ BẮT BUỘC là no-op; với quan hệ NULLABLE chỉ dùng có điều kiện
 * ở caller để không loại nhầm dòng customer=null). Dùng:  customer: visibleCustomerRelationWhere(perms)
 */
export function visibleCustomerRelationWhere(perms: Permissions): Prisma.CustomerCrmWhereInput {
  return perms.viewOrganization ? {} : { roles: { none: { role: 'wholesale_contact' } } };
}

/**
 * Ném 404 nếu user thiếu viewOrganization mà khách là KHÁCH SỈ (chống IDOR theo customerId).
 * deletedAt-agnostic (chặn cả khách sỉ đã soft-delete). Khách không tồn tại ⇒ KHÔNG ném (để caller
 * tự trả 404 theo resource). notFoundMessage khớp message not-found của resource để KHÔNG lộ tồn tại.
 */
export async function assertCustomerVisible(
  customerId: string,
  perms: Permissions,
  notFoundMessage = 'Không tìm thấy khách hàng.',
): Promise<void> {
  if (perms.viewOrganization) return;
  const c = await prisma.customerCrm.findUnique({
    where: { id: customerId },
    select: { roles: { select: { role: true } } },
  });
  if (c && c.roles.some((r) => r.role === 'wholesale_contact')) {
    throw notFound(notFoundMessage);
  }
}
