import { describe, it, expect } from 'vitest';
import { planBabyGapFill, type BabyMergeSnapshot } from './babyMerge';

function baby(p: Partial<BabyMergeSnapshot>): BabyMergeSnapshot {
  return {
    babyName: null,
    birthDate: null,
    estimatedBirthMonth: null,
    ageMonthsAtRecording: null,
    ageRecordedAt: null,
    gender: null,
    allergies: null,
    condition: null,
    note: null,
    ...p,
  };
}

describe('babyMerge — planBabyGapFill (🔴 gộp bé bảo thủ, master thắng)', () => {
  it('điền field master TRỐNG bằng giá trị bé trùng', () => {
    const master = baby({ babyName: 'Bé A' });
    const dup = baby({ babyName: 'Bé A2', allergies: 'sữa bò', gender: 'female' });
    const patch = planBabyGapFill(master, dup);
    // babyName master đã có ⇒ KHÔNG ghi đè; allergies/gender trống ⇒ điền.
    expect(patch).toEqual({ allergies: 'sữa bò', gender: 'female' });
  });

  it('KHÔNG BAO GIỜ ghi đè field master đã có (kể cả khác giá trị)', () => {
    const master = baby({ allergies: 'không', condition: 'khỏe' });
    const dup = baby({ allergies: 'sữa bò', condition: 'ho' });
    expect(planBabyGapFill(master, dup)).toEqual({});
  });

  it('bé trùng cũng trống ⇒ không điền gì', () => {
    expect(planBabyGapFill(baby({}), baby({}))).toEqual({});
  });

  it('🔴 KHÔNG gap-fill định danh tuổi (birthDate/tuổi) — tránh trộn định danh gây datePrecision lệch', () => {
    const d = new Date('2025-01-15T00:00:00Z');
    const master = baby({ babyName: 'Bé' });
    const dup = baby({ birthDate: d, ageMonthsAtRecording: 6, estimatedBirthMonth: d, gender: 'male' });
    // Chỉ gender (field độc lập) được điền; mọi field định danh tuổi bị bỏ qua dù master trống.
    expect(planBabyGapFill(master, dup)).toEqual({ gender: 'male' });
  });
});
