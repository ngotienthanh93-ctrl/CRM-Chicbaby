// Catalogue cấu hình ⚙️ (Phụ lục B / §9). MỌI ngưỡng cấu hình được — KHÔNG hard-code rải rác.
// `DEFAULT_ENGINE_CONFIG` là nguồn sự thật cho engine (pure, test được);
// `CONFIG_CATALOGUE` seed vào configuration_versions dùng CHÍNH các hằng số này => không lệch.

export interface EngineConfig {
  reminder: {
    bufferDays: number;
    groupingWindowDays: number;
    noAnswerDeferDays: number;
    noAnswerCloseThreshold: number; // >= n attempt mới cho đóng "không liên hệ được"
    noAnswerChangeChannelAt: number;
  };
  contactCap: {
    proactiveSalesPerMonth: number;
    marketingPerMonth: number;
    // service = ∞ (khóa) => không có trần
  };
  agency: {
    dueMultiplier: number;
    slowMultiplier: number;
    atRiskMultiplier: number;
    minSampleSize: number;
    cadenceWindowMonths: number;
    revenueDeclineThreshold: number;
    atRiskAssigneeRole: string;
  };
  dedup: {
    mergeSuggestThreshold: number;
  };
  experiment: {
    holdoutRatio: number;
    // Chu kỳ (phút) worker holdout tự động chạy (phân nhóm + sinh việc). 0 = TẮT cron (chạy tay ở SCR-15).
    cronIntervalMinutes: number;
  };
  export: {
    // Số GIỜ hiệu lực của một yêu cầu export SAU khi được duyệt (hết hạn ⇒ không tải được).
    approvalTtlHours: number;
    // Trần số dòng mỗi lần tải export (chống DoS/tải khối lượng lớn).
    maxRows: number;
  };
  twofa: {
    // Số ngày một thiết bị được "tin cậy" (bỏ qua nhập 2FA) trước khi phải nhập lại.
    trustedDeviceDays: number;
    // Số mã dự phòng phát khi bật 2FA (dùng một lần khi mất authenticator).
    backupCodeCount: number;
  };
  customer: {
    dormantAfterDays: number;
  };
  baby: {
    ageStageThresholds: string;
  };
  purchase: {
    verificationWindowDays: number;
  };
  intent: {
    recheckDays: number;
  };
  allocation: {
    skipSnoozeDays: number;
    skipWarnThreshold: number;
  };
  claim: {
    claimedTtlMinutes: number;
    inProgressTtlMinutes: number;
    heartbeatSeconds: number;
    graceMinutes: number;
  };
  sync: {
    pollingIntervalMinutes: number;
    initialLoadMonths: number;
    reconciliationCutoff: string;
    // Danh sách mã trạng thái đơn KiotViet coi là "đang mở" (CSV, không phân biệt hoa/thường) — cấu hình được
    // để khớp semantics THẬT của shop khi có API Spike (nguyên tắc #9, thay danh sách hardcode best-effort).
    openOrderStatuses: string;
    // Webhook KiotViet: trần số lần thử một sự kiện trước khi dead-letter; số sự kiện xử lý mỗi lượt worker;
    // chu kỳ (phút) worker tự chạy (0=tắt); tên header chứa chữ ký HMAC (chốt chính xác khi có API Spike).
    maxSyncAttempts: number;
    processorBatchSize: number;
    processorIntervalMinutes: number;
    webhookSignatureHeader: string;
    // 🔵 KV-01 — Public API (pull): base REST + endpoint lấy token OAuth2; số bản ghi mỗi trang (KiotViet trần 100);
    // công tắc bật poll tự động (0=tắt tới khi sẵn sàng); trần request/phút chủ động tránh 429.
    publicApiBaseUrl: string;
    tokenEndpoint: string;
    pageSize: number;
    pullEnabled: number;
    maxRequestsPerMinute: number;
  };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  reminder: {
    bufferDays: 5,
    groupingWindowDays: 5,
    noAnswerDeferDays: 2,
    noAnswerCloseThreshold: 4,
    noAnswerChangeChannelAt: 3,
  },
  contactCap: {
    proactiveSalesPerMonth: 2,
    marketingPerMonth: 1,
  },
  agency: {
    dueMultiplier: 1.0,
    slowMultiplier: 1.3,
    atRiskMultiplier: 2.0,
    minSampleSize: 3,
    cadenceWindowMonths: 12,
    revenueDeclineThreshold: 0.3,
    atRiskAssigneeRole: 'chu_shop',
  },
  dedup: { mergeSuggestThreshold: 90 },
  experiment: { holdoutRatio: 0.1, cronIntervalMinutes: 60 },
  export: { approvalTtlHours: 72, maxRows: 5000 },
  twofa: { trustedDeviceDays: 30, backupCodeCount: 10 },
  customer: { dormantAfterDays: 180 },
  baby: { ageStageThresholds: '0-6,6-12,12-36,36+' },
  purchase: { verificationWindowDays: 7 },
  intent: { recheckDays: 5 },
  allocation: { skipSnoozeDays: 7, skipWarnThreshold: 3 },
  claim: {
    claimedTtlMinutes: 5,
    inProgressTtlMinutes: 45,
    heartbeatSeconds: 60,
    graceMinutes: 10,
  },
  sync: {
    pollingIntervalMinutes: 20,
    initialLoadMonths: 12,
    reconciliationCutoff: '02:00',
    // Best-effort: 1=phiếu tạm, 2=đang giao + biến thể chữ. Đổi ở SCR-14 khi biết mã status thật.
    openOrderStatuses: '1,2,draft,processing,pending,delivering,phieu_tam,dang_giao,dang_giao_hang',
    maxSyncAttempts: 5,
    processorBatchSize: 50,
    processorIntervalMinutes: 1,
    webhookSignatureHeader: 'x-kiotviet-signature',
    // 🔵 KV-01 — Public API (pull). Base/token chốt lại khi smoke; pull TẮT mặc định (bật ở SCR-14 khi có creds).
    publicApiBaseUrl: 'https://public.kiotviet.vn',
    tokenEndpoint: 'https://id.kiotviet.vn/connect/token',
    pageSize: 100,
    pullEnabled: 0,
    maxRequestsPerMinute: 30,
  },
};

