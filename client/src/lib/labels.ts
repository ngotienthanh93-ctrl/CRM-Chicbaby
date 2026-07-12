// Nhãn tiếng Việt cho enum backend + ánh xạ trạng thái -> tông màu badge.
// Trạng thái luôn hiển thị = MÀU + ICON + CHỮ (icon gắn ở component Badge theo tone).

export type Tone = 'neutral' | 'primary' | 'danger' | 'warning' | 'attention' | 'success';

export const followUpStatusVi: Record<string, string> = {
  cho_toi_han: 'Chờ tới hạn',
  den_han: 'Đến hạn',
  da_lien_he: 'Đã liên hệ',
  hen_lai: 'Hẹn lại',
  da_mua_lai: 'Đã mua lại',
  dong: 'Đã đóng',
};

export const followUpStatusTone: Record<string, Tone> = {
  cho_toi_han: 'neutral',
  den_han: 'warning',
  da_lien_he: 'primary',
  hen_lai: 'attention',
  da_mua_lai: 'success',
  dong: 'neutral',
};

export const reminderTypeVi: Record<string, string> = {
  consumption: 'Nhắc tái mua',
  replenishment: 'Nhắc nhập bù (đại lý)',
  consultation_followup: 'Gọi lại tư vấn',
  agency_investigation: 'Điều tra đại lý',
};

export const workBadgeTone: Record<string, Tone> = {
  at_risk: 'danger',
  agency: 'primary',
  confirmed: 'success',
  suggested: 'attention',
  customer_level: 'neutral',
};

export const orgStatusVi: Record<string, string> = {
  active: 'Đang hoạt động',
  slow: 'Chậm nhịp',
  at_risk: 'Nguy cơ mất',
  paused: 'Tạm nghỉ',
  lost: 'Đã mất',
  collecting: 'Đang thu thập nhịp',
};

export const orgStatusTone: Record<string, Tone> = {
  active: 'success',
  slow: 'warning',
  at_risk: 'danger',
  paused: 'neutral',
  lost: 'neutral',
  collecting: 'primary',
};

export const orgBadgeTone: Record<string, Tone> = {
  'Nguy cơ mất': 'danger',
  'Chậm nhịp': 'warning',
  'Đang teo dần': 'warning',
  'Đang thu thập': 'primary',
  'Shop hết hàng': 'attention',
  'Tạm nghỉ': 'neutral',
};

export const assignmentStatusVi: Record<string, string> = {
  auto_assigned: 'Đã tự gắn',
  suggested: 'Gợi ý bé',
  confirmed: 'Đã xác nhận',
  customer_level: 'Cấp khách',
  not_applicable: 'Không áp dụng',
  chua_phan_bo: 'Chưa phân bổ',
};

export const assignmentStatusTone: Record<string, Tone> = {
  auto_assigned: 'success',
  suggested: 'attention',
  confirmed: 'success',
  customer_level: 'neutral',
  not_applicable: 'neutral',
  chua_phan_bo: 'warning',
};

export const babyModeVi: Record<string, string> = {
  baby_specific: 'Theo bé',
  multi_audience: 'Đa đối tượng',
  not_baby_applicable: 'Không theo bé',
};

export const confidenceVi: Record<string, string> = {
  high: 'Tin cậy cao',
  medium: 'Tin cậy TB',
  low: 'Tin cậy thấp',
};

export const invoiceStatusVi: Record<string, string> = {
  completed: 'Hoàn tất',
  pending: 'Chờ xử lý',
  cancelled: 'Đã hủy',
  partially_returned: 'Trả một phần',
  fully_returned: 'Đã trả toàn bộ',
  unknown: 'Không rõ',
};

export const consentStatusVi: Record<string, string> = {
  granted: 'Đã đồng ý',
  revoked: 'Đã rút',
};

export const orgContactRoleVi: Record<string, string> = {
  chu_shop: 'Chủ shop',
  nguoi_dat_hang: 'Người đặt hàng',
  ke_toan: 'Kế toán',
  nguoi_nhan_hang: 'Người nhận hàng',
};

export const declineReasonVi: Record<string, string> = {
  gia_cao: 'Giá cao',
  doi_thu_chao_gia: 'Đối thủ chào giá',
  hang_ban_cham: 'Hàng bán chậm',
  shop_het_hang: 'Shop hết hàng',
  giao_hang_cham: 'Giao hàng chậm',
  cong_no: 'Công nợ',
  dai_ly_dong_cua: 'Đại lý đóng cửa',
  khong_lien_he_duoc: 'Không liên hệ được',
  khac: 'Khác',
};

export const closeReasonVi: Record<string, string> = {
  khong_dung_nua: 'Không dùng nữa',
  doi_sp: 'Đổi sản phẩm',
  mua_noi_khac: 'Mua nơi khác',
  khong_phan_hoi: 'Không phản hồi',
  be_da_lon: 'Bé đã lớn',
  khac: 'Khác',
};

export const roleVi: Record<string, string> = {
  chu_shop: 'Chủ shop',
  crm_officer: 'CRM Officer',
  cskh: 'CSKH',
  marketing: 'Marketing',
  tro_ly_du_lieu: 'Trợ lý dữ liệu',
};

export const consentTypeVi: Record<string, string> = {
  ho_so_tu_van_be: 'Lưu hồ sơ & tư vấn cho bé',
  cham_soc_nhac_tai_mua: 'Chăm sóc & nhắc tái mua',
  marketing: 'Nhận thông tin marketing',
  dung_anh_review: 'Dùng ảnh review',
};

export function vnd(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('vi-VN') + ' đ';
}
