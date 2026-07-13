// Helper hiển thị & ép kiểu giá trị cấu hình cho SCR-14.
// Giá trị cấu hình đa kiểu (số/chuỗi/bool/null); control nhập phải khớp kiểu hiện hành.
import type { ConfigValue } from '../../api/types';

export type ConfigValueKind = 'number' | 'boolean' | 'string';

/**
 * 🔴 Chỉ giá trị SCALAR (số/chuỗi/bool) mới sửa được qua SCR-14 — PUT /api/config chỉ nhận scalar.
 * Giá trị JSON phức tạp (mảng/object, vd `consultation.quick_templates`) là read-only ở màn này.
 */
export function isScalarConfigValue(value: ConfigValue): value is number | string | boolean {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

/** Suy ra kiểu control nhập theo giá trị hiện tại (để không đổi kiểu tham số khi lưu). */
export function valueKind(value: ConfigValue): ConfigValueKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** Hiển thị giá trị cấu hình (null = ∞ khóa cứng; JSON phức tạp = xem gọn, không sửa tại đây). */
export function fmtConfigValue(value: ConfigValue): string {
  if (value === null || value === undefined) return '∞';
  if (typeof value === 'boolean') return value ? 'Có (bật)' : 'Không (tắt)';
  if (typeof value === 'object') {
    // Mảng/object: xem gọn dạng JSON (cắt ngắn) — tránh "[object Object]".
    const json = JSON.stringify(value);
    return json.length > 80 ? `${json.slice(0, 77)}…` : json;
  }
  return String(value);
}

/** Giá trị khởi tạo cho ô nhập (chuỗi) từ giá trị hiện tại. */
export function toInputString(value: ConfigValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Ép chuỗi nhập về đúng kiểu. `ok=false` ⇒ giá trị chưa hợp lệ (chặn Lưu).
 * number: phải là số hữu hạn; string: không rỗng sau trim; boolean: 'true'/'false'.
 */
export function parseConfigInput(
  raw: string,
  kind: ConfigValueKind,
): { ok: boolean; value: ConfigValue } {
  if (kind === 'number') {
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: false, value: null };
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { ok: false, value: null };
    return { ok: true, value: n };
  }
  if (kind === 'boolean') {
    return { ok: true, value: raw === 'true' };
  }
  if (raw.trim() === '') return { ok: false, value: '' };
  return { ok: true, value: raw };
}
