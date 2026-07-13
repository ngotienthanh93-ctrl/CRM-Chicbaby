// Chuẩn hóa SĐT (CUS-12 / PHONE-02): bỏ khoảng trắng/chấm/gạch/ngoặc, `+84xxx`→`0xxx`.
// Mục tiêu canonical: `0912345678` và `+84912345678` và `0912.345.678` => CÙNG một số (UAT-16).

/** Trả về dạng chuẩn hóa (chỉ chữ số, đầu số nội địa `0...`). */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  // Bỏ mọi ký tự phân tách phổ biến, giữ lại dấu + để nhận diện mã quốc gia.
  let s = raw.trim().replace(/[\s.\-()]/g, '');

  if (s.startsWith('+84')) {
    s = '0' + s.slice(3);
  } else if (s.startsWith('0084')) {
    s = '0' + s.slice(4);
  } else if (s.startsWith('84') && s.length === 11) {
    // 84 + 9 chữ số (không dấu +) => nội địa
    s = '0' + s.slice(2);
  }

  // Bỏ nốt mọi ký tự không phải chữ số còn sót lại (vd dấu + của số khác quốc gia).
  s = s.replace(/\D/g, '');
  return s;
}

/** Hai SĐT có cùng canonical không (dùng cho gợi ý trùng — KHÔNG tự gộp). */
export function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}