/** Nhóm tham số trên SCR-14 (§12.2: nhắc / đại lý / đồng bộ / chống trùng / thí nghiệm / bé / claim…). */
export type ConfigGroup =
  | 'reminder'
  | 'agency'
  | 'sync'
  | 'dedup'
  | 'experiment'
  | 'export'
  | 'twofa'
  | 'baby'
  | 'claim'
  | 'customer'
  | 'purchase'
  | 'intent';

/** Nhãn tiếng Việt của nhóm (hiển thị SCR-14). */
export const CONFIG_GROUP_LABELS: Record<ConfigGroup, string> = {
  reminder: 'Nhắc tái mua',
  agency: 'Đại lý',
  sync: 'Đồng bộ KiotViet',
  dedup: 'Chống trùng',
  experiment: 'Thí nghiệm holdout',
  export: 'Export dữ liệu',
  twofa: 'Xác thực 2 lớp',
  baby: 'Hồ sơ bé',
  claim: 'Khóa việc (claim)',
  customer: 'Khách hàng',
  purchase: 'Xác minh mua lại',
  intent: 'Ý định mua',
};

/** Mục cho configuration_versions (key phẳng như Phụ lục B). `locked` = tham số khóa cứng. */
export interface ConfigCatalogueItem {
  key: string;
  value: number | string | null;
  /** Nhóm hiển thị trên SCR-14. */
  group: ConfigGroup;
  locked?: boolean;
}

const c = DEFAULT_ENGINE_CONFIG;

