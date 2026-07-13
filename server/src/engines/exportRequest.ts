// 🔴 Export dữ liệu khách/bé CÓ DUYỆT (SEC — spec §Bảo mật: "Export dữ liệu khách/bé ⇒ cần duyệt + audit").
// Logic THUẦN (test được): tính trạng thái HIỆU LỰC của một yêu cầu export chồng expiry/revoke lên status lưu,
// và quyết định có tải được không. KHÔNG chạm DB — router nạp dữ liệu rồi gọi các hàm này.

/** Trạng thái hiệu lực (khác `status` lưu ở chỗ tính thêm hết hạn/thu hồi động theo thời gian). */
export type EffectiveExportState = 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked';

/** Ảnh chụp tối thiểu của một yêu cầu để suy ra trạng thái hiệu lực. */
export interface ExportRequestSnapshot {
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** Hạn tải sau khi duyệt (null nếu chưa duyệt). */
  expiresAt: Date | null;
  /** Thời điểm thu hồi (null nếu chưa thu hồi). */
  revokedAt: Date | null;
}

/**
 * Trạng thái HIỆU LỰC: thu hồi > hết hạn > status lưu.
 * - revokedAt có ⇒ 'revoked' (ưu tiên cao nhất — chủ shop chủ động cắt quyền).
 * - approved nhưng đã quá expiresAt ⇒ 'expired' (tính động, không cần job cập nhật status).
 * - còn lại ⇒ đúng status lưu.
 */
export function effectiveExportState(req: ExportRequestSnapshot, now: Date): EffectiveExportState {
  if (req.revokedAt) return 'revoked';
  if (
    req.status === 'approved' &&
    req.expiresAt !== null &&
    req.expiresAt.getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return req.status;
}

/**
 * Chỉ TẢI ĐƯỢC khi hiệu lực = approved VÀ có hạn tải hợp lệ (expiresAt != null, chưa qua).
 * 🔴 Đòi expiresAt != null để KHỚP CHÍNH XÁC cổng tải ở server (where expiresAt > now): tránh DTO báo
 * downloadable=true trong khi cổng lại chặn (approve luôn đặt expiresAt nên thực tế không xảy ra, nhưng
 * giữ bất biến một chiều cho chắc).
 */
export function isExportDownloadable(req: ExportRequestSnapshot, now: Date): boolean {
  return effectiveExportState(req, now) === 'approved' && req.expiresAt !== null;
}

/** Chỉ DUYỆT/TỪ CHỐI được khi đang pending (đã duyệt/từ chối/thu hồi rồi thì không đổi nữa). */
export function isExportDecidable(req: ExportRequestSnapshot, now: Date): boolean {
  return effectiveExportState(req, now) === 'pending';
}
