import { describe, it, expect } from 'vitest';
import {
  assignExperimentGroup,
  computeUplift,
  countDistinctRepurchaseCustomers,
  HARD_EXCLUSION_RULES,
  enforceHardExclusions,
  isExcludedFromExperiment,
  type ConversionRow,
  type ExperimentExclusionSignals,
} from './experiment';

describe('experiment — phân nhóm ổn định (🔴 EXP-01)', () => {
  it('cùng (customerId, experimentId) LUÔN cho cùng nhóm', () => {
    const g1 = assignExperimentGroup('cust_1', 'exp_1', 0.1);
    const g2 = assignExperimentGroup('cust_1', 'exp_1', 0.1);
    expect(g1).toBe(g2);
  });

  it('holdoutRatio=0 => tất cả treatment; =1 => tất cả holdout', () => {
    for (const c of ['a', 'b', 'c', 'd', 'e']) {
      expect(assignExperimentGroup(c, 'exp', 0)).toBe('treatment');
      expect(assignExperimentGroup(c, 'exp', 1)).toBe('holdout');
    }
  });

  it('~10% holdout trên nhiều khách (xấp xỉ tỉ lệ)', () => {
    let holdout = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      if (assignExperimentGroup(`cust_${i}`, 'exp_stable', 0.1) === 'holdout') holdout++;
    }
    const ratio = holdout / N;
    expect(ratio).toBeGreaterThan(0.06);
    expect(ratio).toBeLessThan(0.14);
  });
});

describe('uplift — chưa đủ mẫu KHÔNG kết luận (🔴 RPT-04)', () => {
  const cfg = { minSampleTreatment: 20, minSampleHoldout: 5 };

  it('🔴 holdout dưới ngưỡng => insufficient, hasConclusion=false, ci95=null', () => {
    const r = computeUplift({ n: 100, conversions: 40 }, { n: 3, conversions: 1 }, cfg);
    expect(r.status).toBe('insufficient');
    expect(r.hasConclusion).toBe(false);
    expect(r.uplift).toBeNull();
    expect(r.ci95).toBeNull();
    expect(r.label).toContain('KHÔNG kết luận');
  });

  it('nhóm rỗng => collecting (không kết luận)', () => {
    const r = computeUplift({ n: 0, conversions: 0 }, { n: 0, conversions: 0 }, cfg);
    expect(r.status).toBe('collecting');
    expect(r.hasConclusion).toBe(false);
  });

  it('đủ mẫu + khác biệt rõ => confident, CI loại 0', () => {
    const r = computeUplift({ n: 400, conversions: 200 }, { n: 200, conversions: 20 }, cfg);
    expect(r.hasConclusion).toBe(true);
    expect(r.uplift).toBeGreaterThan(0);
    expect(r.ci95).not.toBeNull();
    expect(r.status).toBe('confident');
    expect(r.ci95!.low).toBeGreaterThan(0);
  });

  it('đủ mẫu nhưng khác biệt nhỏ => reference (CI cắt 0, chưa kết luận chắc)', () => {
    const r = computeUplift({ n: 50, conversions: 26 }, { n: 50, conversions: 25 }, cfg);
    expect(r.hasConclusion).toBe(true);
    expect(r.status).toBe('reference');
    expect(r.ci95!.low).toBeLessThan(0);
    expect(r.ci95!.high).toBeGreaterThan(0);
  });
});

describe('uplift — đếm DISTINCT khách mua lại + cửa sổ thí nghiệm (🔴 FIX-6 / RPT-04)', () => {
  const win = { startAt: new Date('2026-06-01T00:00:00Z'), endAt: new Date('2026-07-01T00:00:00Z') };
  const row = (o: Partial<ConversionRow> & { customerId: string | null }): ConversionRow => ({
    customerId: o.customerId,
    // 'in' để phân biệt "không truyền" với "truyền null tường minh".
    matchedAt: 'matchedAt' in o ? (o.matchedAt ?? null) : new Date('2026-06-15T00:00:00Z'),
    attributionStatus: o.attributionStatus ?? 'attributed',
    verificationStatus: o.verificationStatus ?? 'verified',
  });

  it('🔴 khách có NHIỀU conversion chỉ đếm 1 lần (không phồng tử số)', () => {
    const rows = [
      row({ customerId: 'c1' }),
      row({ customerId: 'c1', matchedAt: new Date('2026-06-20T00:00:00Z') }),
      row({ customerId: 'c2' }),
    ];
    expect(countDistinctRepurchaseCustomers(rows, win, { attributedOnly: true })).toBe(2);
  });

  it('🔴 CHỈ Attributed (treatment): conversion không attributed bị loại', () => {
    const rows = [
      row({ customerId: 'c1', attributionStatus: 'attributed' }),
      row({ customerId: 'c2', attributionStatus: 'not_attributed' }),
    ];
    expect(countDistinctRepurchaseCustomers(rows, win, { attributedOnly: true })).toBe(1);
    // holdout (attributedOnly=false): cả hai verified đều tính
    expect(countDistinctRepurchaseCustomers(rows, win, { attributedOnly: false })).toBe(2);
  });

  it('🔴 chưa verified => không tính (cả hai nhóm)', () => {
    const rows = [row({ customerId: 'c1', verificationStatus: 'pending' })];
    expect(countDistinctRepurchaseCustomers(rows, win, { attributedOnly: false })).toBe(0);
  });

  it('🔴 ngoài cửa sổ thí nghiệm => loại; endAt là mốc LOẠI TRỪ (nửa mở)', () => {
    const rows = [
      row({ customerId: 'before', matchedAt: new Date('2026-05-31T23:59:59Z') }), // trước startAt
      row({ customerId: 'onEnd', matchedAt: new Date('2026-07-01T00:00:00Z') }), // == endAt (loại)
      row({ customerId: 'inWin', matchedAt: new Date('2026-06-15T00:00:00Z') }), // trong cửa sổ
      row({ customerId: 'onStart', matchedAt: new Date('2026-06-01T00:00:00Z') }), // == startAt (nhận)
    ];
    expect(countDistinctRepurchaseCustomers(rows, win, { attributedOnly: false })).toBe(2);
  });

  it('matchedAt null hoặc customerId null => bỏ qua', () => {
    const rows = [
      row({ customerId: null }),
      row({ customerId: 'c1', matchedAt: null }),
    ];
    expect(countDistinctRepurchaseCustomers(rows, win, { attributedOnly: false })).toBe(0);
  });
});

