import { describe, it, expect } from 'vitest';
import {
  buildReminderContent,
  buildReminderSourceKey,
  computeRemindDate,
  groupReminders,
  groupTier1,
  isContactAllowed,
  matchRepurchaseForVerify,
  mayMentionBabyName,
  planContactCap,
  shouldAutoClose,
  shouldCreateReminder,
} from './consumption';
import type { ReminderCall, ReminderLineInput, RepurchaseCandidate, RepurchaseSource } from './consumption';
import { DEFAULT_ENGINE_CONFIG } from '../lib/config';

const cfg = DEFAULT_ENGINE_CONFIG;
const d = (s: string) => new Date(s + 'T00:00:00.000Z');

describe('consumption — ngày nhắc (REM-R-01)', () => {
  it('start + cycle×qty − buffer', () => {
    const r = computeRemindDate({
      consumptionStartDate: d('2026-01-01'),
      cycleDays: 30,
      assignedQuantity: 2,
      bufferDays: 5,
    });
    // hết dự kiến = 01-01 + 60 ngày = 03-02; nhắc = − 5 ngày = 02-25
    expect(r.depletionDate.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(r.remindDate.toISOString().slice(0, 10)).toBe('2026-02-25');
  });
});

describe('consumption — điều kiện tạo nhắc (REM-R-03)', () => {
  it('UAT-34: SP chưa có approvedCycleDays => KHÔNG tạo nhắc', () => {
    expect(
      shouldCreateReminder({
        invoiceStatus: 'completed',
        autoRemindEnabled: true,
        approvedCycleDays: null,
        hasCareConsent: true,
      }),
    ).toBe(false);
  });

  it('đủ điều kiện => tạo nhắc', () => {
    expect(
      shouldCreateReminder({
        invoiceStatus: 'completed',
        autoRemindEnabled: true,
        approvedCycleDays: 30,
        hasCareConsent: true,
      }),
    ).toBe(true);
  });

  it('rút consent chăm sóc => KHÔNG tạo nhắc (SEC-02/REM-R-09)', () => {
    expect(
      shouldCreateReminder({
        invoiceStatus: 'completed',
        autoRemindEnabled: true,
        approvedCycleDays: 30,
        hasCareConsent: false,
      }),
    ).toBe(false);
  });
});

describe('consumption — nội dung TRUNG TÍNH theo cấp (BABY-12)', () => {
  it('confirmed => ĐƯỢC nhắc tên bé', () => {
    expect(mayMentionBabyName('confirmed', 'high')).toBe(true);
    const c = buildReminderContent({
      assignmentStatus: 'confirmed',
      confidence: 'high',
      productName: 'Sữa Aptamil số 2',
      babyName: 'Bin',
    });
    expect(c).toContain('Bin');
  });

  it('UAT-26: suggested => KHÔNG nhắc tên bé', () => {
    expect(mayMentionBabyName('suggested', 'medium')).toBe(false);
    const c = buildReminderContent({
      assignmentStatus: 'suggested',
      confidence: 'medium',
      productName: 'Sữa Aptamil số 2',
      babyName: 'Bin',
    });
    expect(c).not.toContain('Bin');
  });

  it('UAT-25: not_applicable (canxi mẹ) => KHÔNG nhắc tên bé', () => {
    const c = buildReminderContent({
      assignmentStatus: 'not_applicable',
      confidence: 'low',
      productName: 'Canxi Úc',
      babyName: 'Bin',
    });
    expect(c).not.toContain('Bin');
    expect(c).toContain('Canxi');
  });

  it('customer_level => KHÔNG nhắc tên bé', () => {
    const c = buildReminderContent({
      assignmentStatus: 'customer_level',
      confidence: 'low',
      productName: 'Men vi sinh',
      babyName: 'Bin',
    });
    expect(c).not.toContain('Bin');
  });
});

describe('consumption — gom nhắc 2 tầng (REM-R-04/05)', () => {
  it('UAT-36/37: hóa đơn 4 dòng / 3 nhóm đến hạn cùng khách => 1 VIỆC gọi', () => {
    const lines: ReminderLineInput[] = [
      // nhóm A (2 dòng cùng replacementGroup, cùng hóa đơn) => 1 nguồn
      lineOf('l1', 'inv1', 'cus1', 'baby1', 'grpA', '2026-02-10'),
      lineOf('l2', 'inv1', 'cus1', 'baby1', 'grpA', '2026-02-12'),
      // nhóm B
      lineOf('l3', 'inv1', 'cus1', 'baby1', 'grpB', '2026-02-11'),
      // nhóm C
      lineOf('l4', 'inv1', 'cus1', 'baby1', 'grpC', '2026-02-13'),
    ];
    const calls = groupReminders(lines, cfg);
    expect(calls).toHaveLength(1); // 🔴 chỉ 1 cuộc gọi
    expect(calls[0]!.sources).toHaveLength(3); // 3 nguồn (A gộp 2 dòng)
    expect(calls[0]!.contentLines).toHaveLength(3);
  });

  it('hai khách khác nhau => 2 việc riêng', () => {
    const lines: ReminderLineInput[] = [
      lineOf('l1', 'inv1', 'cusA', 'babyA', 'grpA', '2026-02-10'),
      lineOf('l2', 'inv2', 'cusB', 'babyB', 'grpA', '2026-02-10'),
    ];
    expect(groupReminders(lines, cfg)).toHaveLength(2);
  });

  it('cùng khách nhưng đến hạn CÁCH XA (> cửa sổ) => 2 việc', () => {
    const lines: ReminderLineInput[] = [
      lineOf('l1', 'inv1', 'cus1', 'baby1', 'grpA', '2026-02-10'),
      lineOf('l2', 'inv2', 'cus1', 'baby1', 'grpB', '2026-06-10'),
    ];
    expect(groupReminders(lines, cfg)).toHaveLength(2);
  });
});

describe('consumption — trần chống làm phiền (REM-R-06/07)', () => {
  it('UAT-38: đủ trần proactive nhưng là service_contact (khiếu nại) => VẪN gọi được', () => {
    expect(isContactAllowed('proactive_sales_contact', 2, cfg).allowed).toBe(false);
    expect(isContactAllowed('service_contact', 99, cfg).allowed).toBe(true); // 🔴 không bị trần
  });

  it('marketing_contact trần 1/tháng', () => {
    expect(isContactAllowed('marketing_contact', 0, cfg).allowed).toBe(true);
    expect(isContactAllowed('marketing_contact', 1, cfg).allowed).toBe(false);
  });
});

describe('consumption — tự đóng khi mua lại (REM-R-13/14)', () => {
  const fu = {
    targetCustomerId: 'cus1',
    babyKey: 'baby1',
    replacementGroupId: 'grpA',
    remindDate: d('2026-03-01'),
  };

  it('UAT-40: mua lại cùng nhóm, đúng bé, trước ngày nhắc => tự đóng', () => {
    expect(
      shouldAutoClose(fu, {
        customerId: 'cus1',
        babyKey: 'baby1',
        replacementGroupId: 'grpA',
        purchaseDate: d('2026-02-20'),
      }),
    ).toBe(true);
  });

  it('UAT-41: mua cùng nhóm nhưng cho BÉ KHÁC => KHÔNG tính', () => {
    expect(
      shouldAutoClose(fu, {
        customerId: 'cus1',
        babyKey: 'baby2',
        replacementGroupId: 'grpA',
        purchaseDate: d('2026-02-20'),
      }),
    ).toBe(false);
  });

  it('mua SAU ngày nhắc => không tự đóng (nhắc vẫn chạy)', () => {
    expect(
      shouldAutoClose(fu, {
        customerId: 'cus1',
        babyKey: 'baby1',
        replacementGroupId: 'grpA',
        purchaseDate: d('2026-03-10'),
      }),
    ).toBe(false);
  });

  it('cấp khách: mua lại cùng nhóm bất kể bé => tự đóng', () => {
    const fuCustomerLevel = { ...fu, babyKey: 'customer_level' };
    expect(
      shouldAutoClose(fuCustomerLevel, {
        customerId: 'cus1',
        babyKey: null,
        replacementGroupId: 'grpA',
        purchaseDate: d('2026-02-20'),
      }),
    ).toBe(true);
  });
});

describe('FIX-3 — khóa nguồn nhắc XÁC ĐỊNH (idempotent)', () => {
  it('cùng đầu vào => cùng sourceKey (ổn định)', () => {
    const k1 = buildReminderSourceKey('cus1', 'baby1', 'grpA', 'inv1');
    const k2 = buildReminderSourceKey('cus1', 'baby1', 'grpA', 'inv1');
    expect(k1).toBe(k2);
  });

  it('khác khách/bé/nhóm/hóa đơn => khác sourceKey', () => {
    const base = buildReminderSourceKey('cus1', 'baby1', 'grpA', 'inv1');
    expect(buildReminderSourceKey('cus2', 'baby1', 'grpA', 'inv1')).not.toBe(base);
    expect(buildReminderSourceKey('cus1', 'baby2', 'grpA', 'inv1')).not.toBe(base);
    expect(buildReminderSourceKey('cus1', 'baby1', 'grpB', 'inv1')).not.toBe(base);
    expect(buildReminderSourceKey('cus1', 'baby1', 'grpA', 'inv2')).not.toBe(base);
  });

  it('groupTier1 gắn sourceKey cho mỗi nguồn (gom cùng nguồn ổn định)', () => {
    const lines: ReminderLineInput[] = [
      lineOf('l1', 'inv1', 'cus1', 'baby1', 'grpA', '2026-02-10'),
      lineOf('l2', 'inv1', 'cus1', 'baby1', 'grpA', '2026-02-12'),
    ];
    const sources = groupTier1(lines);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.sourceKey).toBe(buildReminderSourceKey('cus1', 'baby1', 'grpA', 'inv1'));
  });
});

