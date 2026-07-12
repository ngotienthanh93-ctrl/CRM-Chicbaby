import { describe, it, expect } from 'vitest';
import { evaluateMergePair, scoreDedupPair } from './dedup';
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

describe('scoreDedupPair — thang điểm §11.3 (CUS-14..16) cho dedup-candidates', () => {
  it('🔴 CUS-16: TÊN GIỐNG một mình => điểm 0, KHÔNG gợi ý', () => {
    const a = mk({ id: 'a', fullName: 'Nguyễn Thị Hoa', phones: ['0900000001'] });
    const b = mk({ id: 'b', fullName: 'Nguyễn Thị Hoa', phones: ['0900000002'] });
    const r = scoreDedupPair(a, b, threshold);
    expect(r.score).toBe(0);
    expect(r.suggest).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('🔴 UAT-17: chung SĐT nhưng KHÁC tên (gia đình) => KHÔNG gợi ý dù điểm cao', () => {
    const a = mk({ id: 'a', fullName: 'Nguyễn Thị Mẹ', phones: ['0988777666'] });
    const b = mk({ id: 'b', fullName: 'Nguyễn Văn Bố', phones: ['+84988777666'] });
    const r = scoreDedupPair(a, b, threshold);
    expect(r.score).toBe(100);
    expect(r.familyPhoneRisk).toBe(true);
    expect(r.suggest).toBe(false);
  });

  it('chung SĐT (chuẩn hóa) + CÙNG tên => điểm 100, gợi ý', () => {
    const a = mk({ id: 'a', fullName: 'Lê Thị Đúp', phones: ['0912.345.678'] });
    const b = mk({ id: 'b', fullName: 'Lê Thị Đúp', phones: ['+84912345678'] });
    const r = scoreDedupPair(a, b, threshold);
    expect(r.score).toBe(100);
    expect(r.suggest).toBe(true);
    expect(r.familyPhoneRisk).toBe(false);
  });

  it('trùng Facebook (khác số) + cùng tên => điểm 90, gợi ý', () => {
    const a = mk({ id: 'a', fullName: 'Trần Văn E', phones: ['0900000010'], facebook: 'fb/e' });
    const b = mk({ id: 'b', fullName: 'Trần Văn E', phones: ['0900000011'], facebook: 'fb/e' });
    const r = scoreDedupPair(a, b, threshold);
    expect(r.score).toBe(90);
    expect(r.suggest).toBe(true);
  });
});