describe('experiment — 6 luật loại trừ KHÓA CỨNG (🔴 EXP §12.3)', () => {
  const EXPECTED_KEYS = [
    'vip_customer',
    'agency_at_risk',
    'callback_requested',
    'complaint_open',
    'order_delivery_debt_open',
    'service_contact',
  ];

  it('🔴 HARD_EXCLUSION_RULES có ĐỦ 6 luật, đúng key + có nhãn tiếng Việt', () => {
    expect(HARD_EXCLUSION_RULES).toHaveLength(6);
    expect(HARD_EXCLUSION_RULES.map((r) => r.key)).toEqual(EXPECTED_KEYS);
    for (const rule of HARD_EXCLUSION_RULES) {
      expect(rule.label.length).toBeGreaterThan(0);
    }
  });

  it('🔴 enforceHardExclusions: input rỗng/undefined => vẫn ĐỦ 6 luật', () => {
    expect(enforceHardExclusions().sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(enforceHardExclusions([]).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('🔴 enforceHardExclusions: input THIẾU (chỉ 1 luật) => server ép đủ 6, không cho bỏ', () => {
    const out = enforceHardExclusions(['vip_customer']);
    expect(out.sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('🔴 enforceHardExclusions: input THỪA (luật lạ) => bỏ luật lạ, giữ đủ 6', () => {
    const out = enforceHardExclusions(['vip_customer', 'random_rule', 'bo_qua_khac']);
    expect(out.sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(out).not.toContain('random_rule');
  });

  it('🔴 enforceHardExclusions: input TRÙNG lặp => không nhân bản (đúng 6, distinct)', () => {
    const out = enforceHardExclusions(['vip_customer', 'vip_customer', 'service_contact']);
    expect(out).toHaveLength(6);
    expect(new Set(out).size).toBe(6);
  });
});

describe('experiment — isExcludedFromExperiment (🔴 từng luật + tổ hợp)', () => {
  const NONE: ExperimentExclusionSignals = {
    isVip: false,
    agencyAtRisk: false,
    callbackRequested: false,
    hasComplaint: false,
    hasOpenOrderDeliveryDebt: false,
    isServiceContact: false,
  };

  it('không tín hiệu nào => KHÔNG loại trừ, reasons rỗng', () => {
    const r = isExcludedFromExperiment(NONE);
    expect(r.excluded).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('🔴 từng luật đơn lẻ => excluded=true, đúng 1 reason key tương ứng', () => {
    const cases: Array<[keyof ExperimentExclusionSignals, string]> = [
      ['isVip', 'vip_customer'],
      ['agencyAtRisk', 'agency_at_risk'],
      ['callbackRequested', 'callback_requested'],
      ['hasComplaint', 'complaint_open'],
      ['hasOpenOrderDeliveryDebt', 'order_delivery_debt_open'],
      ['isServiceContact', 'service_contact'],
    ];
    for (const [signal, key] of cases) {
      const r = isExcludedFromExperiment({ ...NONE, [signal]: true });
      expect(r.excluded).toBe(true);
      expect(r.reasons).toEqual([key]);
    }
  });

  it('🔴 tổ hợp nhiều tín hiệu => gộp mọi reason vi phạm', () => {
    const r = isExcludedFromExperiment({
      ...NONE,
      isVip: true,
      hasComplaint: true,
      isServiceContact: true,
    });
    expect(r.excluded).toBe(true);
    expect(r.reasons.sort()).toEqual(['complaint_open', 'service_contact', 'vip_customer'].sort());
  });

  it('🔴 mọi reason từ isExcludedFromExperiment đều là key hợp lệ trong HARD_EXCLUSION_RULES', () => {
    const allKeys = new Set(HARD_EXCLUSION_RULES.map((x) => x.key));
    const r = isExcludedFromExperiment({
      isVip: true,
      agencyAtRisk: true,
      callbackRequested: true,
      hasComplaint: true,
      hasOpenOrderDeliveryDebt: true,
      isServiceContact: true,
    });
    for (const reason of r.reasons) expect(allKeys.has(reason)).toBe(true);
    expect(r.reasons).toHaveLength(6);
  });
});
