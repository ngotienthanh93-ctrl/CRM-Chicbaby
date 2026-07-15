import { badRequest } from '../../lib/http';

/** Trần dung lượng 1 ảnh bằng chứng (sau nén phía client vẫn chừa biên an toàn). */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

/** MIME ảnh cho phép KHAI BÁO trong data URL (kiểm sớm để báo lỗi rõ; loại cuối lấy từ magic bytes). */
const ALLOWED_DECLARED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// data URL ảnh base64: data:image/<subtype>;base64,<payload>
const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

/**
 * Nhận diện loại ảnh từ CHỮ KÝ NHỊ PHÂN (magic bytes) — KHÔNG tin MIME khai báo.
 * Chỉ trả về loại nằm trong allowlist; bytes rác / không phải ảnh => null.
 */
function detectImageMime(buf: Buffer): string | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: 'RIFF' (52 49 46 46) tại 0..3 VÀ 'WEBP' (57 45 42 50) tại 8..11
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Giải mã data URL ảnh base64 gửi trong body JSON (mô hình chống CSRF — KHÔNG dùng multipart).
 * Bảo mật: kiểm MIME khai báo thuộc allowlist (báo lỗi sớm), rồi XÁC MINH magic bytes và lấy loại
 * phát hiện từ chữ ký nhị phân làm mimeType lưu (chống gắn nhãn ảnh cho file rác). Ném badRequest nếu sai.
 */
export function parseImageDataUrl(
  input: string,
  maxBytes: number,
): { mimeType: string; buffer: Buffer } {
  if (typeof input !== 'string') {
    throw badRequest('Ảnh bằng chứng không hợp lệ.');
  }
  const match = DATA_URL_RE.exec(input.trim());
  if (!match) {
    throw badRequest('Ảnh bằng chứng phải là data URL ảnh (base64).');
  }
  const declaredMime = match[1]!.toLowerCase();
  if (!ALLOWED_DECLARED_MIME.has(declaredMime)) {
    throw badRequest('Chỉ chấp nhận ảnh JPEG, PNG hoặc WEBP.');
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2]!, 'base64');
  } catch {
    throw badRequest('Ảnh bằng chứng không giải mã được.');
  }
  // Buffer.from base64 bỏ qua ký tự lạ một cách âm thầm => rỗng nghĩa là payload không hợp lệ.
  if (buffer.length === 0) {
    throw badRequest('Ảnh bằng chứng rỗng hoặc không hợp lệ.');
  }
  if (buffer.length > maxBytes) {
    throw badRequest('Ảnh bằng chứng quá lớn (tối đa 5MB).');
  }
  // 🔴 KHÔNG tin MIME khai báo: bytes phải khớp chữ ký ảnh thật; mimeType lưu lấy từ magic bytes.
  const detected = detectImageMime(buffer);
  if (!detected) {
    throw badRequest('Ảnh không hợp lệ (không đúng định dạng JPEG/PNG/WEBP).');
  }
  return { mimeType: detected, buffer };
}
