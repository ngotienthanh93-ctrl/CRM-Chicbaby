// Gợi ý gộp khách (§dedup). 🔴 Nguyên tắc bất biến #7: KHÔNG tự động gộp; chỉ Chủ shop duyệt.
// KHÔNG gợi ý gộp CHỈ vì tên giống nhau. Gia đình dùng chung SĐT (CUS-13) => chung số KHÔNG đủ để gộp.
import { normalizePhone } from '../lib/phone';

export interface MergeCandidateCustomer {
  id: string;
  fullName: string;
  phones: string[]; // raw
  facebook?: string | null;
  zalo?: string | null;
  address?: string | null;
}

export interface MergeSignals {
  samePhone: boolean;
  sameName: boolean;
  sameFacebook: boolean;
  sameZalo: boolean;
  sameAddress: boolean;
}

// Trọng số: SĐT-đơn (60) và tên-đơn (35) đều < 90 => không đủ tự gợi ý một mình.
const WEIGHTS = {
  samePhone: 60,
  sameName: 35,
  sameFacebook: 50,
  sameZalo: 50,
  sameAddress: 20,
};

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeSignals(a: MergeCandidateCustomer, b: MergeCandidateCustomer): MergeSignals {
  const aPhones = new Set(a.phones.map(normalizePhone).filter(Boolean));
  const bPhones = new Set(b.phones.map(normalizePhone).filter(Boolean));
  const samePhone = [...aPhones].some((p) => bPhones.has(p));
  return {
    samePhone,
    sameName: normName(a.fullName) === normName(b.fullName) && a.fullName.trim() !== '',
    sameFacebook: !!a.facebook && !!b.facebook && a.facebook === b.facebook,
    sameZalo: !!a.zalo && !!b.zalo && a.zalo === b.zalo,
    sameAddress: !!a.address && !!b.address && normName(a.address) === normName(b.address),
  };
}

export function scoreSignals(sig: MergeSignals): number {
  let score = 0;
  if (sig.samePhone) score += WEIGHTS.samePhone;
  if (sig.sameName) score += WEIGHTS.sameName;
  if (sig.sameFacebook) score += WEIGHTS.sameFacebook;
  if (sig.sameZalo) score += WEIGHTS.sameZalo;
  if (sig.sameAddress) score += WEIGHTS.sameAddress;
  return score;
}

export interface MergeDecision {
  score: number;
  suggest: boolean;
  autoMerge: false; // 🔴 LUÔN false
  signals: MergeSignals;
  familyPhoneRisk: boolean; // chung số nhưng khác tên => có thể là gia đình
}

/**
 * Đánh giá một cặp khách. autoMerge LUÔN false. `suggest` chỉ khi score ≥ threshold
 * và KHÔNG phải trùng-tên-đơn thuần (tên một mình không bao giờ đạt ngưỡng).
 */
export function evaluateMergePair(
  a: MergeCandidateCustomer,
  b: MergeCandidateCustomer,
  threshold: number,
): MergeDecision {
  const signals = computeSignals(a, b);
  const score = scoreSignals(signals);
  // Chung số nhưng khác tên => rủi ro gia đình dùng chung số => KHÔNG gợi ý một mình.
  const familyPhoneRisk = signals.samePhone && !signals.sameName;
  // Cần ≥2 tín hiệu (không suy từ 1 tín hiệu đơn: chung-số-đơn hay trùng-tên-đơn đều < ngưỡng).
  const signalCount =
    Number(signals.samePhone) +
    Number(signals.sameName) +
    Number(signals.sameFacebook) +
    Number(signals.sameZalo) +
    Number(signals.sameAddress);
  const suggest = score >= threshold && signalCount >= 2;
  return { score, suggest, autoMerge: false, signals, familyPhoneRisk };
}
