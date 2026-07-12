// Ma trận quyền theo vai (§7 RBAC). Nguồn sự thật cho masking + chặn endpoint.
// Mặc định theo spec; chủ shop có thể chỉnh sau (ngoài phạm vi đợt này).

export type RoleKeyStr = 'chu_shop' | 'crm_officer' | 'cskh' | 'marketing' | 'tro_ly_du_lieu';

export interface Permissions {
  role: RoleKeyStr;
  /** Xem SĐT/địa chỉ ĐẦY ĐỦ (không mask). */
  viewSensitive: boolean;
  /** Xem dữ liệu hồ sơ bé. false => endpoint bé trả 403 (SEC-06). */
  viewBaby: boolean;
  /** Xem ghi chú tư vấn (ẩn toàn bộ tab nếu false). */
  viewConsultation: boolean;
  /** Tạo/sửa khách. */
  manageCustomer: boolean;
  /** Tạo/sửa hồ sơ bé, tư vấn, phân bổ. */
  manageBaby: boolean;
  /** 🔴 Xử lý "Việc hôm nay": xem + thao tác follow-up (chu_shop/crm_officer/cskh).
   *  false cho marketing & tro_ly_du_lieu => /work/today + mutation follow-up trả 403 (FIX-1/FIX-2). */
  processWork: boolean;
  /** Xem hồ sơ đại lý. */
  viewOrganization: boolean;
  /** 🔴 SEC-FIX-2: MUTATION hồ sơ đại lý (ghi lý do giảm/ngừng nhập, pause, stockout, investigate).
   *  true cho chu_shop + crm_officer (CRM Officer ĐƯỢC quản đại lý — REM-W-11);
   *  false cho cskh (chỉ xem — §7), marketing, tro_ly_du_lieu. */
  manageOrganization: boolean;
  /** Duyệt chu kỳ SP (approvedCycleDays) — chỉ chủ shop (CYC). */
  approveCycle: boolean;
  /** Cấu hình hệ thống — chỉ chủ shop. */
  manageConfig: boolean;
  /** Duyệt gộp khách — chỉ chủ shop. */
  approveMerge: boolean;
  /** Duyệt export — chỉ chủ shop. */
  approveExport: boolean;
  /** Xử lý đại lý at_risk — chủ shop. */
  handleAtRisk: boolean;
  /** Theo dõi đồng bộ/đối soát. */
  viewSync: boolean;
}

const FULL_SENSITIVE_ROLES: RoleKeyStr[] = ['chu_shop', 'crm_officer', 'cskh'];

export function permissionsFor(role: RoleKeyStr): Permissions {
  const isOwner = role === 'chu_shop';
  const canSensitive = FULL_SENSITIVE_ROLES.includes(role);
  return {
    role,
    viewSensitive: canSensitive,
    viewBaby: canSensitive,
    viewConsultation: canSensitive,
    manageCustomer: canSensitive,
    manageBaby: canSensitive,
    // Vai xử lý việc = vai có quyền xem dữ liệu nhạy cảm (chu_shop/crm_officer/cskh).
    // Marketing & tro_ly_du_lieu KHÔNG xử lý việc (không nhận nội dung có tên bé).
    processWork: canSensitive,
    viewOrganization: canSensitive,
    // 🔴 SEC-FIX-2: chỉ chu_shop + crm_officer được SỬA đại lý; cskh view-only.
    manageOrganization: isOwner || role === 'crm_officer',
    approveCycle: isOwner,
    manageConfig: isOwner,
    approveMerge: isOwner,
    approveExport: isOwner,
    handleAtRisk: isOwner,
    viewSync: isOwner || role === 'crm_officer' || role === 'tro_ly_du_lieu',
  };
}

export function isRoleKey(v: string): v is RoleKeyStr {
  return (
    v === 'chu_shop' ||
    v === 'crm_officer' ||
    v === 'cskh' ||
    v === 'marketing' ||
    v === 'tro_ly_du_lieu'
  );
}
