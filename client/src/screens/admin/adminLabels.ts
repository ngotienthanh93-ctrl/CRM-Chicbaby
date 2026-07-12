// Nhãn tiếng Việt + helper hiển thị cho SCR-13 (Quản trị người dùng & phân quyền).
import type { FieldLevel } from '../../api/types';
import type { Tone } from '../../lib/labels';

/** Nhãn cho từng cờ hành động (overridable + locked) trong ma trận quyền. */
export const flagLabelVi: Record<string, string> = {
  // Cờ nghiệp vụ (override được)
  viewSensitive: 'Xem dữ liệu nhạy cảm (SĐT/địa chỉ)',
  viewBaby: 'Xem hồ sơ bé',
  viewConsultation: 'Xem ghi chú tư vấn',
  manageCustomer: 'Sửa hồ sơ khách',
  manageBaby: 'Sửa hồ sơ bé',
  processWork: 'Xử lý việc hôm nay',
  viewOrganization: 'Xem đại lý',
  manageOrganization: 'Quản lý đại lý',
  viewSync: 'Xem đồng bộ',
  // Cờ quản trị (khóa cứng)
  manageUsers: 'Quản trị người dùng',
  manageConfig: 'Cấu hình hệ thống',
  approveMerge: 'Duyệt gộp khách',
  approveExport: 'Duyệt export',
  approveCycle: 'Duyệt chu kỳ nhắc',
  handleAtRisk: 'Xử lý đại lý nguy cơ',
  manageSync: 'Điều khiển đồng bộ',
};

/** Nhãn cho từng trường nhạy cảm. */
export const fieldLabelVi: Record<string, string> = {
  phone: 'Số điện thoại',
  address: 'Địa chỉ',
  baby: 'Dữ liệu bé',
  consultation: 'Ghi chú tư vấn',
  debt: 'Công nợ',
};

/** Nhãn 3 mức quyền trường nhạy cảm. */
export const fieldLevelVi: Record<FieldLevel, string> = {
  full: 'Xem đầy đủ',
  masked: 'Xem ẩn',
  hidden: 'Ẩn hoàn toàn',
};

/** Tông màu badge theo mức quyền trường (màu + icon + chữ). */
export const fieldLevelTone: Record<FieldLevel, Tone> = {
  full: 'success',
  masked: 'warning',
  hidden: 'neutral',
};

/** Nhãn hành động trong nhật ký hoạt động. */
export const auditActionVi: Record<string, string> = {
  'user.create': 'Tạo người dùng',
  'user.update': 'Cập nhật người dùng',
  'user.role_change': 'Đổi vai',
  'user.lock': 'Khóa tài khoản',
  'user.unlock': 'Mở khóa tài khoản',
  'user.reset_password': 'Đặt lại mật khẩu',
  'user.handoff': 'Chuyển giao việc',
  'user.session_revoke': 'Thu hồi phiên',
  'user.revoke_all': 'Đăng xuất mọi thiết bị',
  'user.role_matrix.update': 'Đổi ma trận quyền',
  'auth.reauth': 'Xác minh mật khẩu',
  'auth.login': 'Đăng nhập',
  'auth.logout': 'Đăng xuất',
};

/** Nhãn loại đối tượng trong nhật ký. */
export const objectTypeVi: Record<string, string> = {
  user: 'Người dùng',
  session: 'Phiên',
  configuration: 'Cấu hình',
};

/** Các hành động thuộc "Lịch sử đổi quyền" (lọc client-side vì API nhận 1 action/lần). */
export const ROLE_CHANGE_ACTIONS = ['user.role_change', 'user.role_matrix.update'];

/** Định dạng thời gian theo giờ Việt Nam (Asia/Ho_Chi_Minh) — dữ liệu lưu UTC. */
const dtf = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtf.format(d);
}
