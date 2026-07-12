// Kiểu dữ liệu KHỚP shape thật của backend (đã đọc modules + serialize.ts + curl xác nhận).
// KHÔNG bịa field — nếu backend không trả thì không khai.

export type RoleKey = 'chu_shop' | 'crm_officer' | 'cskh' | 'marketing' | 'tro_ly_du_lieu';

export interface Permissions {
  role: RoleKey;
  viewSensitive: boolean;
  viewBaby: boolean;
  viewConsultation: boolean;
  manageCustomer: boolean;
  manageBaby: boolean;
  viewOrganization: boolean;
  approveCycle: boolean;
  manageConfig: boolean;
  approveMerge: boolean;
  approveExport: boolean;
  handleAtRisk: boolean;
  viewSync: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: RoleKey;
}

export interface MeResponse {
  user: AuthUser;
  permissions: Permissions;
}

// ---- SCR-02 Việc hôm nay ----
export interface Baby {
  id: string;
  customerId: string;
  babyName: string | null;
  birthDate: string | null;
  datePrecision: string;
  ageMonths: number | null;
  ageStage: string | null;
  gender: string | null;
  allergies: string | null;
  condition: string | null;
  note: string | null;
  deleted: boolean;
  disclaimer: string;
}

export interface WorkBadge {
  level: 'at_risk' | 'agency' | 'confirmed' | 'suggested' | 'customer_level';
  label: string;
}

export interface WorkCard {
  id: string;
  targetType: 'customer' | 'organization';
  reminderType: string;
  targetName: string;
  phone: string | null;
  phoneOf: string | null;
  content: string;
  dueDate: string;
  overdue: boolean;
  status: string;
  priorityRank: number;
  badge: WorkBadge;
  claim: { state: string; by: string | null; since: string | null };
  babies: Baby[];
  lastPurchaseAt: string | null;
  canMentionBabyName: boolean;
}

export interface WorkTodayResponse {
  scope: 'mine' | 'team';
  updatedAt: string;
  kpi: { atRisk: number; overdue: number; needCall: number; doneToday: number };
  items: WorkCard[];
}

// ---- SCR-03 / SCR-04 Khách ----
export interface CustomerSummary {
  id: string;
  displayName: string;
  phone: string | null;
  roles: string[];
  roleLabel: string;
  kvLinks: number;
  babyCount: number;
  retentionStatus: string;
  lastPurchaseAt: string | null;
  masked: boolean;
}

export interface CustomerListResponse {
  items: CustomerSummary[];
  note?: string;
}

export interface CustomerPhone {
  id: string;
  type: string;
  isPrimary: boolean;
  source: string;
  phone: string | null;
}

export interface CustomerConsent {
  type: string;
  name: string;
  status: string;
}

export interface CustomerDetail {
  id: string;
  fullName: string;
  displayName: string;
  retentionStatus: string;
  preferredChannel: string | null;
  note: string | null;
  phones: CustomerPhone[];
  roles: string[];
  kvCodes: string[];
  tags: string[];
  babyCount: number;
  consents: CustomerConsent[];
  masked: boolean;
}

export interface Consultation {
  id: string;
  issue: string;
  temperature: string | null;
  result: string | null;
  nextContactDate: string | null;
  note: string | null;
  createdAt: string;
}

export interface PurchaseLine {
  product: string;
  quantity: number;
  price: number;
  allocationStatus: string;
}
export interface PurchaseInvoice {
  kvInvoiceId: string;
  code: string;
  purchaseDate: string;
  total: number;
  status: string;
  lines: PurchaseLine[];
}
export interface PurchasesResponse {
  readonly: boolean;
  badge: string;
  items: PurchaseInvoice[];
}

export interface ConsentEvent {
  type: string;
  name: string;
  status: string;
  at: string;
}

// ---- SCR-07 Phân bổ bé ----
export interface AllocationLine {
  allocationId: string;
  product: string;
  quantity: number;
  purchaseDate: string;
  assignmentStatus: string;
  confidence: string | null;
  suggestedBaby: { id: string; name: string | null } | null;
  confirmedBaby: { id: string; name: string | null } | null;
  skipCount: number;
}
export interface AllocationGroup {
  customerId: string | null;
  customerName: string;
  lines: AllocationLine[];
}
export interface AllocationsResponse {
  status: 'needs' | 'auto' | 'done';
  groups: AllocationGroup[];
}
export interface BulkPreviewResponse {
  eligibleLineIds: string[];
  rejected: { lineId: string; reason: string }[];
}

// ---- SCR-09 Đại lý ----
export interface OrgContact {
  id: string;
  name: string;
  role: string;
  isPrimary: boolean;
  phone: string | null;
}
export interface OrgSummary {
  id: string;
  orgName: string;
  status: string;
  medianCadenceDays: number | null;
  cadenceSampleSize: number | null;
  lastPurchaseAt: string | null;
  revenueTrend: string | null;
  paused: boolean;
  supplierStockoutAffected: boolean;
  badges: string[];
}
export interface OrgDetail {
  id: string;
  orgName: string;
  status: string;
  province: string | null;
  district: string | null;
  health: {
    medianCadenceDays: number | null;
    cadenceSampleSize: number | null;
    lastPurchaseAt: string | null;
    revenue90d: number | null;
    revenuePrev90d: number | null;
    revenueTrend: string | null;
  };
  contacts: OrgContact[];
  competition: { competitorOffers: string | null; complaints: string | null };
  exceptions: {
    paused: boolean;
    pausedUntil: string | null;
    supplierStockoutAffected: boolean;
    excludedPeriods: { from: string; to: string; reason: string }[];
  };
  declineReason: string | null;
  reasonStatus: string;
  badges: string[];
}

// ---- SCR-08 Sản phẩm / cấu hình chu kỳ ----
export interface Product {
  kvProductId: string;
  code: string;
  name: string;
  unit: string | null;
  price: number | null;
  babyAssignmentMode: 'baby_specific' | 'multi_audience' | 'not_baby_applicable';
  suggestedCycleDays: number | null;
  suggestionSampleSize: number | null;
  suggestionConfidence: string | null;
  approvedCycleDays: number | null;
  approvedAt: string | null;
  replacementGroup: { id: string; name: string } | null;
  autoRemindEnabled: boolean;
  needsApproval: boolean;
}

export interface DataQualityReport {
  productsNeedCycle: number;
  allocationsNeedReview: number;
  babiesMissingAge: number;
  customersMissingConsent: number;
}

export interface UserRef {
  id: string;
  fullName: string;
  role: RoleKey;
}
