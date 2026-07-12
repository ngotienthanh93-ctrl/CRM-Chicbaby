// Thí nghiệm holdout (§2.10 / RPT-04). Engine THUẦN => test được không cần DB.
// 🔴 EXP-01: phân nhóm theo hash(customerId + experimentId) — một khách LUÔN một nhóm (ổn định).
// 🔴 RPT-04: uplift CHỈ dùng Attributed conversion; CHƯA đủ mẫu ⇒ KHÔNG kết luận + khoảng tin cậy.
import crypto from 'node:crypto';

export type ExperimentGroupStr = 'treatment' | 'holdout';

/**
 * 🔴 EXP-01: gán nhóm ổn định theo hash(customerId+experimentId).
 * Lấy 8 hex đầu của sha256 => số [0,1); < holdoutRatio ⇒ holdout, ngược lại treatment.
 * Cùng (customerId, experimentId) LUÔN cho cùng nhóm (không phụ thuộc thứ tự chạy).
 */
export function assignExperimentGroup(
  customerId: string,
  experimentId: string,
  holdoutRatio: number,
): ExperimentGroupStr {
  const h = crypto.createHash('sha256').update(`${customerId}:${experimentId}`).digest('hex');
  const bucket = parseInt(h.slice(0, 8), 16) / 0xffffffff;
  return bucket < holdoutRatio ? 'holdout' : 'treatment';
}

// ---------- RPT-04: đếm DISTINCT khách mua lại trong cửa sổ thí nghiệm ----------
export interface ConversionRow {
  /** khách gắn với follow-up của conversion (null ⇒ bỏ qua). */
  customerId: string | null;
  /** mốc xác minh mua lại (null ⇒ bỏ qua — chưa vào cửa sổ). */
  matchedAt: Date | null;
  /** AttributionStatus: 'attributed' | 'not_attributed'. */
  attributionStatus: string;
  /** VerificationStatus: 'verified' | ... */
  verificationStatus: string;
}

/**
 * 🔴 FIX-6 / RPT-04: đếm SỐ KHÁCH DISTINCT đã mua lại trong một nhóm, TRONG cửa sổ thí nghiệm.
 * Sửa lỗi phồng tử số: trước đây đếm DÒNG conversion ⇒ khách nhiều conversion bị đếm nhiều lần.
 * - Cửa sổ nửa mở: `startAt <= matchedAt < endAt` (endAt = COALESCE(experiment.endAt, now)).
 * - `attributedOnly=true` (treatment): CHỈ tính conversion `attributionStatus='attributed'`.
 *   `attributedOnly=false` (holdout): mua lại TỰ NHIÊN (verified) — holdout không nhận nhắc.
 * - Luôn yêu cầu `verificationStatus='verified'`.
 * Trả về số khách DISTINCT (mỗi khách đếm 1 lần dù nhiều conversion) ⇒ tử số ≤ mẫu (n).
 */
export function countDistinctRepurchaseCustomers(
  rows: ConversionRow[],
  window: { startAt: Date; endAt: Date },
  opts: { attributedOnly: boolean },
): number {
  const start = window.startAt.getTime();
  const end = window.endAt.getTime();
  const distinct = new Set<string>();
  for (const r of rows) {
    if (r.customerId == null) continue;
    if (r.verificationStatus !== 'verified') continue;
    if (opts.attributedOnly && r.attributionStatus !== 'attributed') continue;
    if (r.matchedAt == null) continue;
    const t = r.matchedAt.getTime();
    if (t < start || t >= end) continue;
    distinct.add(r.customerId);
  }
  return distinct.size;
}

// ---------- RPT-04: incremental uplift ----------
export type UpliftStatus = 'collecting' | 'insufficient' | 'reference' | 'confident';

export interface UpliftGroupInput {
  /** kích thước nhóm (số khách). */
  n: number;
  /** số mua lại tính vào tử số (treatment=Attributed; holdout=repurchase verified). */
  conversions: number;
}

export interface UpliftConfigInput {
  minSampleTreatment: number;
  minSampleHoldout: number;
}

export interface UpliftResult {
  status: UpliftStatus;
  /** 🔴 chưa đủ mẫu ⇒ false ⇒ KHÔNG hiển thị kết luận. */
  hasConclusion: boolean;
  treatmentRate: number | null;
  holdoutRate: number | null;
  /** uplift = treatmentRate − holdoutRate (điểm phần trăm, dạng tỉ lệ 0..1). */
  uplift: number | null;
  /** khoảng tin cậy 95% cho uplift (null khi chưa đủ mẫu). */
  ci95: { low: number; high: number } | null;
  label: string;
}

const STATUS_LABEL: Record<UpliftStatus, string> = {
  collecting: 'Đang thu thập (chưa có dữ liệu)',
  insufficient: 'Chưa đủ mẫu — KHÔNG kết luận',
  reference: 'Có thể tham khảo (chưa đủ tin cậy thống kê)',
  confident: 'Đủ tin cậy',
};

/**
 * 🔴 RPT-04: tính uplift = %mua lại(treatment) − %mua lại(holdout).
 * - Nhóm rỗng (n=0) ⇒ 'collecting'.
 * - Dưới ngưỡng mẫu tối thiểu ⇒ 'insufficient' ⇒ hasConclusion=false (KHÔNG kết luận).
 * - Đủ mẫu: tính CI 95% (xấp xỉ Wald cho hiệu 2 tỉ lệ). CI cắt 0 ⇒ 'reference'; loại 0 ⇒ 'confident'.
 */
export function computeUplift(
  treatment: UpliftGroupInput,
  holdout: UpliftGroupInput,
  cfg: UpliftConfigInput,
): UpliftResult {
  const base = (status: UpliftStatus): UpliftResult => ({
    status,
    hasConclusion: false,
    treatmentRate: treatment.n > 0 ? treatment.conversions / treatment.n : null,
    holdoutRate: holdout.n > 0 ? holdout.conversions / holdout.n : null,
    uplift: null,
    ci95: null,
    label: STATUS_LABEL[status],
  });

  if (treatment.n === 0 || holdout.n === 0) return base('collecting');
  if (treatment.n < cfg.minSampleTreatment || holdout.n < cfg.minSampleHoldout) {
    return base('insufficient');
  }

  const pT = treatment.conversions / treatment.n;
  const pH = holdout.conversions / holdout.n;
  const uplift = pT - pH;
  // Sai số chuẩn cho hiệu 2 tỉ lệ độc lập.
  const se = Math.sqrt((pT * (1 - pT)) / treatment.n + (pH * (1 - pH)) / holdout.n);
  const margin = 1.96 * se;
  const ci95 = { low: uplift - margin, high: uplift + margin };
  // CI loại 0 (cùng dấu) ⇒ có ý nghĩa thống kê ⇒ đủ tin cậy.
  const excludesZero = ci95.low > 0 || ci95.high < 0;
  const status: UpliftStatus = excludesZero ? 'confident' : 'reference';
  return {
    status,
    hasConclusion: true,
    treatmentRate: pT,
    holdoutRate: pH,
    uplift,
    ci95,
    label: STATUS_LABEL[status],
  };
}