describe('FIX-4 — áp trần chống làm phiền khi SINH việc (REM-R-06/07/08)', () => {
  const callAt = (customerId: string, remind: string): ReminderCall => ({
    customerId,
    remindDate: d(remind),
    sources: [],
    contentLines: ['nội dung'],
  });

  it('proactive: chỉ tạo tối đa (cap − đã liên hệ) việc mới, phần vượt trần được GOM (không mất)', () => {
    const calls = [callAt('c', '2026-02-01'), callAt('c', '2026-02-05'), callAt('c', '2026-02-10')];
    const plan = planContactCap(calls, 0, 'proactive_sales_contact', cfg); // cap = 2
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toMerge).toHaveLength(1);
    // không mất: tổng create + merge == số call vào
    expect(plan.toCreate.length + plan.toMerge.length).toBe(3);
  });

  it('đã đủ trần trong tháng => KHÔNG tạo việc mới, gom tất cả', () => {
    const calls = [callAt('c', '2026-02-01'), callAt('c', '2026-02-05')];
    const plan = planContactCap(calls, 2, 'proactive_sales_contact', cfg);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toMerge).toHaveLength(2);
  });

  it('🔴 service_contact KHÔNG bị trần => tạo tất cả', () => {
    const calls = [callAt('c', '2026-02-01'), callAt('c', '2026-02-05'), callAt('c', '2026-02-10')];
    const plan = planContactCap(calls, 99, 'service_contact', cfg);
    expect(plan.toCreate).toHaveLength(3);
    expect(plan.toMerge).toHaveLength(0);
  });

  it('ưu tiên tạo việc đến hạn SỚM hơn', () => {
    const calls = [callAt('c', '2026-02-20'), callAt('c', '2026-02-01')];
    const plan = planContactCap(calls, 1, 'proactive_sales_contact', cfg); // allowedNew = 1
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0]!.remindDate.toISOString().slice(0, 10)).toBe('2026-02-01');
  });
});

