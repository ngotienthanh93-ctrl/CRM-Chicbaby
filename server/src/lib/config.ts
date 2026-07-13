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
  experiment: { holdoutRatio: 0.1 },
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
  },
};

/** Nhóm tham số trên SCR-14 (§12.2: nhắc / đại lý / đồng bộ / chống trùng / thí nghiệm / bé / claim…). */
export type ConfigGroup =
  | 'reminder'
  | 'agency'
  | 'sync'
  | 'dedup'
  | 'experiment'
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
  { key: 'dedup.merge_suggest_threshold', value: c.dedup.mergeSuggestThreshold, group: 'dedup' },
  { key: 'experiment.holdout_ratio', value: c.experiment.holdoutRatio, group: 'experiment' },
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
