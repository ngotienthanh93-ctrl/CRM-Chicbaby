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

// ---------- EXP §12.3: 6 luật loại trừ KHÓA CỨNG khỏi thí nghiệm holdout ----------
export interface HardExclusionRule {
  key: string;
  /** Nhãn tiếng Việt hiển thị trên SCR-15 (checkbox khóa, không cho bỏ tick). */
  label: string;
}

/**
 * 🔴 EXP §12.3: 6 luật loại trừ KHÓA CỨNG — LUÔN áp dụng, KHÔNG cho bỏ tick.
 * Các khách/việc dính bất kỳ luật nào KHÔNG BAO GIỜ bị đưa vào nhóm holdout
 * (tránh làm hại quan hệ khách quan trọng / vi phạm nguyên tắc service_contact ∞).
 */
export const HARD_EXCLUSION_RULES: readonly HardExclusionRule[] = [
  { key: 'vip_customer', label: 'Khách VIP' },
  { key: 'agency_at_risk', label: 'Đại lý có nguy cơ (at_risk)' },
  { key: 'callback_requested', label: 'Khách đã yêu cầu gọi lại' },
  { key: 'complaint_open', label: 'Đang có khiếu nại' },
  { key: 'order_delivery_debt_open', label: 'Đơn/giao/công nợ đang mở' },
  { key: 'service_contact', label: 'Việc chăm sóc bắt buộc (service_contact)' },
] as const;

const HARD_EXCLUSION_KEYS: readonly string[] = HARD_EXCLUSION_RULES.map((r) => r.key);
const HARD_EXCLUSION_KEY_SET = new Set(HARD_EXCLUSION_KEYS);

/**
 * 🔴 Ép danh sách luật loại trừ LUÔN chứa ĐỦ 6 luật khóa cứng, không trùng.
 * Dù client gửi rỗng/thiếu/thừa/trùng: server không cho bỏ luật nào; luật lạ (ngoài 6) bị loại.
 * Trả về theo thứ tự chuẩn (6 luật khóa cứng trước).
 */
export function enforceHardExclusions(rules?: string[]): string[] {
  const valid = (rules ?? []).filter((r) => HARD_EXCLUSION_KEY_SET.has(r));
  return [...new Set<string>([...HARD_EXCLUSION_KEYS, ...valid])];
}

/** Tín hiệu nghiệp vụ để xét một khách/việc có bị loại khỏi thí nghiệm không. */
export interface ExperimentExclusionSignals {
  /** Khách VIP. */
  isVip: boolean;
  /** Đại lý đang ở trạng thái at_risk. */
  agencyAtRisk: boolean;
  /** Khách đã yêu cầu gọi lại. */
  callbackRequested: boolean;
  /** Đang có khiếu nại mở. */
  hasComplaint: boolean;
  /** Đơn/giao/công nợ đang mở. */
  hasOpenOrderDeliveryDebt: boolean;
  /** Việc thuộc loại service_contact (chăm sóc bắt buộc — trần ∞). */
  isServiceContact: boolean;
}

/**
 * 🔴 Xét một khách/việc có bị loại khỏi thí nghiệm holdout theo 6 luật khóa cứng.
 * Trả danh sách reason (đúng key trong HARD_EXCLUSION_RULES) để audit/giải thích.
 * (THUẦN — chưa wire vào phân bổ holdout thực tế; xem TODO ở generate.ts.)
 */
export function isExcludedFromExperiment(signals: ExperimentExclusionSignals): {
  excluded: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (signals.isVip) reasons.push('vip_customer');
  if (signals.agencyAtRisk) reasons.push('agency_at_risk');
  if (signals.callbackRequested) reasons.push('callback_requested');
  if (signals.hasComplaint) reasons.push('complaint_open');
  if (signals.hasOpenOrderDeliveryDebt) reasons.push('order_delivery_debt_open');
  if (signals.isServiceContact) reasons.push('service_contact');
  return { excluded: reasons.length > 0, reasons };
}

// ---------- Phân bổ holdout PRODUCTION (SCR-15) — phần THUẦN (test được không cần DB) ----------

/**
 * Ngữ cảnh phân bổ: các tập customerId đã nạp SẴN 1 lần từ DB (tránh N+1 trong vòng lặp khách).
 * Mỗi tập tương ứng một luật loại trừ khóa cứng; service (assignment.service.ts) nạp từ DB rồi
 * truyền vào đây để derive tín hiệu THUẦN.
 */
