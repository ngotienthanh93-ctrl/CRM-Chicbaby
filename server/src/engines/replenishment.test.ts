import { describe, it, expect } from 'vitest';
import {
  computeMedianCadenceDays,
  evaluateOrganization,
  pickAgencyContact,
  requiresDeclineReason,
} from './replenishment';
import type { OrgContactLite } from './replenishment';
import { DEFAULT_ENGINE_CONFIG } from '../lib/config';

const cfg = DEFAULT_ENGINE_CONFIG;
const d = (s: string) => new Date(s + 'T00:00:00.000Z');

describe('replenishment — trung vị nhịp (REM-W-02)', () => {
  it('UAT-50: 5 lần nhập có 1 lô lớn (khoảng cách bất thường) => nhịp = TRUNG VỊ, không bị lệch', () => {
    // các mốc: khoảng cách 30, 30, 5 (mua gộp lớn), 30 => intervals [30,30,5,30], median = 30
    const dates = [
      d('2026-01-01'),
      d('2026-01-31'),
      d('2026-03-02'),
      d('2026-03-07'),
      d('2026-04-06'),
    ];
    const r = computeMedianCadenceDays(dates);
    expect(r.sampleSize).toBe(5);
    expect(r.medianCadenceDays).toBe(30); // trung vị 30, KHÔNG phải trung bình (~23.75)
  });
});

describe('replenishment — đánh giá đại lý (REM-W-03/07/12)', () => {
  it('UAT-51: đại lý mới chỉ 2 lần nhập => collecting, KHÔNG cảnh báo', () => {
    const r = evaluateOrganization(
      {
        medianCadenceDays: 30,
        sampleSize: 2,
        daysSinceLastPurchase: 90,
        revenue90d: 10,
        revenuePrev90d: 10,
        paused: false,
        supplierStockoutAffected: false,
        excludedNow: false,
      },
      cfg,
    );
    expect(r.status).toBe('collecting');
    expect(r.warn).toBe(false);
  });

  it('UAT-52/53: ≥2.0× nhịp => at_risk => giao CHỦ SHOP', () => {
    const r = evaluateOrganization(
      {
        medianCadenceDays: 30,
        sampleSize: 6,
        daysSinceLastPurchase: 70, // 70/30 = 2.33×
        revenue90d: 100,
        revenuePrev90d: 100,
        paused: false,
        supplierStockoutAffected: false,
        excludedNow: false,
      },
      cfg,
    );
    expect(r.status).toBe('at_risk');
    expect(r.warn).toBe(true);
    expect(r.assigneeRole).toBe('chu_shop');
  });

  it('≥1.3× => slow (CRM Officer)', () => {
    const r = evaluateOrganization(
      {
        medianCadenceDays: 30,
        sampleSize: 6,
        daysSinceLastPurchase: 45, // 1.5×
        revenue90d: 100,
        revenuePrev90d: 100,
        paused: false,
        supplierStockoutAffected: false,
        excludedNow: false,
      },
      cfg,
    );
    expect(r.status).toBe('slow');
    expect(r.assigneeRole).toBe('crm_officer');
  });

  it('teo dần: revenue90d < prev × (1−30%) => slow + shrinking', () => {
    const r = evaluateOrganization(
      {
        medianCadenceDays: 30,
        sampleSize: 6,
        daysSinceLastPurchase: 20, // chưa tới hạn
        revenue90d: 50,
        revenuePrev90d: 100, // giảm 50% > 30%
        paused: false,
        supplierStockoutAffected: false,
        excludedNow: false,
      },
      cfg,
    );
    expect(r.shrinking).toBe(true);
    expect(r.status).toBe('slow');
  });

  it('paused/stockout/excluded => KHÔNG cảnh báo nhập dù quá hạn (REM-W-10)', () => {
    const base = {
      medianCadenceDays: 30,
      sampleSize: 6,
      daysSinceLastPurchase: 90,
      revenue90d: 100,
      revenuePrev90d: 100,
      excludedNow: false,
    };
    expect(evaluateOrganization({ ...base, paused: true, supplierStockoutAffected: false }, cfg).warn).toBe(false);
    expect(evaluateOrganization({ ...base, paused: false, supplierStockoutAffected: true }, cfg).warn).toBe(false);
    expect(evaluateOrganization({ ...base, paused: false, supplierStockoutAffected: false, excludedNow: true }, cfg).warn).toBe(false);
  });
});

describe('replenishment — UAT-54 bắt declineReason', () => {
  it('chuyển sang lost (thủ công) => bắt lý do', () => {
    expect(requiresDeclineReason('lost', true)).toBe(true);
  });
  it('chuyển sang at_risk THỦ CÔNG => bắt lý do', () => {
    expect(requiresDeclineReason('at_risk', true)).toBe(true);
  });
  it('at_risk do ENGINE tự phát hiện => KHÔNG bắt lý do (reasonStatus=unknown)', () => {
    expect(requiresDeclineReason('at_risk', false)).toBe(false);
  });
});

describe('replenishment — UAT-58 người liên hệ nhắc nhập bù', () => {
  const contacts: OrgContactLite[] = [
    { role: 'chu_shop', name: 'Chủ A', phone: '0900000001', isPrimary: true },
    { role: 'nguoi_dat_hang', name: 'Chị Đặt Hàng', phone: '0900000002', isPrimary: false },
    { role: 'ke_toan', name: 'Kế toán', phone: '0900000003', isPrimary: false },
  ];

  it('ưu tiên nguoi_dat_hang (ORG-03)', () => {
    const c = pickAgencyContact(contacts);
    expect(c?.role).toBe('nguoi_dat_hang');
    expect(c?.phone).toBe('0900000002');
  });

  it('không có nguoi_dat_hang => fallback isPrimary', () => {
    const c = pickAgencyContact(contacts.filter((x) => x.role !== 'nguoi_dat_hang'));
    expect(c?.isPrimary).toBe(true);
  });
});
