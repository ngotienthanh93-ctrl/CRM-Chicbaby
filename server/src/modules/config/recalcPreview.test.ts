import { describe, it, expect } from 'vitest';
import { computeRecalcPreview } from './recalcPreview';
import type { OpenFollowUpSnapshot, RegeneratedReminder } from './recalcPreview';

const d = (s: string) => new Date(s + 'T00:00:00.000Z');

describe('computeRecalcPreview — đối chiếu việc đang mở với bản tái tạo (CFG-02/03, CYC-08)', () => {
  it('rỗng => tất cả 0, sampleSize 0', () => {
    const r = computeRecalcPreview([], []);
    expect(r).toMatchObject({ affected: 0, changed: 0, closed: 0, lost: 0, sampleSize: 0 });
  });

  it('mọi việc giữ nguyên ngày => changed 0, affected 0', () => {
    const open: OpenFollowUpSnapshot[] = [
      { key: 'a', dueDate: d('2026-02-01') },
      { key: 'b', dueDate: d('2026-02-05') },
    ];
    const regen: RegeneratedReminder[] = [
      { key: 'a', dueDate: d('2026-02-01') },
      { key: 'b', dueDate: d('2026-02-05') },
    ];
    const r = computeRecalcPreview(open, regen);
    expect(r).toMatchObject({ affected: 0, changed: 0, closed: 0, lost: 0, sampleSize: 2 });
  });

  it('đổi ngày đến hạn => changed', () => {
    const open: OpenFollowUpSnapshot[] = [
      { key: 'a', dueDate: d('2026-02-01') },
      { key: 'b', dueDate: d('2026-02-05') },
    ];
    const regen: RegeneratedReminder[] = [
      { key: 'a', dueDate: d('2026-02-03') }, // dịch 2 ngày
      { key: 'b', dueDate: d('2026-02-05') }, // giữ nguyên
    ];
    const r = computeRecalcPreview(open, regen);
    expect(r).toMatchObject({ affected: 1, changed: 1, closed: 0, lost: 0, sampleSize: 2 });
  });

  it('không có trong bản tái tạo => lost', () => {
    const open: OpenFollowUpSnapshot[] = [
      { key: 'a', dueDate: d('2026-02-01') },
      { key: 'b', dueDate: d('2026-02-05') },
    ];
    const regen: RegeneratedReminder[] = [{ key: 'a', dueDate: d('2026-02-01') }];
    const r = computeRecalcPreview(open, regen);
    expect(r).toMatchObject({ affected: 1, changed: 0, closed: 0, lost: 1, sampleSize: 2 });
  });

  it('shouldClose => closed (ưu tiên hơn thay đổi ngày)', () => {
    const open: OpenFollowUpSnapshot[] = [{ key: 'a', dueDate: d('2026-02-01') }];
    const regen: RegeneratedReminder[] = [
      { key: 'a', dueDate: d('2026-02-09'), shouldClose: true }, // dù ngày đổi vẫn tính ĐÓNG
    ];
    const r = computeRecalcPreview(open, regen);
    expect(r).toMatchObject({ affected: 1, changed: 0, closed: 1, lost: 0, sampleSize: 1 });
  });

  it('hỗn hợp changed + closed + lost', () => {
    const open: OpenFollowUpSnapshot[] = [
      { key: 'chg', dueDate: d('2026-02-01') },
      { key: 'cls', dueDate: d('2026-02-02') },
      { key: 'lst', dueDate: d('2026-02-03') },
      { key: 'same', dueDate: d('2026-02-04') },
    ];
    const regen: RegeneratedReminder[] = [
      { key: 'chg', dueDate: d('2026-02-06') },
      { key: 'cls', dueDate: d('2026-02-02'), shouldClose: true },
      { key: 'same', dueDate: d('2026-02-04') },
    ];
    const r = computeRecalcPreview(open, regen);
    expect(r).toMatchObject({ affected: 3, changed: 1, closed: 1, lost: 1, sampleSize: 4 });
  });

  it('boundary: lệch đúng 1 mili-giây vẫn tính là changed', () => {
    const open: OpenFollowUpSnapshot[] = [
      { key: 'a', dueDate: new Date('2026-02-01T00:00:00.000Z') },
    ];
    const regen: RegeneratedReminder[] = [
      { key: 'a', dueDate: new Date('2026-02-01T00:00:00.001Z') },
    ];
    const r = computeRecalcPreview(open, regen);
    expect(r.changed).toBe(1);
  });

  it('mặc định estimated=true; override estimated=false + note', () => {
    const def = computeRecalcPreview([], []);
    expect(def.estimated).toBe(true);
    const r = computeRecalcPreview([], [], {
      estimated: false,
      note: 'Tham số không tác động việc đã tạo.',
    });
    expect(r.estimated).toBe(false);
    expect(r.note).toBe('Tham số không tác động việc đã tạo.');
  });
});
