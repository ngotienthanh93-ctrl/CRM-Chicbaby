// Engine phân bổ hóa đơn cho bé — 3 cấp (§6, BABY-07..15). LOGIC THUẦN, test được không cần DB.
// 🔴 Nguyên tắc bất biến #1/#2: KHÔNG ĐOÁN BÉ. Chỉ auto_assigned khi đủ TẤT CẢ điều kiện Cấp 1.
import type {
  AssignmentSourceStr,
  AssignmentStatusStr,
  BabyAssignmentModeStr,
  ConfidenceStr,
} from './types';

export interface AllocationInput {
  /** Số bé của khách. */
  babyCount: number;
  babyAssignmentMode: BabyAssignmentModeStr;
  /** Dòng hóa đơn thuộc giao dịch BÁN LẺ (role retail_customer). Sỉ => không auto. */
  isRetailInvoice: boolean;
  /** Cờ mua hộ / quà tặng. */
  isGiftOrProxy: boolean;
  /** id bé duy nhất khi babyCount === 1. */
  singleBabyId?: string | null;
  /** Các bé khớp độ tuổi SP (khi baby_specific & nhiều bé) — dùng cho gợi ý Cấp 2. */
  ageMatchBabyIds?: string[];
  /** SP đã TỪNG được confirmed cho bé nào (nếu có) — nhánh HOẶC của BABY-08. */
  previouslyConfirmedBabyId?: string | null;
}

export interface AllocationResult {
  assignmentStatus: AssignmentStatusStr;
  babyId: string | null;
  suggestedBabyId: string | null;
  confidence: ConfidenceStr;
  source: AssignmentSourceStr;
}

/**
 * Phân loại một dòng hóa đơn về 1 trong 4 trạng thái (§6).
 * 🔴 Bất biến CHECK-DB: suggested | customer_level | not_applicable => babyId = null.
 */
export function classifyAllocation(input: AllocationInput): AllocationResult {
  const {
    babyCount,
    babyAssignmentMode,
    isRetailInvoice,
    isGiftOrProxy,
    singleBabyId,
    ageMatchBabyIds = [],
    previouslyConfirmedBabyId,
  } = input;

  // BABY-11: SP không áp dụng cho bé (canxi mẹ, đồ người lớn) => not_applicable, nhắc cấp khách.
  if (babyAssignmentMode === 'not_baby_applicable') {
    return {
      assignmentStatus: 'not_applicable',
      babyId: null,
      suggestedBabyId: null,
      confidence: 'low',
      source: 'unassigned',
    };
  }

  // BABY-10: SP multi_audience => luôn cấp khách (không suy được).
  if (babyAssignmentMode === 'multi_audience') {
    return {
      assignmentStatus: 'customer_level',
      babyId: null,
      suggestedBabyId: null,
      confidence: 'low',
      source: 'unassigned',
    };
  }

  // Từ đây: babyAssignmentMode === 'baby_specific'
  const autoAllowedContext = isRetailInvoice && !isGiftOrProxy;

  // 🔴 Cấp 1 — Tự gắn (BABY-08): đúng 1 bé, bán lẻ, không quà. HOẶC SP đã từng confirmed cho bé đó.
  if (autoAllowedContext) {
    if (babyCount === 1 && singleBabyId) {
      return {
        assignmentStatus: 'auto_assigned',
        babyId: singleBabyId,
        suggestedBabyId: null,
        confidence: 'high',
        source: 'auto_single_baby',
      };
    }
    if (previouslyConfirmedBabyId) {
      return {
        assignmentStatus: 'auto_assigned',
        babyId: previouslyConfirmedBabyId,
        suggestedBabyId: null,
        confidence: 'high',
        source: 'auto_single_baby',
      };
    }
  }

  // Cấp 2 — Gợi ý (BABY-09): nhiều bé, baby_specific, khớp độ tuổi ĐÚNG 1 bé.
  if (babyCount > 1 && ageMatchBabyIds.length === 1) {
    return {
      assignmentStatus: 'suggested',
      babyId: null, // 🔴 KHÔNG set babyId ở suggested
      suggestedBabyId: ageMatchBabyIds[0]!,
      confidence: 'medium',
      source: 'auto_age_match',
    };
  }

  // Cấp 3 — Cấp khách (BABY-10): không suy được / khách chưa có bé / sỉ / quà.
  return {
    assignmentStatus: 'customer_level',
    babyId: null,
    suggestedBabyId: null,
    confidence: 'low',
    source: 'unassigned',
  };
}

