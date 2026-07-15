import { describe, it, expect } from 'vitest';
import type { Product } from '../api/types';
import { normalizeVi, productLabel, fuzzySearchProducts } from './fuzzy';

// Dựng Product tối thiểu — chỉ các trường mà fuzzy dùng (name, code, kvProductId).
function makeProduct(partial: Partial<Product> & { name: string; code: string }): Product {
  return {
    kvProductId: partial.kvProductId ?? partial.code,
    code: partial.code,
    name: partial.name,
    unit: null,
    price: null,
    babyAssignmentMode: 'not_baby_applicable',
    suggestedCycleDays: null,
    suggestionSampleSize: null,
    suggestionConfidence: null,
    approvedCycleDays: null,
    approvedAt: null,
    replacementGroup: null,
    autoRemindEnabled: false,
    needsApproval: false,
  };
}

const names = (ps: Product[]) => ps.map((p) => p.name);

describe('normalizeVi', () => {
  it('bỏ dấu tiếng Việt + lowercase', () => {
    expect(normalizeVi('Bỉm Bobby')).toBe('bim bobby');
    expect(normalizeVi('Sữa Chua')).toBe('sua chua');
  });
  it('map đ/Đ → d', () => {
    expect(normalizeVi('Đường')).toBe('duong');
    expect(normalizeVi('bột đậu')).toBe('bot dau');
  });
  it('gộp khoảng trắng thừa và trim', () => {
    expect(normalizeVi('  Sữa   tươi ')).toBe('sua tuoi');
  });
  it('null/undefined ⇒ rỗng', () => {
    expect(normalizeVi(null)).toBe('');
    expect(normalizeVi(undefined)).toBe('');
  });
});

describe('productLabel', () => {
  it('SP có tên ⇒ giữ nguyên tên', () => {
    expect(productLabel(makeProduct({ name: 'Sữa Chua', code: 'SP001' }))).toBe('Sữa Chua');
  });
  it('SP "(không tên)" ⇒ nhãn kèm mã', () => {
    expect(productLabel(makeProduct({ name: '(không tên)', code: 'SP999' }))).toBe(
      'Sản phẩm chưa đặt tên · SP999',
    );
  });
  it('SP name rỗng ⇒ nhãn kèm mã', () => {
    expect(productLabel(makeProduct({ name: '   ', code: 'SP000' }))).toBe(
      'Sản phẩm chưa đặt tên · SP000',
    );
  });
});

describe('fuzzySearchProducts', () => {
  const bimBobby = makeProduct({ name: 'Bỉm Bobby size XL', code: 'BOB-XL' });
  const suaChua = makeProduct({ name: 'Sữa Chua Vinamilk', code: 'SC-01' });
  const menViSinh = makeProduct({ name: 'Men vi sinh Biogaia', code: 'MEN-01' });
  const all = [bimBobby, suaChua, menViSinh];

  it('gõ thiếu dấu vẫn khớp — "bim" → Bỉm Bobby', () => {
    const res = fuzzySearchProducts(all, 'bim', 40);
    expect(names(res)).toContain('Bỉm Bobby size XL');
    expect(res[0]).toBe(bimBobby);
  });

  it('gõ thiếu dấu nhiều token — "sua chua" → Sữa Chua', () => {
    const res = fuzzySearchProducts(all, 'sua chua', 40);
    expect(res[0]).toBe(suaChua);
  });

  it('lỗi gõ (subsequence) — "bobi" → Bobby', () => {
    const res = fuzzySearchProducts(all, 'bobi', 40);
    expect(res[0]).toBe(bimBobby);
  });

  it('lỗi gõ giữa token (Levenshtein) — "boddy" → Bobby', () => {
    // "boddy" KHÔNG phải subsequence của "bim bobby..." (không có 'd') ⇒ buộc dùng edit-distance.
    const res = fuzzySearchProducts(all, 'boddy', 40);
    expect(res[0]).toBe(bimBobby);
  });

  it('xếp hạng: prefix chính xác đứng trên fuzzy', () => {
    const exact = makeProduct({ name: 'Bobby Diapers', code: 'BD-01' });
    const typo = makeProduct({ name: 'Boddy Wipes', code: 'BW-01' });
    const res = fuzzySearchProducts([typo, exact], 'bobby', 40);
    expect(res[0]).toBe(exact); // prefix (1000) > fuzzy (~198)
  });

  it('khớp theo mã sản phẩm (code)', () => {
    const res = fuzzySearchProducts(all, 'SC-01', 40);
    expect(res[0]).toBe(suaChua);
  });

  it('không khớp ⇒ trả rỗng', () => {
    const res = fuzzySearchProducts(all, 'zzzzzq', 40);
    expect(res).toEqual([]);
  });

  it('query rỗng ⇒ SP có tên đứng trước "(không tên)"', () => {
    const unnamed = makeProduct({ name: '(không tên)', code: 'NN-01' });
    const named = makeProduct({ name: 'Sữa Chua Vinamilk', code: 'SC-01' });
    const res = fuzzySearchProducts([unnamed, named], '', 40);
    expect(res[0]).toBe(named);
    expect(res[1]).toBe(unnamed);
  });

  it('tôn trọng limit', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeProduct({ name: `Sản phẩm ${i}`, code: `P${i}` }),
    );
    expect(fuzzySearchProducts(many, '', 40)).toHaveLength(40);
  });
});
