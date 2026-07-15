import { describe, it, expect } from 'vitest';
import { parseSnapshotRoles } from './merge.router';

// 🔴 ISSUE-1: unmerge khôi phục vai từ snapshot MergeHistory.mergedRoles (Json). Hàm parse phải lọc AN TOÀN
// dữ liệu rác/JSON lạ và chỉ trả về vai hợp lệ theo enum CustomerRoleType.
describe('parseSnapshotRoles — đọc snapshot vai an toàn (ISSUE-1)', () => {
  it('mảng vai hợp lệ => giữ nguyên (gồm wholesale_contact)', () => {
    expect(parseSnapshotRoles(['retail_customer', 'wholesale_contact'])).toEqual([
      'retail_customer',
      'wholesale_contact',
    ]);
  });

  it('lịch sử gộp CŨ (null) => [] (fallback mitigation ở route xử lý riêng)', () => {
    expect(parseSnapshotRoles(null)).toEqual([]);
  });

  it('mảng rỗng (khách bị gộp không có vai) => []', () => {
    expect(parseSnapshotRoles([])).toEqual([]);
  });

  it('lọc phần tử rác: chuỗi lạ / số / object / null trong mảng bị bỏ', () => {
    expect(
      parseSnapshotRoles(['wholesale_contact', 'khong_hop_le', 42, null, { role: 'x' }] as never),
    ).toEqual(['wholesale_contact']);
  });

  it('giá trị JSON không phải mảng (object/chuỗi/số) => []', () => {
    expect(parseSnapshotRoles({ role: 'wholesale_contact' } as never)).toEqual([]);
    expect(parseSnapshotRoles('wholesale_contact')).toEqual([]);
    expect(parseSnapshotRoles(7)).toEqual([]);
  });
});
