// Định dạng nhật ký hoạt động nhân viên (Trung tâm thông báo cho Chủ shop).
// THUẦN (không I/O) để unit-test: map mã action -> cụm động từ tiếng Việt.
// KHÔNG lộ oldValue/newValue thô — chỉ trả cụm mô tả an toàn.

/**
 * Allowlist các thao tác LÀM VIỆC của nhân viên được đưa vào feed thông báo.
 * TUYỆT ĐỐI KHÔNG gồm nhiễu đăng nhập/phiên: auth.* / twofa.* / user.session_revoke / user.*.
 */
export const WORK_ACTIONS: string[] = [
  // Việc cần làm (follow-up)
  'followup.result',
  'followup.mark_purchased',
  'followup.close',
  'followup.snooze',
  'followup.reassign',
  'followup.confirm_baby',
  'followup.add_evidence',
  'followup.delete_evidence',
  'followup.release_override',
  // Khách hàng
  'customer.update_social_links',
  'customer.merge',
  'customer.unmerge',
  'customer.unmerge_ticket',
  'customer.reveal_phone',
  // Đại lý
  'organization.pause',
  'organization.stockout',
  'organization.decline_reason',
  'organization.update_social_links',
  // Tư vấn
  'consultation.create',
  'consultation.update',
  // Hồ sơ bé
  'baby.create',
  'baby.merge',
  'baby.soft_delete',
  // Phân bổ bé
  'allocation.bulk_apply',
  // Sản phẩm
  'product.approve_cycle',
  // Xuất dữ liệu
  'export.request',
  'export.approve',
  'export.reject',
  'export.revoke',
  'export.download',
  // Thí nghiệm holdout
  'experiment.create',
  'experiment.update',
  'experiment.assign',
  'experiment.status_change',
  'experiment.run_generation',
  // Cấu hình hệ thống
  'config.update',
  'config.rollback',
  // Đồng bộ KiotViet
  'sync.retry',
  'sync.full_resync',
  'sync.webhook_secret_set',
  'sync.process',
  'sync.webhooks_register',
];

/** Lý do đóng việc -> tiếng Việt (khớp enum CloseReason). */
const CLOSE_REASON_VI: Record<string, string> = {
  khong_dung_nua: 'không dùng nữa',
  doi_sp: 'đổi sản phẩm',
  mua_noi_khac: 'mua nơi khác',
  khong_phan_hoi: 'không phản hồi',
  be_da_lon: 'bé đã lớn',
  khac: 'khác',
};

/** Kết quả liên hệ -> tiếng Việt (khớp outcome ở POST /followups/:id/result). */
const RESULT_OUTCOME_VI: Record<string, string> = {
  already_purchased: 'khách ĐÃ MUA',
  intends_to_purchase: 'khách SẼ MUA',
  no_answer: 'không nghe máy',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Map một dòng audit (action + newValue) sang cụm động từ tiếng Việt để hiển thị.
 * Fallback an toàn cho action lạ: "thực hiện thao tác" (không lộ mã kỹ thuật thô).
 */
export function formatActivity(action: string, newValue: unknown): { verb: string } {
  const nv = asRecord(newValue);
  switch (action) {
    case 'followup.result': {
      const outcome = typeof nv.outcome === 'string' ? nv.outcome : '';
      const label = RESULT_OUTCOME_VI[outcome] ?? 'đã liên hệ';
      return { verb: `ghi kết quả: ${label}` };
    }
    case 'followup.mark_purchased':
      return { verb: 'đánh dấu đã mua lại' };
    case 'followup.close': {
      const cr = typeof nv.closeReason === 'string' ? nv.closeReason : '';
      const reason = CLOSE_REASON_VI[cr];
      return { verb: reason ? `đóng việc (lý do: ${reason})` : 'đóng việc' };
    }
    case 'followup.snooze':
      return { verb: 'dời nhắc' };
    case 'followup.reassign':
      return { verb: 'chuyển việc cho người khác' };
    case 'followup.confirm_baby':
      return { verb: 'xác nhận bé cho việc' };
    case 'followup.add_evidence':
      return { verb: 'gắn ảnh bằng chứng' };
    case 'followup.delete_evidence':
      return { verb: 'XÓA ảnh bằng chứng' };
    case 'followup.release_override':
      return { verb: 'giải phóng việc của người khác' };
    case 'customer.update_social_links':
      return { verb: 'cập nhật kênh liên hệ (FB/Zalo)' };
    case 'customer.merge':
      return { verb: 'gộp khách' };
    case 'customer.unmerge':
    case 'customer.unmerge_ticket':
      return { verb: 'tách khách đã gộp' };
    case 'customer.reveal_phone':
      return { verb: 'xem số điện thoại khách' };
    case 'organization.pause':
      return { verb: 'tạm dừng cảnh báo đại lý' };
    case 'organization.stockout':
      return { verb: 'báo shop hết hàng' };
    case 'organization.decline_reason':
      return { verb: 'cập nhật trạng thái đại lý' };
    case 'organization.update_social_links':
      return { verb: 'cập nhật kênh liên hệ đại lý (FB/Zalo)' };
    case 'consultation.create':
      return { verb: 'ghi tư vấn' };
    case 'consultation.update':
      return { verb: 'sửa tư vấn' };
    case 'baby.create':
      return { verb: 'tạo hồ sơ bé' };
    case 'baby.merge':
      return { verb: 'gộp hồ sơ bé' };
    case 'baby.soft_delete':
      return { verb: 'xóa hồ sơ bé' };
    case 'allocation.bulk_apply':
      return { verb: 'phân bổ bé hàng loạt' };
    case 'product.approve_cycle':
      return { verb: 'duyệt chu kỳ sản phẩm' };
    case 'export.request':
      return { verb: 'yêu cầu xuất dữ liệu' };
    case 'export.approve':
      return { verb: 'duyệt xuất dữ liệu' };
    case 'export.reject':
      return { verb: 'từ chối xuất dữ liệu' };
    case 'export.revoke':
      return { verb: 'thu hồi xuất dữ liệu' };
    case 'export.download':
      return { verb: 'tải dữ liệu đã xuất' };
    case 'experiment.create':
      return { verb: 'tạo thí nghiệm' };
    case 'experiment.update':
      return { verb: 'sửa thí nghiệm' };
    case 'experiment.assign':
      return { verb: 'phân nhóm thí nghiệm' };
    case 'experiment.status_change':
      return { verb: 'đổi trạng thái thí nghiệm' };
    case 'experiment.run_generation':
      return { verb: 'chạy sinh việc thí nghiệm' };
    case 'config.update':
      return { verb: 'cập nhật cấu hình' };
    case 'config.rollback':
      return { verb: 'hoàn tác cấu hình' };
    case 'sync.retry':
      return { verb: 'thử lại đồng bộ' };
    case 'sync.full_resync':
      return { verb: 'đồng bộ lại toàn bộ' };
    case 'sync.webhook_secret_set':
      return { verb: 'đặt khóa webhook đồng bộ' };
    case 'sync.process':
      return { verb: 'xử lý sự kiện đồng bộ' };
    case 'sync.webhooks_register':
      return { verb: 'đăng ký webhook đồng bộ' };
    default:
      return { verb: 'thực hiện thao tác' };
  }
}
