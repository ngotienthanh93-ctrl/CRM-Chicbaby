import { describe, it, expect } from 'vitest';
import {
  ageStageOf,
  computeCurrentAgeMonths,
  estimatedBirthMonthFrom,
  hasValidAgeIdentity,
  monthsBetween,
} from './babyAge';

const d = (s: string) => new Date(s + 'T00:00:00.000Z');

describe('FIX-7 — bất biến tuổi bé (BABY-01/02)', () => {
  it('có birthDate => hợp lệ', () => {
    expect(hasValidAgeIdentity({ birthDate: d('2025-01-01') })).toBe(true);
  });

  it('có estimatedBirthMonth => hợp lệ', () => {
    expect(hasValidAgeIdentity({ estimatedBirthMonth: d('2025-01-01') })).toBe(true);
  });

  it('có ageMonthsAtRecording + ageRecordedAt => hợp lệ', () => {
    expect(
      hasValidAgeIdentity({ ageMonthsAtRecording: 8, ageRecordedAt: d('2026-01-01') }),
    ).toBe(true);
  });

  it('🔴 xóa HẾT mốc tuổi => KHÔNG hợp lệ (chặn update)', () => {
    expect(
      hasValidAgeIdentity({
        birthDate: null,
        estimatedBirthMonth: null,
        ageMonthsAtRecording: null,
        ageRecordedAt: null,
      }),
    ).toBe(false);
  });

  it('ageMonthsAtRecording mà THIẾU ageRecordedAt => KHÔNG hợp lệ', () => {
    expect(hasValidAgeIdentity({ ageMonthsAtRecording: 8, ageRecordedAt: null })).toBe(false);
  });
});

describe('babyAge — tuổi trôi theo thời gian (BABY-01)', () => {
  it('UAT-21: nhập "8 tháng" tại 2026-01-15, 6 tháng sau (2026-07-15) => 14 tháng', () => {
    const ageRecordedAt = d('2026-01-15');
    const est = estimatedBirthMonthFrom(ageRecordedAt, 8); // 2025-05-15
    const age = computeCurrentAgeMonths({ estimatedBirthMonth: est }, d('2026-07-15'));
    expect(age).toBe(14);
  });

  it('tính từ birthDate exact', () => {
    expect(computeCurrentAgeMonths({ birthDate: d('2025-01-15') }, d('2026-01-15'))).toBe(12);
  });

  it('UAT-22: bé 7 tuổi (84 tháng) vẫn tính/lưu được', () => {
    const age = computeCurrentAgeMonths({ birthDate: d('2019-07-11') }, d('2026-07-11'));
    expect(age).toBe(84);
  });

  it('monthsBetween điều chỉnh theo ngày trong tháng', () => {
    expect(monthsBetween(d('2026-01-20'), d('2026-02-10'))).toBe(0); // chưa đủ tháng
    expect(monthsBetween(d('2026-01-10'), d('2026-02-20'))).toBe(1);
  });

  it('giai đoạn tuổi theo ngưỡng ⚙️', () => {
    const th = '0-6,6-12,12-36,36+';
    expect(ageStageOf(3, th)).toBe('0-6');
    expect(ageStageOf(8, th)).toBe('6-12');
    expect(ageStageOf(14, th)).toBe('12-36');
    expect(ageStageOf(40, th)).toBe('36+');
  });
});
