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

/** Mục cho configuration_versions (key phẳng như Phụ lục B). `locked` = tham số khóa cứng. */
export interface ConfigCatalogueItem {
  key: string;
  value: number | string | null;
  locked?: boolean;
}

const c = DEFAULT_ENGINE_CONFIG;

export const CONFIG_CATALOGUE: ConfigCatalogueItem[] = [
  { key: 'reminder.buffer_days', value: c.reminder.bufferDays },
  { key: 'reminder.grouping_window_days', value: c.reminder.groupingWindowDays },
  { key: 'contact_cap.proactive_sales_per_month', value: c.contactCap.proactiveSalesPerMonth },
  { key: 'contact_cap.marketing_per_month', value: c.contactCap.marketingPerMonth },
  { key: 'contact_cap.service', value: null, locked: true }, // ∞ (khóa)
  { key: 'agency.due_multiplier', value: c.agency.dueMultiplier },
  { key: 'agency.slow_multiplier', value: c.agency.slowMultiplier },
  { key: 'agency.at_risk_multiplier', value: c.agency.atRiskMultiplier },
  { key: 'agency.min_sample_size', value: c.agency.minSampleSize },
  { key: 'agency.cadence_window_months', value: c.agency.cadenceWindowMonths },
  { key: 'agency.revenue_decline_threshold', value: c.agency.revenueDeclineThreshold },
  { key: 'agency.at_risk_assignee_role', value: c.agency.atRiskAssigneeRole },
  { key: 'sync.polling_interval_minutes', value: c.sync.pollingIntervalMinutes },
  { key: 'sync.initial_load_months', value: c.sync.initialLoadMonths },
  { key: 'sync.reconciliation_cutoff', value: c.sync.reconciliationCutoff },
  { key: 'dedup.merge_suggest_threshold', value: c.dedup.mergeSuggestThreshold },
  { key: 'experiment.holdout_ratio', value: c.experiment.holdoutRatio },
  { key: 'customer.dormant_after_days', value: c.customer.dormantAfterDays },
  { key: 'baby.age_stage_thresholds', value: c.baby.ageStageThresholds },
  { key: 'purchase.verification_window_days', value: c.purchase.verificationWindowDays },
  { key: 'intent.recheck_days', value: c.intent.recheckDays },
  { key: 'claim.claimed_ttl_minutes', value: c.claim.claimedTtlMinutes },
  { key: 'claim.in_progress_ttl_minutes', value: c.claim.inProgressTtlMinutes },
  { key: 'claim.heartbeat_seconds', value: c.claim.heartbeatSeconds },
  { key: 'claim.grace_minutes', value: c.claim.graceMinutes },
];
