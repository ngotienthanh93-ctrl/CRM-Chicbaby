import { describe, it, expect } from 'vitest';
import { normalizeFacebook, normalizeZalo } from './socialLinks';

describe('normalizeFacebook', () => {
  it('rỗng / null / khoảng trắng => null (gỡ link)', () => {
    expect(normalizeFacebook('')).toBeNull();
    expect(normalizeFacebook('   ')).toBeNull();
    expect(normalizeFacebook(null)).toBeNull();
    expect(normalizeFacebook(undefined)).toBeNull();
  });

  it('URL facebook đầy đủ => giữ nguyên (ép https)', () => {
    expect(normalizeFacebook('https://facebook.com/chicbaby.shop')).toBe(
      'https://facebook.com/chicbaby.shop',
    );
    expect(normalizeFacebook('http://www.facebook.com/abc')).toBe('https://www.facebook.com/abc');
    expect(normalizeFacebook('https://m.me/chicbaby')).toBe('https://m.me/chicbaby');
  });

  it('host/path không scheme => ghép https', () => {
    expect(normalizeFacebook('facebook.com/chicbaby.shop')).toBe(
      'https://facebook.com/chicbaby.shop',
    );
  });

  it('username trần (có/không @) => https://facebook.com/<user>', () => {
    expect(normalizeFacebook('chicbaby.shop')).toBe('https://facebook.com/chicbaby.shop');
    expect(normalizeFacebook('@chicbaby.shop')).toBe('https://facebook.com/chicbaby.shop');
  });

  it('🔴 chặn javascript:/data: (chống XSS href)', () => {
    expect(() => normalizeFacebook('javascript:alert(1)')).toThrow();
    expect(() => normalizeFacebook('data:text/html,<script>')).toThrow();
    expect(() => normalizeFacebook('JavaScript:alert(1)')).toThrow();
  });

  it('🔴 chặn host lạ (phishing)', () => {
    expect(() => normalizeFacebook('https://evil.com/chicbaby')).toThrow();
    expect(() => normalizeFacebook('https://facebook.com.evil.com/x')).toThrow();
  });

  it('handle chứa ký tự lạ (khoảng trắng) => 400', () => {
    expect(() => normalizeFacebook('ten co dau')).toThrow();
  });
});

describe('normalizeZalo', () => {
  it('rỗng => null', () => {
    expect(normalizeZalo('')).toBeNull();
    expect(normalizeZalo(null)).toBeNull();
  });

  it('URL zalo đầy đủ / host-path / số điện thoại trần', () => {
    expect(normalizeZalo('https://zalo.me/0912343300')).toBe('https://zalo.me/0912343300');
    expect(normalizeZalo('zalo.me/0912343300')).toBe('https://zalo.me/0912343300');
    expect(normalizeZalo('0912343300')).toBe('https://zalo.me/0912343300');
  });

  it('🔴 chặn scheme nguy hiểm & host lạ', () => {
    expect(() => normalizeZalo('javascript:alert(1)')).toThrow();
    expect(() => normalizeZalo('https://facebook.com/x')).toThrow();
  });
});
