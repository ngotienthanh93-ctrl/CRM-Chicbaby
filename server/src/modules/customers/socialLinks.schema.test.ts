import { describe, it, expect } from 'vitest';
import { socialLinksSchema } from './customers.router';

// Schema của PUT /customers/:id/social-links: mỗi field OPTIONAL + NULLABLE (null = gỡ link),
// chuỗi tối đa 500 ký tự. Việc chuẩn hóa/kiểm tra host nằm ở normalizeFacebook/normalizeZalo.
describe('socialLinksSchema', () => {
  it('chuỗi hợp lệ / null / undefined đều qua', () => {
    expect(socialLinksSchema.safeParse({ facebook: 'chicbaby.shop' }).success).toBe(true);
    expect(socialLinksSchema.safeParse({ facebook: null }).success).toBe(true);
    expect(socialLinksSchema.safeParse({ zalo: '0912343300' }).success).toBe(true);
    expect(socialLinksSchema.safeParse({}).success).toBe(true); // cả hai undefined
  });

  it('phân biệt undefined (không gửi) vs null (gỡ link)', () => {
    const r = socialLinksSchema.safeParse({ facebook: null });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.facebook).toBeNull();
      expect(r.data.zalo).toBeUndefined();
    }
  });

  it('🔴 chuỗi > 500 ký tự => KHÔNG hợp lệ (dẫn tới 400)', () => {
    expect(socialLinksSchema.safeParse({ facebook: 'a'.repeat(501) }).success).toBe(false);
  });

  it('🔴 kiểu sai (số) => KHÔNG hợp lệ', () => {
    expect(socialLinksSchema.safeParse({ facebook: 123 }).success).toBe(false);
    expect(socialLinksSchema.safeParse({ zalo: {} }).success).toBe(false);
  });
});
