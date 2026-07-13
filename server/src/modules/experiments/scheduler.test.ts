import { describe, it, expect } from 'vitest';
import { resolveCronPlan } from './scheduler';

const MS_PER_MINUTE = 60 * 1000;
const DISABLED_RECHECK_MS = 10 * MS_PER_MINUTE;

describe('scheduler — resolveCronPlan (🔴 §7.1 cron holdout)', () => {
  it('interval > 0 ⇒ BẬT, delay = interval phút', () => {
    expect(resolveCronPlan(60)).toEqual({ enabled: true, delayMs: 60 * MS_PER_MINUTE });
    expect(resolveCronPlan(5)).toEqual({ enabled: true, delayMs: 5 * MS_PER_MINUTE });
    expect(resolveCronPlan(1)).toEqual({ enabled: true, delayMs: 1 * MS_PER_MINUTE });
    expect(resolveCronPlan(1440)).toEqual({ enabled: true, delayMs: 1440 * MS_PER_MINUTE });
  });

  it('interval = 0 ⇒ TẮT nhưng vẫn poll lại để bật lại được (không cần restart)', () => {
    const plan = resolveCronPlan(0);
    expect(plan.enabled).toBe(false);
    expect(plan.delayMs).toBe(DISABLED_RECHECK_MS);
  });

  it('interval âm ⇒ TẮT (coi như vô hiệu)', () => {
    expect(resolveCronPlan(-1)).toEqual({ enabled: false, delayMs: DISABLED_RECHECK_MS });
  });

  it('giá trị không hợp lệ (NaN/Infinity) ⇒ TẮT, không ném lỗi', () => {
    expect(resolveCronPlan(Number.NaN)).toEqual({ enabled: false, delayMs: DISABLED_RECHECK_MS });
    expect(resolveCronPlan(Number.POSITIVE_INFINITY)).toEqual({
      enabled: false,
      delayMs: DISABLED_RECHECK_MS,
    });
  });
});
