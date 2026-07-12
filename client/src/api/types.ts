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
  /** Xử lý "Việc hôm nay" + mutation follow-up (chu_shop/crm_officer/cskh). */
  processWork: boolean;
  viewOrganization: boolean;
  /** Mutation hồ sơ đại lý (pause/stockout/decline) — chu_shop + crm_officer. */
  manageOrganization: boolean;
  approveCycle: boolean;
  manageConfig: boolean;
  approveMerge: boolean;
  approveExport: boolean;
  handleAtRisk: boolean;
  viewSync: boolean;
  /** Dashboard đồng bộ KiotViet + hành động — chỉ chu_shop + tro_ly_du_lieu. */
  manageSync: boolean;
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

/** Bé để chọn khi "Xác nhận bé" (id + tên hiển thị theo masking). §11.1 */
export interface ConfirmableBaby {
  id: string;
  displayName: string;
}

export interface WorkCard {
  id: string;
  targetType: 'customer' | 'organization';
  reminderType: string;
  // §11.1: id đối tượng để hành động inline (Xác nhận bé / Tạm dừng cảnh báo).
  customerId: string | null;
  organizationId: string | null;
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
  // §11.1: danh sách bé của khách để nâng suggested -> confirmed.
  confirmableBabies: ConfirmableBaby[];
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

// ---- SCR-06 Ghi chú tư vấn ----
export type Temperature = 'nong' | 'am' | 'lanh';
export type ConsultationResult = 'da_chot' | 'chua_chot' | 'tu_choi';

/** Item trong danh sách tư vấn của khách (GET /api/customers/:id/consultations). */
export interface Consultation {
  id: string;
  babyId: string | null;
  issue: string;
  temperature: string | null;
  result: string | null;
  reasonNoBuy: string | null;
  advisedProductIds: string[];
  nextContactDate: string | null;
  note: string | null;
  version: number; // 🔴 FIX-3: dùng để gửi khóa lạc quan khi sửa
  editedCount: number;
  createdAt: string;
}

/** Chi tiết đầy đủ (GET/POST/PUT /api/consultations). */
export interface ConsultationDetail {
  id: string;
  customerId: string;
  babyId: string | null;
  issue: string;
  temperature: string | null;
  result: string | null;
  reasonNoBuy: string | null;
  advisedProductIds: string[];
  nextContactDate: string | null;
  note: string | null;
  version: number;
  editedCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Kết quả tạo lịch hẹn gọi lại kèm khi tạo/sửa tư vấn (CON-04/05). */
export interface AppointmentResult {
  created: boolean;
  reason: 'created' | 'duplicate_within_window' | 'no_date' | 'unchanged';
  followUpId?: string;
}

/** Mẫu nhanh tư vấn (config key `consultation.quick_templates`). */
export interface QuickTemplate {
  group: string;
  label: string;
  issue: string;
}

export interface ConfigItem {
  key: string;
  value: unknown;
  version: number;
}
export interface ConfigResponse {
  items: ConfigItem[];
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
  customersWithoutBaby: number;
  allocationQuality: {
    total: number;
    confirmedPct: number;
    suggestedUnconfirmedPct: number;
    customerLevelPct: number;
  };
  note: string;
}

export interface UserRef {
  id: string;
  fullName: string;
  role: RoleKey;
}

// ---- SCR-11 Gộp khách (dedup + preview) ----
export interface DedupParty {
  id: string;
  displayName: string;
  phone: string | null;
}
export interface DedupPair {
  a: DedupParty;
  b: DedupParty;
  score: number;
  reasons: string[];
}
export interface DedupResponse {
  threshold: number;
  note: string;
  masked: boolean;
  items: DedupPair[];
}

export interface MergeFieldComparison {
  field: string;
  master: string | null;
  merged: string | null;
  resolution: string;
}
export interface CanonicalPhone {
  phoneRaw: string;
  phoneNormalized: string;
  types: string[];
  sources: string[];
  isPrimary: boolean;
}
export interface ResolvedConsent {
  consentKey: string;
  subjectKey: string;
  status: 'granted' | 'revoked';
  at: string;
}
export interface MergePreview {
  masterId: string;
  mergedId: string;
  fields: MergeFieldComparison[];
  canonicalPhones: CanonicalPhone[];
  consent: ResolvedConsent[];
  kept: {
    babies: number;
    consultations: number;
    kvCodes: number;
    phones: number;
    consentEvents: number;
  };
  babyMergeNote: string;
  disclaimer: string;
}

// ---- SCR-12 Đồng bộ KiotViet ----
export interface SyncStatusItem {
  objectType: string;
  label: string;
  lastSyncAt: string | null;
  recordCount: number;
  errorCount: number;
}
export interface SyncStatusResponse {
  items: SyncStatusItem[];
}
export interface SyncDeadLetter {
  id: string;
  objectType: string;
  objectId: string | null;
  attempts: number;
  // 🔴 FIX-7 (SEC-10): lỗi ĐÃ scrub — KHÔNG chứa raw error/token/secret.
  errorCode: string | null;
  errorSummary: string | null;
  at: string;
}
export interface SyncQueueResponse {
  counts: Record<string, number>;
  retryable: number;
  deadLetterCount: number;
  webhookLatencyP95Ms: number | null;
  deadLetters: SyncDeadLetter[];
}
export interface SyncReconItem {
  periodLabel: string;
  objectType: string;
  kvCount: number;
  crmCount: number;
  mismatch: number | null;
  matched: boolean;
  detail: { note?: string } | null;
  at: string;
}
export interface SyncReconResponse {
  note: string;
  items: SyncReconItem[];
}
export interface SyncWebhookItem {
  objectType: string;
  status: string;
  registeredAt: string | null;
}
export interface SyncWebhooksResponse {
  registered: boolean;
  webhooks: SyncWebhookItem[];
}

// ---- SCR-16 Báo cáo ----
export type UpliftStatus = 'collecting' | 'insufficient' | 'reference' | 'confident';
export interface UpliftResult {
  status: UpliftStatus;
  hasConclusion: boolean;
  treatmentRate: number | null;
  holdoutRate: number | null;
  uplift: number | null;
  ci95: { low: number; high: number } | null;
  label: string;
}
export interface UpliftResponse {
  experiment?: { id: string; name: string };
  groups?: {
    treatment: { n: number; conversions: number };
    holdout: { n: number; conversions: number };
  };
  minSample?: { treatment: number; holdout: number };
  note?: string;
  result: UpliftResult | null;
}
export interface RepurchaseReport {
  note: string;
  totalConsumptionFollowUps: number;
  repurchaseVerified: number;
  attributedAfterReminder: number;
  naturalRepurchase: number;
  repurchaseVerifiedRatePct: number;
  attributedRatePct: number;
  byPeriod: { d30: number; d60: number; d90: number; over90: number };
}
export interface AgencyReasonItem {
  declineReason: string | null;
  count: number;
}
export interface AgencyReasonsReport {
  note: string;
  items: AgencyReasonItem[];
}
