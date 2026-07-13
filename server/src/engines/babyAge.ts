// Tuổi bé TRÔI theo thời gian (BABY-01, nguyên tắc bất biến #10): LUÔN tính tuổi hiện tại
// từ birthDate hoặc estimatedBirthMonth; KHÔNG đọc thẳng ageMonthsAtRecording.

export interface BabyAgeInput {
  birthDate?: Date | null;
  estimatedBirthMonth?: Date | null;
  ageMonthsAtRecording?: number | null;
  ageRecordedAt?: Date | null;
}

/** Trừ `months` tháng khỏi một mốc (giữ ngày). Dùng suy estimatedBirthMonth. */
export function subMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() - months);
  return r;
}

/** Số tháng TRỌN VẸN giữa `from` và `to` (>= 0). */
export function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** estimatedBirthMonth = ageRecordedAt − ageMonthsAtRecording (§2.3). */
export function estimatedBirthMonthFrom(ageRecordedAt: Date, ageMonthsAtRecording: number): Date {
  return subMonths(ageRecordedAt, ageMonthsAtRecording);
}

/** Tuổi hiện tại (tháng). Ưu tiên birthDate (exact) > estimatedBirthMonth > suy từ ageRecordedAt. */
export function computeCurrentAgeMonths(input: BabyAgeInput, now: Date = new Date()): number | null {
  if (input.birthDate) return monthsBetween(input.birthDate, now);
  if (input.estimatedBirthMonth) return monthsBetween(input.estimatedBirthMonth, now);
  if (input.ageMonthsAtRecording != null && input.ageRecordedAt) {
    const est = estimatedBirthMonthFrom(input.ageRecordedAt, input.ageMonthsAtRecording);
    return monthsBetween(est, now);
  }
  return null;
}

/**
 * 🔴 FIX-7 (BABY-01/02): hồ sơ bé PHẢI luôn tính được tuổi.
 * Hợp lệ khi có birthDate HOẶC estimatedBirthMonth HOẶC (ageMonthsAtRecording + ageRecordedAt).
 * Dùng để chặn update xóa hết mốc tuổi.
 */
export function hasValidAgeIdentity(input: BabyAgeInput): boolean {
  if (input.birthDate) return true;
  if (input.estimatedBirthMonth) return true;
  if (input.ageMonthsAtRecording != null && input.ageRecordedAt) return true;
  return false;
}

export interface AgeStage {
  label: string;
  fromMonths: number;
  toMonths: number | null;
}

/** Parse chuỗi ngưỡng ⚙️ "0-6,6-12,12-36,36+" thành các giai đoạn. */
export function parseAgeStages(thresholds: string): AgeStage[] {
  return thresholds.split(',').map((seg) => {
    const s = seg.trim();
    if (s.endsWith('+')) {
      const from = Number(s.slice(0, -1));
      return { label: s, fromMonths: from, toMonths: null };
    }
    const [a, b] = s.split('-');
    return { label: s, fromMonths: Number(a), toMonths: Number(b) };
  });
}

/** Giai đoạn tuổi hiện tại theo ngưỡng cấu hình. */
export function ageStageOf(ageMonths: number | null, thresholds: string): string | null {
  if (ageMonths == null) return null;
  const stages = parseAgeStages(thresholds);
  for (const st of stages) {
    if (ageMonths >= st.fromMonths && (st.toMonths == null || ageMonths < st.toMonths)) {
      return st.label;
    }
  }
  return stages.length > 0 ? stages[stages.length - 1]!.label : null;
}

/** Bé có khớp khoảng tuổi phù hợp của SP không (dùng cho gợi ý cấp 2). */
export function babyMatchesProductAge(
  ageMonths: number | null,
  ageFromMonths: number | null | undefined,
  ageToMonths: number | null | undefined,
): boolean {
  if (ageMonths == null) return false;
  if (ageFromMonths != null && ageMonths < ageFromMonths) return false;
  if (ageToMonths != null && ageMonths > ageToMonths) return false;
  return true;
}
