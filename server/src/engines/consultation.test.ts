import { describe, it, expect } from 'vitest';
import { appointmentClashesWithin } from './consultation';

describe('consultation — chống hẹn trùng ±3 ngày (🔴 CON-05)', () => {
  const d = (s: string) => new Date(s);

  it('không có lịch nào => không trùng', () => {
    expect(appointmentClashesWithin([], d('2026-07-20T00:00:00Z'), 3)).toBe(false);
  });

  it('có lịch cách 2 ngày (trong ±3) => trùng', () => {
    expect(
      appointmentClashesWithin([d('2026-07-18T02:00:00Z')], d('2026-07-20T02:00:00Z'), 3),
    ).toBe(true);
  });

  it('có lịch cách 5 ngày (ngoài ±3) => không trùng', () => {
    expect(
      appointmentClashesWithin([d('2026-07-14T02:00:00Z')], d('2026-07-20T02:00:00Z'), 3),
    ).toBe(false);
  });
});
