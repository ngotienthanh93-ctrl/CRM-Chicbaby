// 🔴 Gộp hồ sơ bé TRÙNG (chỉ Chủ shop duyệt). Nguyên tắc BẤT BIẾN #1: hồ sơ bé SAI tệ hơn TRỐNG ⇒
// gộp CỰC KỲ bảo thủ: chỉ gộp 2 bé CÙNG một khách (owner khẳng định là CÙNG một bé), GIỮ NGUYÊN dữ liệu
// bé master (không đoán/ghi đè), chỉ GAP-FILL các field master đang TRỐNG bằng giá trị của bé trùng.
// Bé trùng bị SOFT-DELETE (không hủy dữ liệu — có thể khôi phục nếu gộp nhầm).
//
// Logic THUẦN (test được): tính "patch" gap-fill. KHÔNG chạm DB.

/** Ảnh chụp một bé giới hạn ở các field GỘP ĐƯỢC (kiểu khớp BabyProfile; null = trống). */
export interface BabyMergeSnapshot {
  babyName: string | null;
  birthDate: Date | null;
  estimatedBirthMonth: Date | null;
  ageMonthsAtRecording: number | null;
  ageRecordedAt: Date | null;
  gender: string | null;
  allergies: string | null;
  condition: string | null;
  note: string | null;
}

// 🔴 CỐ Ý LOẠI mọi field ĐỊNH DANH TUỔI (birthDate/estimatedBirthMonth/ageMonthsAtRecording/ageRecordedAt):
// chúng là MỘT KHỐI gắn với datePrecision; master LUÔN đã có định danh tuổi (BABY-02) nên gap-fill lẻ sẽ trộn
// định danh master + bé trùng ⇒ datePrecision lệch, tính tuổi SAI (nguyên tắc #1/#10). Master giữ nguyên định
// danh tuổi của mình. Chỉ gap-fill các field ĐỘC LẬP an toàn.
/** Các field được phép GAP-FILL (điền khi master trống) — chỉ field độc lập, KHÔNG đụng định danh tuổi. */
export const BABY_GAP_FILL_KEYS: (keyof BabyMergeSnapshot)[] = [
  'babyName',
  'gender',
  'allergies',
  'condition',
  'note',
];

/**
 * Tính patch GAP-FILL: chỉ điền field master đang null bằng giá trị NON-NULL của bé trùng.
 * 🔴 KHÔNG BAO GIỜ ghi đè giá trị master đã có (master luôn thắng) — chống làm SAI hồ sơ bé.
 */
export function planBabyGapFill(
  master: BabyMergeSnapshot,
  duplicate: BabyMergeSnapshot,
): Partial<BabyMergeSnapshot> {
  const patch: Partial<BabyMergeSnapshot> = {};
  for (const key of BABY_GAP_FILL_KEYS) {
    const m = master[key];
    const d = duplicate[key];
    if ((m === null || m === undefined) && d !== null && d !== undefined) {
      // d cùng kiểu với master[key] (2 ảnh chụp cùng shape) — cast cục bộ để gán qua union key.
      patch[key] = d as never;
    }
  }
  return patch;
}
