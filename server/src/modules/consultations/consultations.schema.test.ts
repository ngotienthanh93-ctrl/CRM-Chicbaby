import { describe, it, expect } from 'vitest';
import { consultationUpdateSchema } from './consultations.router';

// 🔴 FIX-3 (CONC-03): PUT /consultations/:id BẮT BUỘC `version` để khóa lạc quan.
// Thiếu version ⇒ schema fail ⇒ router trả 400 (không cho update KHÔNG lock).
describe('consultation — PUT bắt buộc version (🔴 FIX-3 / CONC-03)', () => {
  it('🔴 thiếu version => KHÔNG hợp lệ (dẫn tới 400)', () => {
    const r = consultationUpdateSchema.safeParse({ issue: 'Bé táo bón' });
    expect(r.success).toBe(false);
  });

  it('có version (int) => hợp lệ; các trường khác vẫn optional', () => {
    expect(consultationUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(consultationUpdateSchema.safeParse({ issue: 'x', version: 3 }).success).toBe(true);
  });

  it('🔴 version không phải số nguyên => KHÔNG hợp lệ', () => {
    expect(consultationUpdateSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(consultationUpdateSchema.safeParse({ version: '3' }).success).toBe(false);
  });
});
