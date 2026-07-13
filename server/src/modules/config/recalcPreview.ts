// 🔴 CFG-02/03, CYC-08 — PREVIEW ảnh hưởng khi chọn `recalculate` cho một tham số.
// LOGIC THUẦN, test được KHÔNG cần DB: đối chiếu tập việc-đang-mở hiện tại với tập nhắc
// tái tạo dưới CONFIG MỚI để đếm việc ĐỔI / ĐÓNG / MẤT.
//
// 🔴 Hàm này TUYỆT ĐỐI read-only: chỉ nhận snapshot đầu vào và trả về số liệu — KHÔNG ghi/mutate gì.
// Router chịu trách nhiệm đọc DB (chỉ SELECT) rồi dựng hai snapshot dưới đây.

/** Ảnh chụp một việc chủ động ĐANG MỞ (ngày đến hạn hiện tại). */
export interface OpenFollowUpSnapshot {
  /** Định danh ỔN ĐỊNH để khớp với bản tái tạo (thường là followUpId). */
  key: string;
  dueDate: Date;
}

/** Một nhắc được TÁI TẠO dưới CONFIG MỚI. Khớp với việc đang mở qua `key`. */
export interface RegeneratedReminder {
  key: string;
  dueDate: Date;
  /** true nếu dưới luật MỚI việc này sẽ ĐÓNG (vd đã đủ ngưỡng/không còn hợp lệ để mở). */
  shouldClose?: boolean;
}

export interface RecalcPreviewResult {
  /** Tổng việc bị tác động = changed + closed + lost. */
  affected: number;
  /** Còn tồn tại nhưng NGÀY ĐẾN HẠN đổi. */
  changed: number;
  /** Còn tồn tại nhưng sẽ ĐÓNG theo luật mới. */
  closed: number;
  /** KHÔNG còn được tạo dưới config mới (mất). */
  lost: number;
  /** Số việc đang mở được đối chiếu. */
  sampleSize: number;
  /**
   * true  = số liệu là bản xem trước THỰC TÍNH (tin cậy được).
   * false = KHÔNG ước lượng được (tham số không tác động việc đã tạo, hoặc chưa hỗ trợ tính chính xác)
   *         — khi đó affected/changed/closed/lost là 0 và `note` giải thích rõ. Trung thực hơn là bịa số.
   */
  estimated: boolean;
  /** Ghi chú tiếng Việt: cơ sở tính / giới hạn ước lượng (trình bày cho người dùng). */
  note: string;
}

export interface RecalcPreviewOptions {
  note?: string;
  estimated?: boolean;
}

/**
 * Đối chiếu THUẦN việc-đang-mở với bản tái tạo dưới config mới.
 * - Không có trong bản tái tạo => `lost`.
 * - Có nhưng `shouldClose` => `closed`.
 * - Có, không đóng, nhưng ngày đến hạn khác => `changed`.
 * - Có, không đóng, ngày đến hạn y hệt => không tính (không đổi).
 */
export function computeRecalcPreview(
  currentOpen: OpenFollowUpSnapshot[],
  regenerated: RegeneratedReminder[],
  opts: RecalcPreviewOptions = {},
): RecalcPreviewResult {
  const byKey = new Map<string, RegeneratedReminder>();
  for (const r of regenerated) byKey.set(r.key, r);

  let changed = 0;
  let closed = 0;
  let lost = 0;
  for (const cur of currentOpen) {
    const reg = byKey.get(cur.key);
    if (!reg) {
      lost++;
      continue;
    }
    if (reg.shouldClose === true) {
      closed++;
      continue;
    }
    if (reg.dueDate.getTime() !== cur.dueDate.getTime()) {
      changed++;
    }
  }

  return {
    affected: changed + closed + lost,
    changed,
    closed,
    lost,
    sampleSize: currentOpen.length,
    estimated: opts.estimated ?? true,
    note: opts.note ?? '',
  };
}
