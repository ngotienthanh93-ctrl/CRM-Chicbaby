import { describe, it, expect } from 'vitest';
import { evaluateMergePair } from './dedup';
import type { MergeCandidateCustomer } from './dedup';
import { DEFAULT_ENGINE_CONFIG } from '../lib/config';

const threshold = DEFAULT_ENGINE_CONFIG.dedup.mergeSuggestThreshold; // 90

const mk = (o: Partial<MergeCandidateCustomer> & { id: string }): MergeCandidateCustomer => ({
  id: o.id,
  fullName: o.fullName ?? '',
  phones: o.phones ?? [],
  facebook: o.facebook ?? null,
  zalo: o.zalo ?? null,
  address: o.address ?? null,
});

describe('dedup — KHÔNG tự gộp, gợi ý có kiểm soát (nguyên tắc #7)', () => {
  it('UAT-17: 2 khách CHUNG SĐT (khác tên) => KHÔNG tự gộp, KHÔNG gợi ý (rủi ro gia đình)', () => {
    const a = mk({ id: 'a', fullName: 'Nguyễn Thị A', phones: ['0912345678'] });
    const b = mk({ id: 'b', fullName: 'Trần Văn B', phones: ['+84912345678'] });
    const r = evaluateMergePair(a, b, threshold);
    expect(r.autoMerge).toBe(false); // 🔴 luôn false
    expect(r.suggest).toBe(false); // chung số đơn (60) < 90
    expect(r.familyPhoneRisk).toBe(true);
    expect(r.signals.samePhone).toBe(true);
  });

  it('UAT-18: tên GIỐNG nhau nhưng khác mọi thứ khác => KHÔNG gợi ý gộp', () => {
    const a = mk({ id: 'a', fullName: 'Nguyễn Thị Hoa', phones: ['0900000001'] });
    const b = mk({ id: 'b', fullName: 'Nguyễn Thị Hoa', phones: ['0900000002'] });
    const r = evaluateMergePair(a, b, threshold);
    expect(r.suggest).toBe(false); // trùng tên đơn (35) < 90
    expect(r.autoMerge).toBe(false);
  });

  it('chung SĐT + trùng tên + trùng facebook => gợi ý (nhưng vẫn KHÔNG tự gộp)', () => {
    const a = mk({ id: 'a', fullName: 'Lê Thị C', phones: ['0912345678'], facebook: 'fb.com/lec' });
    const b = mk({ id: 'b', fullName: 'Lê Thị C', phones: ['0912345678'], facebook: 'fb.com/lec' });
    const r = evaluateMergePair(a, b, threshold);
    expect(r.suggest).toBe(true);
    expect(r.autoMerge).toBe(false); // 🔴 chỉ chủ shop duyệt
  });
});
