// 🔴 SEC-FIX-3 (race + authz CWE-362/862): claim/release follow-up an toàn.
// - claim: guard NGUYÊN TỬ ở tầng DB (updateMany where ...), count===0 => 409. KHÔNG đọc-rồi-ghi.
// - release: CHỈ người đang giữ việc; người khác override phải là chu_shop (LOCK-10) + ghi audit.
import type { Prisma } from '@prisma/client';
import type { RoleKeyStr } from '../../security/permissions';

/**
 * Điều kiện "được phép chiếm việc" ở dạng where.OR cho updateMany (nguyên tử).
 * Chiếm được khi việc KHÔNG đang được người khác giữ hợp lệ, tức phủ định của
 * (in_progress AND claimExpiresAt còn hạn AND claimedBy != mình):
 *   - state != in_progress, HOẶC
 *   - chưa có hạn (claimExpiresAt null), HOẶC
 *   - đã quá hạn (claimExpiresAt <= now), HOẶC
 *   - chính mình đang giữ (làm mới).
 * Hai request đồng thời: DB serialize updateMany => chỉ MỘT khớp & lật cờ, request kia count===0 => 409.
 */
export function claimableWhereOr(now: Date, userId: string): Prisma.FollowUpWhereInput['OR'] {
  return [
    { claimState: { not: 'in_progress' } },
    { claimExpiresAt: null },
    { claimExpiresAt: { lte: now } },
    { claimedBy: userId },
  ];
}

export interface ReleaseDecision {
  allowed: boolean;
  /** true khi chu_shop giải phóng việc ĐANG do NGƯỜI KHÁC giữ => cần ghi audit (LOCK-10). */
  isOverride: boolean;
}

/**
 * Quyết định thuần cho release:
 * - Việc không do ai giữ / do CHÍNH mình giữ => cho giải phóng (không override).
 * - Việc do NGƯỜI KHÁC giữ => chỉ chu_shop được giải phóng (override), vai khác bị chặn.
 */
export function canRelease(
  claimedBy: string | null,
  actorUserId: string,
  actorRole: RoleKeyStr,
): ReleaseDecision {
  const heldByOther = claimedBy != null && claimedBy !== actorUserId;
  if (!heldByOther) return { allowed: true, isOverride: false };
  if (actorRole === 'chu_shop') return { allowed: true, isOverride: true };
  return { allowed: false, isOverride: false };
}