export const CONFIG_CATALOGUE: ConfigCatalogueItem[] = [
  { key: 'reminder.buffer_days', value: c.reminder.bufferDays, group: 'reminder' },
  { key: 'reminder.grouping_window_days', value: c.reminder.groupingWindowDays, group: 'reminder' },
  {
    key: 'contact_cap.proactive_sales_per_month',
    value: c.contactCap.proactiveSalesPerMonth,
    group: 'reminder',
  },
  { key: 'contact_cap.marketing_per_month', value: c.contactCap.marketingPerMonth, group: 'reminder' },
  { key: 'contact_cap.service', value: null, group: 'reminder', locked: true }, // ∞ (khóa)
  { key: 'agency.due_multiplier', value: c.agency.dueMultiplier, group: 'agency' },
  { key: 'agency.slow_multiplier', value: c.agency.slowMultiplier, group: 'agency' },
  { key: 'agency.at_risk_multiplier', value: c.agency.atRiskMultiplier, group: 'agency' },
  { key: 'agency.min_sample_size', value: c.agency.minSampleSize, group: 'agency' },
  { key: 'agency.cadence_window_months', value: c.agency.cadenceWindowMonths, group: 'agency' },
  { key: 'agency.revenue_decline_threshold', value: c.agency.revenueDeclineThreshold, group: 'agency' },
  { key: 'agency.at_risk_assignee_role', value: c.agency.atRiskAssigneeRole, group: 'agency' },
  { key: 'sync.polling_interval_minutes', value: c.sync.pollingIntervalMinutes, group: 'sync' },
  { key: 'sync.initial_load_months', value: c.sync.initialLoadMonths, group: 'sync' },
  { key: 'sync.reconciliation_cutoff', value: c.sync.reconciliationCutoff, group: 'sync' },
  { key: 'sync.open_order_statuses', value: c.sync.openOrderStatuses, group: 'sync' },
  { key: 'sync.max_sync_attempts', value: c.sync.maxSyncAttempts, group: 'sync' },
  { key: 'sync.processor_batch_size', value: c.sync.processorBatchSize, group: 'sync' },
  { key: 'sync.processor_interval_minutes', value: c.sync.processorIntervalMinutes, group: 'sync' },
  { key: 'sync.webhook_signature_header', value: c.sync.webhookSignatureHeader, group: 'sync' },
  { key: 'sync.public_api_base_url', value: c.sync.publicApiBaseUrl, group: 'sync' },
  { key: 'sync.token_endpoint', value: c.sync.tokenEndpoint, group: 'sync' },
  { key: 'sync.page_size', value: c.sync.pageSize, group: 'sync' },
  { key: 'sync.pull_enabled', value: c.sync.pullEnabled, group: 'sync' },
  { key: 'sync.max_requests_per_minute', value: c.sync.maxRequestsPerMinute, group: 'sync' },
  { key: 'dedup.merge_suggest_threshold', value: c.dedup.mergeSuggestThreshold, group: 'dedup' },
  { key: 'experiment.holdout_ratio', value: c.experiment.holdoutRatio, group: 'experiment' },
  {
    key: 'experiment.cron_interval_minutes',
    value: c.experiment.cronIntervalMinutes,
    group: 'experiment',
  },
  { key: 'export.approval_ttl_hours', value: c.export.approvalTtlHours, group: 'export' },
  { key: 'export.max_rows', value: c.export.maxRows, group: 'export' },
  { key: 'twofa.trusted_device_days', value: c.twofa.trustedDeviceDays, group: 'twofa' },
  { key: 'twofa.backup_code_count', value: c.twofa.backupCodeCount, group: 'twofa' },
  { key: 'customer.dormant_after_days', value: c.customer.dormantAfterDays, group: 'customer' },
  { key: 'baby.age_stage_thresholds', value: c.baby.ageStageThresholds, group: 'baby' },
  { key: 'purchase.verification_window_days', value: c.purchase.verificationWindowDays, group: 'purchase' },
  { key: 'intent.recheck_days', value: c.intent.recheckDays, group: 'intent' },
  { key: 'claim.claimed_ttl_minutes', value: c.claim.claimedTtlMinutes, group: 'claim' },
  { key: 'claim.in_progress_ttl_minutes', value: c.claim.inProgressTtlMinutes, group: 'claim' },
  { key: 'claim.heartbeat_seconds', value: c.claim.heartbeatSeconds, group: 'claim' },
  { key: 'claim.grace_minutes', value: c.claim.graceMinutes, group: 'claim' },
];

const CATALOGUE_BY_KEY = new Map<string, ConfigCatalogueItem>(
  CONFIG_CATALOGUE.map((i) => [i.key, i]),
);

/** Tra mục catalogue theo key (thuần — test được). Key ngoài catalogue (vd JSON template) => undefined. */
export function getConfigItem(key: string): ConfigCatalogueItem | undefined {
  return CATALOGUE_BY_KEY.get(key);
}

/** 🔴 CFG-05/REM-R-07: key khóa cứng (vd trần service_contact = ∞) — KHÔNG cho sửa/rollback. */
export function isConfigLocked(key: string): boolean {
  return getConfigItem(key)?.locked === true;
}

/** Các key config là URL KiotViet — phải qua allowlist trước khi server-side fetch (chống SSRF/exfil). */
export const KIOTVIET_URL_CONFIG_KEYS = new Set<string>([
  'sync.public_api_base_url',
  'sync.token_endpoint',
]);

/**
 * 🔴 SEC (CWE-918 SSRF / CWE-200 exfil): URL KiotViet chỉ hợp lệ khi HTTPS + host là `kiotviet.vn` hoặc
 * `*.kiotviet.vn` + KHÔNG kèm userinfo (user:pass@). Chặn cấu hình (dù chỉ chủ shop) trỏ token/secret/Bearer
 * sang host lạ hay dịch vụ nội bộ. Dùng CẢ khi ghi config (chặn) LẪN khi đọc trong client (fallback DEFAULT).
 */
export function isValidKiotVietUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false; // chặn credentials-in-URL
  const host = u.hostname.toLowerCase();
  return host === 'kiotviet.vn' || host.endsWith('.kiotviet.vn');
}
