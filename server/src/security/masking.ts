// Masking SERVER-SIDE (§3, SEC-01..12). 🔴 Backend KHÔNG gửi giá trị thật xuống client nếu thiếu quyền.
// Mọi hàm mask nhận cờ `canView` do tầng quyền quyết định TRƯỚC khi trả JSON.
import { normalizePhone } from '../lib/phone';
import { formatVnDate } from '../lib/datetime';

export const MASK_BABY_NAME = '••••';
export const MASK_BIRTHDATE = '••/••/••••';
export const MASK_SENSITIVE_TEXT = '[Không có quyền xem]';

/** SĐT: `0912345678` -> `09xx…678` khi không có quyền (§3). */
export function maskPhone(raw: string | null | undefined, canView: boolean): string | null {
  if (raw == null || raw === '') return null;
  if (canView) return raw;
  const p = normalizePhone(raw);
  if (p.length >= 5) {
    return `${p.slice(0, 2)}xx…${p.slice(-3)}`;
  }
  return '••…•';
}

/** Địa chỉ: đầy đủ khi có quyền; ngược lại chỉ quận + tỉnh (2 cụm cuối). */
export function maskAddress(raw: string | null | undefined, canView: boolean): string | null {
  if (raw == null || raw === '') return null;
  if (canView) return raw;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join(', ');
  }
  return '[Đã ẩn]';
}

export function maskBabyName(name: string | null | undefined, canView: boolean): string | null {
  if (canView) return name ?? null;
  return MASK_BABY_NAME;
}

export function maskBirthDate(date: Date | null | undefined, canView: boolean): string | null {
  if (canView) return date ? formatVnDate(date) : null;
  return MASK_BIRTHDATE;
}

/** Dị ứng / tình trạng bé: đầy đủ hoặc `[Không có quyền xem]`. */
export function maskSensitiveText(
  value: string | null | undefined,
  canView: boolean,
): string | null {
  if (canView) return value ?? null;
  return value ? MASK_SENSITIVE_TEXT : null;
}