// ============================================================
// Thao tác hàng loạt NGHIÊM NGẶT (§6.5) — preview đủ điều kiện áp.
// ============================================================

export interface BulkLine {
  lineId: string;
  customerId: string;
  invoiceId: string;
  assignmentStatus: AssignmentStatusStr;
  suggestedBabyId: string | null;
  confidence: ConfidenceStr;
  babyAssignmentMode: BabyAssignmentModeStr;
  isSplitAcrossBabies: boolean;
}

export interface BulkEvaluation {
  eligibleLineIds: string[];
  rejected: { lineId: string; reason: string }[];
}

// ============================================================
// 🔴 FIX-6 (§8.5, UAT-31): chia SL cho nhiều bé — bất biến tổng SL.
// Σ assignedQuantity mọi phần == số lượng dòng hàng. Chưa đủ => TỪ CHỐI (không âm thầm rơi SL).
// ============================================================

export interface SplitSegment {
  /** babyId cụ thể, hoặc null = phần cấp khách (customer_level). */
  babyId: string | null;
  assignedQuantity: number;
}

export interface SplitValidation {
  ok: boolean;
  error?: string;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Kiểm bất biến tổng SL khi chia dòng cho nhiều bé (ALLOC §8.5). */
export function validateSplitSegments(
  lineQuantity: number,
  segments: SplitSegment[],
): SplitValidation {
  if (segments.length === 0) {
    return { ok: false, error: 'Cần ít nhất một phần chia số lượng.', total: 0 };
  }
  for (const s of segments) {
    if (!(s.assignedQuantity > 0)) {
      return { ok: false, error: 'Số lượng mỗi phần phải lớn hơn 0.', total: 0 };
    }
  }
  const total = round2(segments.reduce((sum, s) => sum + s.assignedQuantity, 0));
  const lineQty = round2(lineQuantity);
  if (Math.abs(total - lineQty) > 0.001) {
    return {
      ok: false,
      error: `Tổng số lượng chia (${total}) phải bằng số lượng dòng hàng (${lineQty}). Không được làm rơi số lượng.`,
      total,
    };
  }
  return { ok: true, total };
}

/**
 * 🔴 Chỉ áp hàng loạt khi: cùng customer + cùng invoice + suggestedBabyId GIỐNG NHAU +
 * mỗi dòng đã được engine gợi ý ĐỘC LẬP (status=suggested) + confidence medium + SP không multi_audience.
 * TUYỆT ĐỐI không áp cho unknown/chưa có suggested/multi_audience/chia nhiều bé/not_applicable.
 */
export function evaluateBulkApply(lines: BulkLine[]): BulkEvaluation {
  const eligibleLineIds: string[] = [];
  const rejected: { lineId: string; reason: string }[] = [];

  if (lines.length === 0) return { eligibleLineIds, rejected };

  // Phải cùng 1 customer + 1 invoice + cùng suggestedBabyId.
  const first = lines[0]!;
  const sameCustomer = lines.every((l) => l.customerId === first.customerId);
  const sameInvoice = lines.every((l) => l.invoiceId === first.invoiceId);

  for (const l of lines) {
    if (!sameCustomer || !sameInvoice) {
      rejected.push({ lineId: l.lineId, reason: 'Khác khách hoặc khác hóa đơn' });
      continue;
    }
    if (l.babyAssignmentMode === 'multi_audience' || l.babyAssignmentMode === 'not_baby_applicable') {
      rejected.push({ lineId: l.lineId, reason: 'SP không thuộc loại gắn bé' });
      continue;
    }
    if (l.assignmentStatus !== 'suggested') {
      rejected.push({ lineId: l.lineId, reason: 'Dòng chưa được engine gợi ý độc lập' });
      continue;
    }
    if (l.confidence !== 'medium') {
      rejected.push({ lineId: l.lineId, reason: 'Độ tin cậy không phải medium' });
      continue;
    }
    if (!l.suggestedBabyId || l.suggestedBabyId !== first.suggestedBabyId) {
      rejected.push({ lineId: l.lineId, reason: 'Gợi ý bé không đồng nhất' });
      continue;
    }
    if (l.isSplitAcrossBabies) {
      rejected.push({ lineId: l.lineId, reason: 'Dòng chia cho nhiều bé' });
      continue;
    }
    eligibleLineIds.push(l.lineId);
  }

  return { eligibleLineIds, rejected };
}
