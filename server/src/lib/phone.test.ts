import { describe, it, expect } from 'vitest';
import { normalizePhone, phonesEqual } from './phone';

describe('phone — canonical (CUS-12/PHONE-02)', () => {
  it('UAT-16: 0912345678 và +84912345678 => CÙNG một số', () => {
    expect(normalizePhone('0912345678')).toBe('0912345678');
    expect(normalizePhone('+84912345678')).toBe('0912345678');
    expect(phonesEqual('0912345678', '+84912345678')).toBe(true);
  });

  it('bỏ khoảng trắng/chấm/gạch/ngoặc', () => {
    expect(normalizePhone('0912.345.678')).toBe('0912345678');
    expect(normalizePhone('0912 345 678')).toBe('0912345678');
    expect(normalizePhone('(091) 234-5678')).toBe('0912345678');
  });

  it('84xxxxxxxxx (không dấu +, 11 số) => nội địa 0xxx', () => {
    expect(normalizePhone('84912345678')).toBe('0912345678');
    expect(normalizePhone('0084912345678')).toBe('0912345678');
  });

  it('số rỗng/không hợp lệ', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(phonesEqual('', '')).toBe(false);
  });
});