describe('FIX-5 — xác minh mua lại với hóa đơn KV (CONV-01)', () => {
  const sources: RepurchaseSource[] = [
    { customerId: 'cus1', babyKey: 'baby1', replacementGroupId: 'grpA' },
  ];
  const cand = (over: Partial<RepurchaseCandidate>): RepurchaseCandidate => ({
    customerId: 'cus1',
    babyKey: 'baby1',
    replacementGroupId: 'grpA',
    invoiceId: 'invNew',
    invoiceLineId: 'lineNew',
    purchaseDate: d('2026-07-08'),
    ...over,
  });

  it('khớp khách + nhóm + đúng bé => verified (trả invoiceLineId)', () => {
    const m = matchRepurchaseForVerify(sources, [cand({})]);
    expect(m).not.toBeNull();
    expect(m!.candidate.invoiceLineId).toBe('lineNew');
  });

  it('🔴 mua cùng nhóm nhưng BÉ KHÁC => KHÔNG khớp (REM-R-14)', () => {
    expect(matchRepurchaseForVerify(sources, [cand({ babyKey: 'baby2' })])).toBeNull();
  });

  it('khác nhóm thay thế => KHÔNG khớp', () => {
    expect(matchRepurchaseForVerify(sources, [cand({ replacementGroupId: 'grpB' })])).toBeNull();
  });

  it('khác khách => KHÔNG khớp', () => {
    expect(matchRepurchaseForVerify(sources, [cand({ customerId: 'cus2' })])).toBeNull();
  });

  it('nguồn CẤP KHÁCH: mua cùng nhóm bất kể bé => khớp', () => {
    const custLevel: RepurchaseSource[] = [
      { customerId: 'cus1', babyKey: 'customer_level', replacementGroupId: 'grpA' },
    ];
    const m = matchRepurchaseForVerify(custLevel, [cand({ babyKey: null })]);
    expect(m).not.toBeNull();
  });
});

function lineOf(
  lineId: string,
  invoiceId: string,
  customerId: string,
  babyKey: string,
  replacementGroupId: string | null,
  depletion: string,
): ReminderLineInput {
  return {
    lineId,
    invoiceId,
    customerId,
    babyKey,
    replacementGroupId,
    depletionDate: d(depletion),
    remindDate: new Date(d(depletion).getTime() - 5 * 86400000),
    assignmentStatus: 'confirmed',
    confidence: 'high',
    productName: `SP ${lineId}`,
    babyName: 'Bin',
  };
}
