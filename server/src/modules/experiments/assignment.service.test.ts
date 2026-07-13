import { describe, it, expect } from 'vitest';
import {
  assignExperimentGroup,
  classifyForExperiment,
  deriveExclusionSignals,
  isOpenOrderStatus,
  type ExperimentAssignmentContext,
} from '../../engines/experiment';

/** Ngữ cảnh rỗng — không khách nào dính luật loại trừ. */
function emptyContext(): ExperimentAssignmentContext {
  return {
    vipCustomerIds: new Set(),
    atRiskCustomerIds: new Set(),
    callbackCustomerIds: new Set(),
    serviceContactCustomerIds: new Set(),
    openOrderDebtCustomerIds: new Set(),
  };
}

describe('deriveExclusionSignals — ánh xạ tập → tín hiệu (🔴 6 luật §12.3)', () => {
  it('ngữ cảnh rỗng => mọi tín hiệu false', () => {
    expect(deriveExclusionSignals('c1', emptyContext())).toEqual({
      isVip: false,
      agencyAtRisk: false,
      callbackRequested: false,
      hasComplaint: false,
      hasOpenOrderDeliveryDebt: false,
      isServiceContact: false,
    });
  });

  it('🔴 VIP từ vipCustomerIds', () => {
    const ctx = emptyContext();
    ctx.vipCustomerIds.add('c1');
    expect(deriveExclusionSignals('c1', ctx).isVip).toBe(true);
    expect(deriveExclusionSignals('other', ctx).isVip).toBe(false);
  });

  it('🔴 đại lý at_risk từ atRiskCustomerIds', () => {
    const ctx = emptyContext();
    ctx.atRiskCustomerIds.add('c1');
    expect(deriveExclusionSignals('c1', ctx).agencyAtRisk).toBe(true);
  });

  it('🔴 callback từ callbackCustomerIds', () => {
    const ctx = emptyContext();
    ctx.callbackCustomerIds.add('c1');
    expect(deriveExclusionSignals('c1', ctx).callbackRequested).toBe(true);
  });

  it('🔴 service_contact suy ra CẢ hasComplaint LẪN isServiceContact (một việc chăm sóc bắt buộc)', () => {
    const ctx = emptyContext();
    ctx.serviceContactCustomerIds.add('c1');
    const s = deriveExclusionSignals('c1', ctx);
    expect(s.hasComplaint).toBe(true);
    expect(s.isServiceContact).toBe(true);
  });

  it('🔴 đơn/giao/công nợ mở từ openOrderDebtCustomerIds', () => {
    const ctx = emptyContext();
    ctx.openOrderDebtCustomerIds.add('c1');
    expect(deriveExclusionSignals('c1', ctx).hasOpenOrderDeliveryDebt).toBe(true);
  });
});

describe('isOpenOrderStatus — best-effort trạng thái đơn KiotViet', () => {
  it('mã/chữ đang mở => true (phiếu tạm / đang giao)', () => {
    for (const s of ['1', '2', 'draft', 'Processing', 'PENDING', ' dang_giao ']) {
      expect(isOpenOrderStatus(s)).toBe(true);
    }
  });

  it('terminal/không rõ => false (hoàn thành/hủy/null/rỗng)', () => {
    for (const s of ['3', '4', 'completed', 'voided', 'xong', '', null, undefined]) {
      expect(isOpenOrderStatus(s)).toBe(false);
    }
  });
});

describe('classifyForExperiment — loại trừ hoặc gán nhóm ổn định (🔴 EXP-01)', () => {
  it('không dính luật nào => gán nhóm = assignExperimentGroup (khớp hash)', () => {
    const cls = classifyForExperiment('cust_1', 'exp_1', 0.1, emptyContext());
    expect(cls.excluded).toBe(false);
    if (!cls.excluded) {
      expect(cls.group).toBe(assignExperimentGroup('cust_1', 'exp_1', 0.1));
    }
  });

  it('🔴 gọi lặp lại KHÔNG đổi nhóm (ổn định)', () => {
    const a = classifyForExperiment('cust_stable', 'exp_x', 0.1, emptyContext());
    const b = classifyForExperiment('cust_stable', 'exp_x', 0.1, emptyContext());
    expect(a).toEqual(b);
  });

  it('holdoutRatio=1 => holdout; =0 => treatment (khi không loại trừ)', () => {
    const h = classifyForExperiment('c', 'e', 1, emptyContext());
    const t = classifyForExperiment('c', 'e', 0, emptyContext());
    expect(h.excluded === false && h.group).toBe('holdout');
    expect(t.excluded === false && t.group).toBe('treatment');
  });

  it('🔴 dính 1 luật (dù ratio=1) => LOẠI TRỪ, KHÔNG có nhóm', () => {
    const ctx = emptyContext();
    ctx.vipCustomerIds.add('vip');
    const cls = classifyForExperiment('vip', 'e', 1, ctx);
    expect(cls.excluded).toBe(true);
    if (cls.excluded) expect(cls.reasons).toContain('vip_customer');
  });

  it('🔴 dính nhiều luật => gộp mọi reason', () => {
    const ctx = emptyContext();
    ctx.vipCustomerIds.add('c');
    ctx.serviceContactCustomerIds.add('c');
    const cls = classifyForExperiment('c', 'e', 0.1, ctx);
    expect(cls.excluded).toBe(true);
    if (cls.excluded) {
      // service_contact suy ra cả complaint_open lẫn service_contact
      expect(cls.reasons.sort()).toEqual(
        ['complaint_open', 'service_contact', 'vip_customer'].sort(),
      );
    }
  });
});
