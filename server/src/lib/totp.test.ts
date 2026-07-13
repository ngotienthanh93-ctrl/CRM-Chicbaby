import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode } from './base32';
import { totpCode, verifyTotp, totpAuthUri, generateTotpSecret } from './totp';

describe('base32 — vector chuẩn RFC 4648', () => {
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];
  it('encode khớp vector', () => {
    for (const [plain, b32] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(b32);
    }
  });
  it('round-trip decode(encode(x)) === x', () => {
    for (const [plain] of vectors) {
      expect(base32Decode(base32Encode(Buffer.from(plain))).toString()).toBe(plain);
    }
  });
  it('bỏ qua padding/space; ký tự lạ ⇒ ném lỗi', () => {
    expect(base32Decode('MZXW6YTBOI======').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW0')).toThrow();
  });
});

// RFC 6238 Appendix B (SHA1, secret ASCII "12345678901234567890"); mã 6 chữ số = 6 chữ số cuối của mã 8 chữ số.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP — vector chuẩn RFC 6238 (SHA1, 6 chữ số)', () => {
  const cases: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];
  it('secret base32 khớp', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
  it('totpCode khớp vector tại từng mốc thời gian', () => {
    for (const [sec, code] of cases) {
      expect(totpCode(RFC_SECRET, sec * 1000)).toBe(code);
    }
  });
});

describe('verifyTotp — xác minh + trôi thời gian + chống mã sai', () => {
  const now = 1111111111 * 1000;
  it('mã đúng tại thời điểm hiện tại ⇒ true', () => {
    expect(verifyTotp(RFC_SECRET, '050471', now)).toBe(true);
  });
  it('cho phép trôi ±1 bước (±30s)', () => {
    expect(verifyTotp(RFC_SECRET, '081804', now, 1)).toBe(true); // bước trước (T=1111111109)
    // window=0 ⇒ chỉ nhận mã hiện tại
    expect(verifyTotp(RFC_SECRET, '081804', now, 0)).toBe(false);
  });
  it('mã sai / sai định dạng ⇒ false (không ném)', () => {
    expect(verifyTotp(RFC_SECRET, '000000', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abc', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBe(false);
  });
  it('secret tự sinh: mã hiện tại tự verify được (đủ dài, base32 hợp lệ)', () => {
    const s = generateTotpSecret();
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(verifyTotp(s, totpCode(s))).toBe(true);
  });
});

describe('totpAuthUri', () => {
  it('sinh otpauth URI đúng định dạng', () => {
    const uri = totpAuthUri(RFC_SECRET, 'chushop', 'CRM Chicbaby');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain('issuer=CRM+Chicbaby');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
