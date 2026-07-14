import { describe, it, expect } from 'vitest';
import { WORK_ACTIONS, formatActivity } from './notifications.format';

describe('WORK_ACTIONS (allowlist)', () => {
  it('LOẠI hoàn toàn nhiễu đăng nhập/phiên (auth.* / twofa.* / user.session_revoke / user.*)', () => {
    const noisy = WORK_ACTIONS.filter(
      (a) =>
        a.startsWith('auth.') ||
        a.startsWith('twofa.') ||
        a.startsWith('user.') ||
        a === 'user.session_revoke',
    );
    expect(noisy).toEqual([]);
  });

  it('gồm 6 action làm việc mới bổ sung', () => {
    for (const a of [
      'followup.result',
      'followup.mark_purchased',
      'followup.close',
      'followup.snooze',
      'organization.pause',
      'organization.stockout',
    ]) {
      expect(WORK_ACTIONS).toContain(a);
    }
  });

  it('gồm các action làm việc đã audit sẵn (mẫu)', () => {
    for (const a of [
      'followup.add_evidence',
      'followup.delete_evidence',
      'customer.update_social_links',
      'customer.merge',
      'consultation.create',
      'baby.create',
      'export.request',
      'config.update',
      'sync.retry',
    ]) {
      expect(WORK_ACTIONS).toContain(a);
    }
  });

  it('không có phần tử trùng', () => {
    expect(new Set(WORK_ACTIONS).size).toBe(WORK_ACTIONS.length);
  });
});

describe('formatActivity', () => {
  it('followup.result -> theo outcome (ĐÃ MUA / SẼ MUA / không nghe máy)', () => {
    expect(formatActivity('followup.result', { outcome: 'already_purchased' }).verb).toBe(
      'ghi kết quả: khách ĐÃ MUA',
    );
    expect(formatActivity('followup.result', { outcome: 'intends_to_purchase' }).verb).toBe(
      'ghi kết quả: khách SẼ MUA',
    );
    expect(formatActivity('followup.result', { outcome: 'no_answer' }).verb).toBe(
      'ghi kết quả: không nghe máy',
    );
  });

  it('followup.result outcome thiếu/lạ -> "đã liên hệ"', () => {
    expect(formatActivity('followup.result', {}).verb).toBe('ghi kết quả: đã liên hệ');
    expect(formatActivity('followup.result', { outcome: 'xyz' }).verb).toBe('ghi kết quả: đã liên hệ');
  });

  it('followup.close -> ánh xạ lý do tiếng Việt; thiếu lý do -> chỉ "đóng việc"', () => {
    expect(formatActivity('followup.close', { closeReason: 'be_da_lon' }).verb).toBe(
      'đóng việc (lý do: bé đã lớn)',
    );
    expect(formatActivity('followup.close', { closeReason: 'mua_noi_khac' }).verb).toBe(
      'đóng việc (lý do: mua nơi khác)',
    );
    expect(formatActivity('followup.close', {}).verb).toBe('đóng việc');
  });

  it('các action làm việc phổ biến có cụm tiếng Việt rõ ràng', () => {
    expect(formatActivity('followup.mark_purchased', null).verb).toBe('đánh dấu đã mua lại');
    expect(formatActivity('followup.snooze', { days: 7 }).verb).toBe('dời nhắc');
    expect(formatActivity('followup.add_evidence', {}).verb).toBe('gắn ảnh bằng chứng');
    expect(formatActivity('followup.delete_evidence', {}).verb).toBe('XÓA ảnh bằng chứng');
    expect(formatActivity('followup.confirm_baby', {}).verb).toBe('xác nhận bé cho việc');
    expect(formatActivity('followup.reassign', {}).verb).toBe('chuyển việc cho người khác');
    expect(formatActivity('customer.update_social_links', {}).verb).toBe(
      'cập nhật kênh liên hệ (FB/Zalo)',
    );
    expect(formatActivity('customer.merge', {}).verb).toBe('gộp khách');
    expect(formatActivity('organization.pause', {}).verb).toBe('tạm dừng cảnh báo đại lý');
    expect(formatActivity('organization.stockout', {}).verb).toBe('báo shop hết hàng');
    expect(formatActivity('consultation.create', {}).verb).toBe('ghi tư vấn');
    expect(formatActivity('baby.create', {}).verb).toBe('tạo hồ sơ bé');
  });

  it('action ngoài allowlist -> fallback an toàn (không lộ mã kỹ thuật)', () => {
    const r = formatActivity('some.unknown_action', { secret: 'x' });
    expect(r.verb).toBe('thực hiện thao tác');
    expect(r.verb).not.toContain('some.unknown_action');
  });

  it('newValue không phải object (array/undefined/số) không làm vỡ', () => {
    expect(formatActivity('followup.close', undefined).verb).toBe('đóng việc');
    expect(formatActivity('followup.result', [1, 2, 3]).verb).toBe('ghi kết quả: đã liên hệ');
    expect(formatActivity('followup.result', 42).verb).toBe('ghi kết quả: đã liên hệ');
  });
});
