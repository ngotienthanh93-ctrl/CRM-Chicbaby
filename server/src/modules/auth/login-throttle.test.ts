import { describe, it, expect, beforeEach } from 'vitest';
import {
  LoginThrottle,
  DEFAULT_THROTTLE,
  throttleKey,
  computeFailure,
  computeLock,
  type Entry,
} from './login-throttle';

const T0 = 1_000_000; // mốc thời gian giả (ms)
const MIN = 60 * 1000;

describe('SEC-FIX-4 — throttleKey', () => {
  it('gộp theo (username + ip), chuẩn hóa lowercase', () => {
    expect(throttleKey('Admin', '1.2.3.4')).toBe('admin::1.2.3.4');
    expect(throttleKey('admin', '1.2.3.4')).toBe(throttleKey('ADMIN', '1.2.3.4'));
  });
  it('IP khác nhau => khóa khác nhau', () => {
    expect(throttleKey('admin', '1.1.1.1')).not.toBe(throttleKey('admin', '2.2.2.2'));
  });
});

describe('SEC-FIX-4 — ngưỡng khóa (AUTH-03)', () => {
  let t: LoginThrottle;
  const KEY = 'user::ip';
  beforeEach(() => {
    t = new LoginThrottle(DEFAULT_THROTTLE);
  });

  it('4 lần sai chưa khóa; lần thứ 5 => khóa mềm 15 phút', () => {
    for (let i = 0; i < 4; i++) {
      const s = t.recordFailure(KEY, T0);
      expect(s.locked).toBe(false);
    }
    expect(t.isLocked(KEY, T0).locked).toBe(false);
    const fifth = t.recordFailure(KEY, T0);
    expect(fifth.fails).toBe(5);
    expect(fifth.locked).toBe(true);
    expect(t.isLocked(KEY, T0).locked).toBe(true);
    // xấp xỉ 15 phút
    expect(t.isLocked(KEY, T0).retryAfterMs).toBe(15 * MIN);
  });

  it('khóa mềm HẾT sau 15 phút => mở lại', () => {
    for (let i = 0; i < 5; i++) t.recordFailure(KEY, T0);
    expect(t.isLocked(KEY, T0 + 14 * MIN).locked).toBe(true);
    expect(t.isLocked(KEY, T0 + 15 * MIN + 1).locked).toBe(false);
  });

  it('🔴 đạt 10 lần sai => khóa cứng 24 giờ', () => {
    let last;
    for (let i = 0; i < 10; i++) last = t.recordFailure(KEY, T0);
    expect(last!.fails).toBe(10);
    expect(last!.locked).toBe(true);
    // vẫn khóa sau 15 phút (khác khóa mềm) và sau 23h
    expect(t.isLocked(KEY, T0 + 16 * MIN).locked).toBe(true);
    expect(t.isLocked(KEY, T0 + 23 * 60 * MIN).locked).toBe(true);
    expect(t.isLocked(KEY, T0 + 24 * 60 * MIN + 1).locked).toBe(false);
  });
});

describe('SEC-FIX-4 — khóa theo (username+IP), KHÔNG toàn cục (AUTH-04)', () => {
  let t: LoginThrottle;
  beforeEach(() => {
    t = new LoginThrottle(DEFAULT_THROTTLE);
  });

  it('sai nhiều ở (userA, ip1) KHÔNG khóa (userA, ip2) hay (userB, ip1)', () => {
    const a1 = throttleKey('userA', 'ip1');
    const a2 = throttleKey('userA', 'ip2');
    const b1 = throttleKey('userB', 'ip1');
    for (let i = 0; i < 6; i++) t.recordFailure(a1, T0);
    expect(t.isLocked(a1, T0).locked).toBe(true);
    expect(t.isLocked(a2, T0).locked).toBe(false);
    expect(t.isLocked(b1, T0).locked).toBe(false);
  });
});

describe('SEC-FIX-4 — recordSuccess reset bộ đếm', () => {
  it('đăng nhập đúng xóa lịch sử sai trước đó', () => {
    const t = new LoginThrottle(DEFAULT_THROTTLE);
    const KEY = 'user::ip';
    for (let i = 0; i < 4; i++) t.recordFailure(KEY, T0);
    t.recordSuccess(KEY);
    // sau reset, 4 lần sai mới vẫn chưa đạt ngưỡng 5
    for (let i = 0; i < 4; i++) {
      const s = t.recordFailure(KEY, T0);
      expect(s.locked).toBe(false);
    }
  });
});

// 🔴 Logic THUẦN dùng chung với store DB (throttle-store.ts) — hợp đồng phải ổn định.
describe('SEC — computeFailure/computeLock (thuần, dùng chung DB)', () => {
  it('computeFailure KHÔNG mutate input, trả entry MỚI (store DB dựa vào tính chất này)', () => {
    const before: Entry = { fails: 4, firstFailAt: T0, lockedUntil: 0 };
    const snapshot = { ...before };
    const { entry, status } = computeFailure(before, T0, DEFAULT_THROTTLE);
    expect(before).toEqual(snapshot); // input nguyên vẹn
    expect(entry).not.toBe(before);
    expect(entry.fails).toBe(5);
    expect(status.locked).toBe(true); // lần thứ 5 => khóa mềm
  });

  it('entry null (chưa có bản ghi) => lần sai đầu tiên fails=1, chưa khóa', () => {
    const { entry, status } = computeFailure(null, T0, DEFAULT_THROTTLE);
    expect(entry.fails).toBe(1);
    expect(status.locked).toBe(false);
    expect(computeLock(null, T0).locked).toBe(false);
  });

  it('cửa sổ hết hạn + không còn khóa => reset bộ đếm về 1', () => {
    const stale: Entry = { fails: 9, firstFailAt: T0, lockedUntil: 0 };
    const later = T0 + DEFAULT_THROTTLE.windowMs + 1;
    const { entry } = computeFailure(stale, later, DEFAULT_THROTTLE);
    expect(entry.fails).toBe(1);
  });
});
