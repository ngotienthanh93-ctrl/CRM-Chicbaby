import { describe, it, expect } from 'vitest';
import { classifyAllocation, evaluateBulkApply, validateSplitSegments } from './allocation';
import type { BulkLine } from './allocation';

describe('FIX-6 — chia SL không được làm rơi phần dư (§8.5, UAT-31)', () => {
  it('Σ SL các phần == SL dòng hàng => hợp lệ', () => {
    const r = validateSplitSegments(3, [
      { babyId: 'b1', assignedQuantity: 2 },
      { babyId: null, assignedQuantity: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(3);
  });

  it('🔴 Σ SL < SL dòng (rơi phần dư) => TỪ CHỐI, không lưu', () => {
    const r = validateSplitSegments(3, [{ babyId: 'b1', assignedQuantity: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Tổng số lượng chia');
  });

  it('🔴 Σ SL > SL dòng => TỪ CHỐI', () => {
    const r = validateSplitSegments(3, [
      { babyId: 'b1', assignedQuantity: 2 },
      { babyId: 'b2', assignedQuantity: 2 },
    ]);
    expect(r.ok).toBe(false);
  });

  it('SL âm/0 => TỪ CHỐI', () => {
    expect(validateSplitSegments(3, [{ babyId: 'b1', assignedQuantity: 0 }]).ok).toBe(false);
    expect(validateSplitSegments(3, []).ok).toBe(false);
  });

  it('chấp nhận sai số thập phân nhỏ (2 chữ số)', () => {
    const r = validateSplitSegments(1, [
      { babyId: 'b1', assignedQuantity: 0.33 },
      { babyId: 'b2', assignedQuantity: 0.33 },
      { babyId: null, assignedQuantity: 0.34 },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('allocation engine — phân bổ bé 3 cấp (§6)', () => {
  it('UAT-24: 1 bé + baby_specific + bán lẻ + không quà => auto_assigned, high, có babyId', () => {
    const r = classifyAllocation({
      babyCount: 1,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: true,
      isGiftOrProxy: false,
      singleBabyId: 'baby_1',
    });
    expect(r.assignmentStatus).toBe('auto_assigned');
    expect(r.confidence).toBe('high');
    expect(r.babyId).toBe('baby_1');
    expect(r.suggestedBabyId).toBeNull();
    expect(r.source).toBe('auto_single_baby');
  });

  it('UAT-25: 1 bé mua canxi mẹ (not_baby_applicable) => not_applicable, babyId NULL', () => {
    const r = classifyAllocation({
      babyCount: 1,
      babyAssignmentMode: 'not_baby_applicable',
      isRetailInvoice: true,
      isGiftOrProxy: false,
      singleBabyId: 'baby_1',
    });
    expect(r.assignmentStatus).toBe('not_applicable');
    expect(r.babyId).toBeNull();
    expect(r.suggestedBabyId).toBeNull();
  });

  it('UAT-26: 2 bé, baby_specific, khớp tuổi ĐÚNG 1 bé => suggested, babyId NULL, có suggestedBabyId', () => {
    const r = classifyAllocation({
      babyCount: 2,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: true,
      isGiftOrProxy: false,
      ageMatchBabyIds: ['baby_2'],
    });
    expect(r.assignmentStatus).toBe('suggested');
    expect(r.babyId).toBeNull(); // 🔴 KHÔNG set babyId
    expect(r.suggestedBabyId).toBe('baby_2');
    expect(r.confidence).toBe('medium');
  });

  it('UAT-26b: 2 bé nhưng khớp tuổi cả 2 (không đúng 1) => customer_level, KHÔNG đoán bé', () => {
    const r = classifyAllocation({
      babyCount: 2,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: true,
      isGiftOrProxy: false,
      ageMatchBabyIds: ['baby_1', 'baby_2'],
    });
    expect(r.assignmentStatus).toBe('customer_level');
    expect(r.babyId).toBeNull();
    expect(r.suggestedBabyId).toBeNull();
  });

  it('UAT-28: khách chưa có bé => customer_level, suggestedBabyId NULL', () => {
    const r = classifyAllocation({
      babyCount: 0,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: true,
      isGiftOrProxy: false,
    });
    expect(r.assignmentStatus).toBe('customer_level');
    expect(r.babyId).toBeNull();
    expect(r.suggestedBabyId).toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('UAT-33: khách SỈ có bé (giao dịch không bán lẻ) => KHÔNG auto, về customer_level (cho phép, không crash)', () => {
    const r = classifyAllocation({
      babyCount: 1,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: false, // giao dịch sỉ
      isGiftOrProxy: false,
      singleBabyId: 'baby_1',
    });
    expect(r.assignmentStatus).toBe('customer_level');
    expect(r.babyId).toBeNull();
  });

  it('quà/mua hộ 1 bé baby_specific => KHÔNG auto (an toàn), về customer_level', () => {
    const r = classifyAllocation({
      babyCount: 1,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: true,
      isGiftOrProxy: true,
      singleBabyId: 'baby_1',
    });
    expect(r.assignmentStatus).toBe('customer_level');
    expect(r.babyId).toBeNull();
  });

  it('SP đã từng confirmed cho bé => auto_assigned (nhánh HOẶC của BABY-08)', () => {
    const r = classifyAllocation({
      babyCount: 3,
      babyAssignmentMode: 'baby_specific',
      isRetailInvoice: true,
      isGiftOrProxy: false,
      previouslyConfirmedBabyId: 'baby_x',
    });
    expect(r.assignmentStatus).toBe('auto_assigned');
    expect(r.babyId).toBe('baby_x');
  });

  it('multi_audience => luôn customer_level', () => {
    const r = classifyAllocation({
      babyCount: 1,
      babyAssignmentMode: 'multi_audience',
      isRetailInvoice: true,
      isGiftOrProxy: false,
      singleBabyId: 'baby_1',
    });
    expect(r.assignmentStatus).toBe('customer_level');
    expect(r.babyId).toBeNull();
  });
});

describe('allocation — bulk apply NGHIÊM NGẶT (§6.5)', () => {
  const base: BulkLine = {
    lineId: 'l1',
    customerId: 'c1',
    invoiceId: 'i1',
    assignmentStatus: 'suggested',
    suggestedBabyId: 'b1',
    confidence: 'medium',
    babyAssignmentMode: 'baby_specific',
    isSplitAcrossBabies: false,
  };

  it('áp được khi cùng khách/hóa đơn, cùng gợi ý, suggested + medium', () => {
    const res = evaluateBulkApply([
      { ...base, lineId: 'l1' },
      { ...base, lineId: 'l2' },
    ]);
    expect(res.eligibleLineIds).toEqual(['l1', 'l2']);
    expect(res.rejected).toHaveLength(0);
  });

  it('🔴 TỪ CHỐI dòng multi_audience / customer_level / chia nhiều bé / gợi ý khác', () => {
    const res = evaluateBulkApply([
      base,
      { ...base, lineId: 'l2', babyAssignmentMode: 'multi_audience' },
      { ...base, lineId: 'l3', assignmentStatus: 'customer_level' },
      { ...base, lineId: 'l4', isSplitAcrossBabies: true },
      { ...base, lineId: 'l5', suggestedBabyId: 'b2' },
    ]);
    expect(res.eligibleLineIds).toEqual(['l1']);
    const rejectedIds = res.rejected.map((r) => r.lineId).sort();
    expect(rejectedIds).toEqual(['l2', 'l3', 'l4', 'l5']);
  });
});