export interface ExperimentAssignmentContext {
  /** Khách có vai `wholesale_contact` ⇒ VIP. */
  vipCustomerIds: Set<string>;
  /** Khách là liên hệ của Organization đang `at_risk`. */
  atRiskCustomerIds: Set<string>;
  /** Khách có follow-up ĐANG MỞ status `hen_lai` (đã hẹn gọi lại). */
  callbackCustomerIds: Set<string>;
  /** Khách có follow-up ĐANG MỞ `frequencyCapScope='service_contact'` (chăm sóc bắt buộc/khiếu nại). */
  serviceContactCustomerIds: Set<string>;
  /** Khách có `KvOrder` trạng thái đang mở (đơn/giao/công nợ chưa hoàn tất). */
  openOrderDebtCustomerIds: Set<string>;
}

/**
 * Derive 6 tín hiệu loại trừ cho MỘT khách từ ngữ cảnh đã nạp (THUẦN — không chạm DB).
 * 🔴 `hasComplaint` và `isServiceContact` cùng suy ra từ follow-up `service_contact` đang mở
 * (một việc chăm sóc bắt buộc vừa là khiếu nại/hẹn vừa thuộc loại trần ∞ — §12.3, nguyên tắc #5).
 */
export function deriveExclusionSignals(
  customerId: string,
  ctx: ExperimentAssignmentContext,
): ExperimentExclusionSignals {
  const isServiceContact = ctx.serviceContactCustomerIds.has(customerId);
  return {
    isVip: ctx.vipCustomerIds.has(customerId),
    agencyAtRisk: ctx.atRiskCustomerIds.has(customerId),
    callbackRequested: ctx.callbackCustomerIds.has(customerId),
    hasComplaint: isServiceContact,
    hasOpenOrderDeliveryDebt: ctx.openOrderDebtCustomerIds.has(customerId),
    isServiceContact,
  };
}

/**
 * 🔴 Best-effort: KiotViet không chuẩn hóa status đơn trong repo (kv_orders là mirror tham chiếu).
 * Coi là "đang mở" (đơn/giao/công nợ chưa xong) các trạng thái phiếu tạm / đang giao; trạng thái
 * hoàn tất/đã hủy là terminal ⇒ KHÔNG mở. status null/không rõ ⇒ KHÔNG mở (tránh loại nhầm quá tay).
 * GIẢ ĐỊNH: khi xác nhận được semantics status thật của shop, nên chuyển danh sách này sang cấu hình.
 */
/** Chuẩn hóa CSV mã trạng thái "đang mở" → Set (trim + lowercase, bỏ rỗng). Nguồn: cấu hình sync.open_order_statuses. */
export function parseOpenOrderStatuses(csv: string): Set<string> {
  return new Set(
    csv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

/**
 * Trạng thái đơn KiotViet có đang mở không — so với TẬP mã "đang mở" đã cấu hình (`openSet`).
 * status null/không thuộc tập ⇒ KHÔNG mở (tránh loại nhầm quá tay). Caller nạp openSet từ config active.
 */
export function isOpenOrderStatus(status: string | null | undefined, openSet: Set<string>): boolean {
  if (status == null) return false;
  return openSet.has(status.trim().toLowerCase());
}

/** Kết quả phân loại 1 khách cho thí nghiệm: loại trừ (kèm lý do) hoặc nhóm ổn định. */
export type ExperimentClassification =
  | { excluded: true; reasons: string[] }
  | { excluded: false; group: ExperimentGroupStr };

/**
 * 🔴 Phân loại MỘT khách cho thí nghiệm (THUẦN — test được):
 * - Dính bất kỳ 1 trong 6 luật khóa cứng ⇒ loại trừ (KHÔNG treatment, KHÔNG holdout).
 * - Ngược lại ⇒ gán nhóm ổn định theo hash(customerId+experimentId) (EXP-01, chạy lại KHÔNG đổi nhóm).
 */
export function classifyForExperiment(
  customerId: string,
  experimentId: string,
  holdoutRatio: number,
  ctx: ExperimentAssignmentContext,
): ExperimentClassification {
  const { excluded, reasons } = isExcludedFromExperiment(deriveExclusionSignals(customerId, ctx));
  if (excluded) return { excluded: true, reasons };
  return { excluded: false, group: assignExperimentGroup(customerId, experimentId, holdoutRatio) };
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
