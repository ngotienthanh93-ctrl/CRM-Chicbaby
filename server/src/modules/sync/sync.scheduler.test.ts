import { describe, it, expect } from 'vitest';
import { resolveSyncCronPlan } from './sync.scheduler';

const MIN = 60 * 1000;

describe('sync.scheduler — resolveSyncCronPlan', () => {
  it('interval > 0 ⇒ bật, delay = interval phút', () => {
    expect(resolveSyncCronPlan(1)).toEqual({ enabled: true, delayMs: 1 * MIN });
    expect(resolveSyncCronPlan(20)).toEqual({ enabled: true, delayMs: 20 * MIN });
  });
  it('0 / âm / không hợp lệ ⇒ tắt (poll lại sau 10 phút)', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveSyncCronPlan(v)).toEqual({ enabled: false, delayMs: 10 * MIN });
    }
  });
});
