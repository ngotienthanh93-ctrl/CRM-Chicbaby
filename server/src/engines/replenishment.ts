// Động cơ nhắc khách SỈ — replenishment (§5). LOGIC THUẦN, test được không cần DB.
// 🔴 Nhịp = TRUNG VỊ (median), KHÔNG phải trung bình. < min_sample => "đang thu thập", KHÔNG cảnh báo.
import type { EngineConfig } from '../lib/config';
import type { OrgStatusStr } from './types';

// ---------- Trung vị nhịp nhập (REM-W-02) ----------

/** Trung vị khoảng cách (ngày) giữa các hóa đơn completed liên tiếp. */
export function computeMedianCadenceDays(purchaseDates: Date[]): {
  medianCadenceDays: number | null;
  sampleSize: number;
} {
  const sorted = [...purchaseDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / (24 * 60 * 60 * 1000);
    intervals.push(days);
  }
  if (intervals.length === 0) {
    return { medianCadenceDays: null, sampleSize: sorted.length };
  }
  const median = medianOf(intervals);
  return { medianCadenceDays: Math.round(median), sampleSize: sorted.length };
}

export function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    return (s[mid - 1]! + s[mid]!) / 2;
  }
  return s[mid]!;
}

// ---------- Đánh giá tình trạng đại lý (REM-W-03/07/08) ----------

export interface OrgEvalInput {
  medianCadenceDays: number | null;
  sampleSize: number; // số lần nhập trong cửa sổ
  daysSinceLastPurchase: number | null;
  revenue90d: number | null;
  revenuePrev90d: number | null;
  paused: boolean;
  supplierStockoutAffected: boolean;
  excludedNow: boolean; // đang trong excluded_periods (mùa vụ/khuyến mãi)
}

export interface OrgEvalResult {
  status: OrgStatusStr;
  warn: boolean;
  shrinking: boolean;
  /** Vai được giao xử lý: 'chu_shop' cho at_risk, ngược lại 'crm_officer'. */
  assigneeRole: string;
  reason: string;
}

/**
 * 3 mức so daysSinceLastPurchase với medianCadenceDays (REM-W-07):
 * ≥2.0× => at_risk (Chủ shop); ≥1.3× => slow; ≥1.0× => active/đến hạn.
 * 🔴 < min_sample => collecting, KHÔNG cảnh báo (REM-W-03).
 */
export function evaluateOrganization(input: OrgEvalInput, config: EngineConfig): OrgEvalResult {
  const shrinking = isShrinking(input.revenue90d, input.revenuePrev90d, config);

  // Chưa đủ mẫu => đang thu thập, không cảnh báo.
  if (input.sampleSize < config.agency.minSampleSize || input.medianCadenceDays == null) {
    return {
      status: 'collecting',
      warn: false,
      shrinking,
      assigneeRole: 'crm_officer',
      reason: `Đang thu thập (mới ${input.sampleSize} lần nhập, cần ≥${config.agency.minSampleSize})`,
    };
  }

  // Ngoại lệ chống cảnh báo sai (REM-W-10): paused/stockout/excluded => KHÔNG cảnh báo NHẬP.
  if (input.paused || input.supplierStockoutAffected || input.excludedNow) {
    return {
      status: input.paused ? 'paused' : 'active',
      warn: false,
      shrinking,
      assigneeRole: 'crm_officer',
      reason: 'Có ngoại lệ (tạm nghỉ/hết hàng/mùa vụ) — không cảnh báo nhập',
    };
  }

  const ratio =
    input.daysSinceLastPurchase == null
      ? 0
      : input.daysSinceLastPurchase / input.medianCadenceDays;

  if (ratio >= config.agency.atRiskMultiplier) {
    return {
      status: 'at_risk',
      warn: true,
      shrinking,
      assigneeRole: config.agency.atRiskAssigneeRole, // 🔴 chu_shop (REM-W-12)
      reason: `Nguy cơ mất: ${ratio.toFixed(1)}× nhịp trung vị`,
    };
  }
  if (ratio >= config.agency.slowMultiplier || shrinking) {
    return {
      status: 'slow',
      warn: true,
      shrinking,
      assigneeRole: 'crm_officer',
      reason: shrinking ? 'Doanh số đang teo dần' : `Chậm nhịp: ${ratio.toFixed(1)}× nhịp trung vị`,
    };
  }
  if (ratio >= config.agency.dueMultiplier) {
    return {
      status: 'active',
      warn: true,
      shrinking,
      assigneeRole: 'crm_officer',
      reason: 'Đến hạn nhập',
    };
  }
  return {
    status: 'active',
    warn: false,
    shrinking,
    assigneeRole: 'crm_officer',
    reason: 'Chưa đến hạn',
  };
}

/** Cảnh báo teo dần: revenue90d < revenuePrev90d × (1 − ⚙️threshold) (REM-W-08). */
export function isShrinking(
  revenue90d: number | null,
  revenuePrev90d: number | null,
  config: EngineConfig,
): boolean {
  if (revenue90d == null || revenuePrev90d == null || revenuePrev90d <= 0) return false;
  return revenue90d < revenuePrev90d * (1 - config.agency.revenueDeclineThreshold);
}

// ---------- Chọn người liên hệ nhắc nhập bù (ORG-03/04) ----------

export interface OrgContactLite {
  role: 'chu_shop' | 'nguoi_dat_hang' | 'ke_toan' | 'nguoi_nhan_hang';
  name: string;
  phone: string | null;
  isPrimary: boolean;
}

/** 🔴 Nhắc nhập bù gọi 'nguoi_dat_hang' (fallback isPrimary, rồi liên hệ đầu tiên). */
export function pickAgencyContact(contacts: OrgContactLite[]): OrgContactLite | null {
  if (contacts.length === 0) return null;
  const orderer = contacts.find((c) => c.role === 'nguoi_dat_hang');
  if (orderer) return orderer;
  const primary = contacts.find((c) => c.isPrimary);
  if (primary) return primary;
  return contacts[0]!;
}

// ---------- Bắt lý do khi chuyển trạng thái (REM-W / UAT-54) ----------

/**
 * 🔴 Không bắt lý do khi engine VỪA phát hiện at_risk (isManual=false, reasonStatus=unknown).
 * Bắt declineReason khi NGƯỜI DÙNG chuyển sang lost, hoặc chủ động xác nhận at_risk/đóng cảnh báo.
 */
export function requiresDeclineReason(toStatus: OrgStatusStr, isManual: boolean): boolean {
  if (toStatus === 'lost') return true;
  if (toStatus === 'at_risk' && isManual) return true;
  return false;
}
