import { describe, it, expect } from 'vitest';
import { canRelease, claimableWhereOr } from './claim';

describe('SEC-FIX-3 — canRelease (authz release follow-up)', () => {
  it('người ĐANG giữ việc => được release (không override)', () => {
    expect(canRelease('userA', 'userA', 'crm_officer')).toEqual({
      allowed: true,
      isOverride: false,
    });
  });

  it('việc không do ai giữ (claimedBy null) => vai thường vẫn release được', () => {
    expect(canRelease(null, 'userA', 'cskh')).toEqual({ allowed: true, isOverride: false });
  });

  it('🔴 vai thường giải phóng việc NGƯỜI KHÁC đang giữ => KHÔNG được (chống cướp claim)', () => {
    expect(canRelease('userA', 'userB', 'crm_officer')).toEqual({
      allowed: false,
      isOverride: false,
    });
    expect(canRelease('userA', 'userB', 'cskh')).toEqual({ allowed: false, isOverride: false });
  });

  it('🔴 chu_shop override việc người khác => được + đánh dấu isOverride (ghi audit, LOCK-10)', () => {
    expect(canRelease('userA', 'ownerX', 'chu_shop')).toEqual({
      allowed: true,
      isOverride: true,
    });
  });

  it('chu_shop tự giải phóng việc của chính mình => không phải override', () => {
    expect(canRelease('ownerX', 'ownerX', 'chu_shop')).toEqual({
      allowed: true,
      isOverride: false,
    });
  });
});

describe('SEC-FIX-3 — claimableWhereOr (điều kiện chiếm việc nguyên tử)', () => {
  const now = new Date('2026-07-12T00:00:00.000Z');
  const or = claimableWhereOr(now, 'userA');

  it('gồm đủ 4 nhánh phủ định của "người khác đang giữ hợp lệ"', () => {
    expect(or).toEqual([
      { claimState: { not: 'in_progress' } },
      { claimExpiresAt: null },
      { claimExpiresAt: { lte: now } },
      { claimedBy: 'userA' },
    ]);
  });

  it('cho phép làm mới claim của chính mình', () => {
    expect(or).toContainEqual({ claimedBy: 'userA' });
  });

  it('cho phép chiếm khi claim đã quá hạn', () => {
    expect(or).toContainEqual({ claimExpiresAt: { lte: now } });
  });
});
