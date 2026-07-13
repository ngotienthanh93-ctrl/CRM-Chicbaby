// Nhãn + hằng số cho SCR-15 (Quản lý thí nghiệm holdout). Khớp server experiments.router.ts.
import type { Tone } from '../../lib/labels';
import type { ExperimentStatus } from '../../api/types';

export const expStatusVi: Record<ExperimentStatus, string> = {
  draft: 'Nháp',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  completed: 'Đã kết thúc',
};

export const expStatusTone: Record<ExperimentStatus, Tone> = {
  draft: 'neutral',
  running: 'success',
  paused: 'warning',
  completed: 'primary',
};

/**
 * 🔴 §12.3: 6 luật loại trừ KHÓA CỨNG — luôn tick + disabled trên form.
 * Khớp HARD_EXCLUSION_RULES ở server/src/engines/experiment.ts (server LUÔN ép đủ, client không gỡ được).
 */
export const HARD_EXCLUSION_RULES: readonly { key: string; label: string }[] = [
  { key: 'vip_customer', label: 'Khách VIP' },
  { key: 'agency_at_risk', label: 'Đại lý có nguy cơ (at_risk)' },
  { key: 'callback_requested', label: 'Khách đã yêu cầu gọi lại' },
  { key: 'complaint_open', label: 'Đang có khiếu nại' },
  { key: 'order_delivery_debt_open', label: 'Đơn/giao/công nợ đang mở' },
  { key: 'service_contact', label: 'Việc chăm sóc bắt buộc (service_contact)' },
];

/** Chuyển trạng thái hợp lệ — khớp ALLOWED_STATUS_TRANSITIONS ở server. */
export const STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ['running', 'completed'],
  running: ['paused', 'completed'],
  paused: ['running', 'completed'],
  completed: [],
};

/** ⚙️ Dải holdout cho phép (10–15%) + cỡ mẫu tối thiểu mặc định. */
export const HOLDOUT_PCT_MIN = 10;
export const HOLDOUT_PCT_MAX = 15;
export const DEFAULT_MIN_SAMPLE_TREATMENT = 300;
export const DEFAULT_MIN_SAMPLE_HOLDOUT = 100;
export const DEFAULT_HOLDOUT_PCT = 10;
