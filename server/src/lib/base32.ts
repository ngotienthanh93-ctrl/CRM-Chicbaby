// Base32 (RFC 4648, bảng A–Z2–7) — dùng cho secret TOTP (authenticator app đọc/ghi secret dạng base32).
// Thuần, không phụ thuộc lib ngoài (nguyên tắc dự án). Test được bằng vector chuẩn.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CHAR_TO_VAL = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) CHAR_TO_VAL.set(ALPHABET[i]!, i);

/** Mã hóa bytes → chuỗi base32 (KHÔNG padding — chuẩn cho secret TOTP). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Giải mã chuỗi base32 → bytes. Bỏ qua khoảng trắng + padding '='; ném lỗi nếu ký tự không hợp lệ. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/,'').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = CHAR_TO_VAL.get(ch);
    if (idx === undefined) throw new Error(`Ký tự base32 không hợp lệ: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
