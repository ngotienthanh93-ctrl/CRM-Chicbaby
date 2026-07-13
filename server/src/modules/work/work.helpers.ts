// Helper THUẦN cho SCR-02 (§11.1). Tách khỏi router để test được không cần DB.
import type { Permissions } from '../../security/permissions';
import { maskBabyName } from '../../security/masking';

export interface WorkTargetLike {
  targetType: string;
  customerId: string | null;
  organizationId: string | null;
}

/** ID đối tượng để SCR-02 gọi hành động inline (Xác nhận bé / Tạm dừng cảnh báo). */
export function workTargetIds(fu: WorkTargetLike): {
  customerId: string | null;
  organizationId: string | null;
} {
  return {
    customerId: fu.targetType === 'customer' ? fu.customerId : null,
    organizationId: fu.targetType === 'organization' ? fu.organizationId : null,
  };
}

export interface ConfirmableBabyLike {
  id: string;
  babyName: string | null;
}

/**
 * §11.1: danh sách bé của khách để hành động "Xác nhận bé" (chọn bé → confirm-baby).
 * Chỉ dùng khi người xem có `viewBaby` (router đã chặn); displayName theo masking.
 */
export function serializeConfirmableBaby(b: ConfirmableBabyLike, perms: Permissions) {
  return {
    id: b.id,
    displayName: maskBabyName(b.babyName, perms.viewBaby) ?? '(chưa đặt tên)',
  };
}
