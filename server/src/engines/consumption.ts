// Động cơ nhắc khách LẺ — consumption (§4). LOGIC THUẦN, test được không cần DB.
import type { EngineConfig } from '../lib/config';
import { addDays, diffDaysVn } from '../lib/datetime';
import { CUSTOMER_LEVEL_KEY } from './types';
import type { AssignmentStatusStr, ConfidenceStr, FrequencyCapScopeStr } from './types';

// ---------- 4.2 Công thức ngày nhắc (REM-R-01) ----------

export interface RemindDateInput {
  consumptionStartDate: Date;
  /** cycle = COALESCE(cycleDaysOverride, approvedCycleDays). */
  cycleDays: number;
  assignedQuantity: number;
  bufferDays: number;
}

export interface RemindDateResult {
  depletionDate: Date;
  remindDate: Date;
}

/** ngayDuKienHet = start + cycle×qty; ngayNhac = ngayDuKienHet − buffer_days. */
export function computeRemindDate(input: RemindDateInput): RemindDateResult {
  const totalDays = input.cycleDays * input.assignedQuantity;
  const depletionDate = addDays(input.consumptionStartDate, totalDays);
  const remindDate = addDays(depletionDate, -input.bufferDays);
  return { depletionDate, remindDate };
}

// ---------- 4.1/4.2 Điều kiện tạo nhắc (REM-R-03) ----------

export interface ShouldRemindInput {
  invoiceStatus: string; // 'completed' | ...
  autoRemindEnabled: boolean;
  approvedCycleDays: number | null | undefined;
  hasCareConsent: boolean; // consent 'cham_soc_nhac_tai_mua' còn hiệu lực
}

/** Đủ TẤT CẢ: completed AND autoRemind AND approvedCycleDays NOT NULL AND còn consent. */
export function shouldCreateReminder(input: ShouldRemindInput): boolean {
  return (
    input.invoiceStatus === 'completed' &&
    input.autoRemindEnabled === true &&
    input.approvedCycleDays != null &&
    input.hasCareConsent === true
  );
}

// ---------- 4.6 Nội dung TRUNG TÍNH theo cấp (BABY-12) ----------

/** Chỉ được nhắc TÊN BÉ khi confirmed, hoặc auto_assigned confidence cao. */
export function mayMentionBabyName(status: AssignmentStatusStr, confidence: ConfidenceStr): boolean {
  if (status === 'confirmed') return true;
  if (status === 'auto_assigned' && confidence === 'high') return true;
  return false;
}

export interface ContentInput {
  assignmentStatus: AssignmentStatusStr;
  confidence: ConfidenceStr;
  productName: string;
  babyName?: string | null;
}

/** Sinh câu nhắc trung tính theo cấp tin cậy. Gọi nhầm tên bé => mất niềm tin (BABY-12). */
export function buildReminderContent(input: ContentInput): string {
  const { assignmentStatus, confidence, productName, babyName } = input;
  if (mayMentionBabyName(assignmentStatus, confidence) && babyName) {
    return `${productName} của bé ${babyName} chắc sắp hết rồi ạ?`;
  }
  if (assignmentStatus === 'suggested') {
    return `${productName} lần trước chắc sắp hết rồi đúng không ạ?`;
  }
  if (assignmentStatus === 'customer_level') {
    return `Sản phẩm lần trước mình mua (${productName}) chắc sắp hết rồi ạ?`;
  }
  // not_applicable hoặc còn lại: nhắc theo SP, KHÔNG tên bé.
  return `${productName} lần trước chắc sắp hết rồi ạ?`;
}

// ---------- 4.3 Gom nhắc 2 TẦNG (REM-R-04/05) ----------

export interface ReminderLineInput {
  lineId: string;
  invoiceId: string;
  customerId: string;
  /** babyId hoặc 'customer_level'. */
  babyKey: string;
  babyName?: string | null;
  replacementGroupId: string | null;
  depletionDate: Date;
  remindDate: Date;
  assignmentStatus: AssignmentStatusStr;
  confidence: ConfidenceStr;
  productName: string;
}

export interface ReminderSourceGroup {
  /** 🔴 FIX-3: khóa nguồn XÁC ĐỊNH (idempotent) = customer|babyKey|replacementGroup|invoice. */
  sourceKey: string;
  customerId: string;
  babyKey: string;
  replacementGroupId: string | null;
  invoiceId: string;
  remindDate: Date; // sớm nhất trong nhóm (REM-R-02)
  depletionDate: Date;
  lineIds: string[];
  contentLine: string;
  assignmentStatus: AssignmentStatusStr;
  confidence: ConfidenceStr;
}

/** Khóa nguồn nhắc xác định (FIX-3) — ổn định cho cùng đầu vào. */
export function buildReminderSourceKey(
  customerId: string,
  babyKey: string,
  replacementGroupId: string | null,
  invoiceId: string,
): string {
  return `${customerId}||${babyKey}||${replacementGroupId ?? 'none'}||${invoiceId}`;
}

export interface ReminderCall {
  customerId: string;
  remindDate: Date; // sớm nhất trong cụm
  sources: ReminderSourceGroup[];
  contentLines: string[];
}

/**
 * Tầng 1: gom dòng hóa đơn thành MỘT nguồn nhắc theo
 * (customer, babyKey, replacementGroup, invoice) — lấy mốc hết SỚM NHẤT (REM-R-02).
 */
export function groupTier1(lines: ReminderLineInput[]): ReminderSourceGroup[] {
  const map = new Map<string, ReminderSourceGroup>();
  for (const l of lines) {
    const key = buildReminderSourceKey(l.customerId, l.babyKey, l.replacementGroupId, l.invoiceId);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        sourceKey: key,
        customerId: l.customerId,
        babyKey: l.babyKey,
        replacementGroupId: l.replacementGroupId,
        invoiceId: l.invoiceId,
        remindDate: l.remindDate,
        depletionDate: l.depletionDate,
        lineIds: [l.lineId],
        contentLine: buildReminderContent({
          assignmentStatus: l.assignmentStatus,
          confidence: l.confidence,
          productName: l.productName,
          babyName: l.babyName,
        }),
        assignmentStatus: l.assignmentStatus,
        confidence: l.confidence,
      });
    } else {
      existing.lineIds.push(l.lineId);
      if (l.remindDate < existing.remindDate) existing.remindDate = l.remindDate;
      if (l.depletionDate < existing.depletionDate) existing.depletionDate = l.depletionDate;
    }
  }
  return [...map.values()];
}

/**
 * Tầng 2: nhiều nguồn nhắc của CÙNG khách, đến hạn trong cùng cửa sổ ⚙️N ngày => MỘT việc gọi.
 * 🔴 KHÔNG tạo nhiều cuộc gọi riêng (REM-R-04/05).
 */
export function groupTier2(sources: ReminderSourceGroup[], windowDays: number): ReminderCall[] {
  const byCustomer = new Map<string, ReminderSourceGroup[]>();
  for (const s of sources) {
    const arr = byCustomer.get(s.customerId) ?? [];
    arr.push(s);
    byCustomer.set(s.customerId, arr);
  }

  const calls: ReminderCall[] = [];
  for (const [customerId, arr] of byCustomer) {
    arr.sort((a, b) => a.remindDate.getTime() - b.remindDate.getTime());
    let cluster: ReminderSourceGroup[] = [];
    let clusterStart: Date | null = null;
    const flush = () => {
      if (cluster.length === 0) return;
      calls.push({
        customerId,
        remindDate: cluster[0]!.remindDate,
        sources: cluster,
        contentLines: cluster.map((c) => c.contentLine),
      });
      cluster = [];
      clusterStart = null;
    };
    for (const s of arr) {
      if (clusterStart == null) {
        clusterStart = s.remindDate;
        cluster = [s];
      } else if (diffDaysVn(s.remindDate, clusterStart) <= windowDays) {
        cluster.push(s);
      } else {
        flush();
        clusterStart = s.remindDate;
        cluster = [s];
      }
    }
    flush();
  }
  return calls;
}

/** Gom đầy đủ 2 tầng. */
export function groupReminders(lines: ReminderLineInput[], config: EngineConfig): ReminderCall[] {
  return groupTier2(groupTier1(lines), config.reminder.groupingWindowDays);
}

// ---------- 4.4 Trần chống làm phiền (REM-R-06/07) ----------

export interface ContactCapResult {
  allowed: boolean;
  reason: string;
}

/** 🔴 service_contact KHÔNG BAO GIỜ bị trần (khiếu nại/hẹn gọi lại vẫn gọi được). */
export function isContactAllowed(
  scope: FrequencyCapScopeStr,
  contactsThisMonth: number,
  config: EngineConfig,
): ContactCapResult {
  if (scope === 'service_contact') {
    return { allowed: true, reason: 'service_contact không bị trần' };
  }
  const cap =
    scope === 'proactive_sales_contact'
      ? config.contactCap.proactiveSalesPerMonth
      : config.contactCap.marketingPerMonth;
  if (contactsThisMonth < cap) {
    return { allowed: true, reason: `Còn trong trần (${contactsThisMonth}/${cap})` };
  }
  return { allowed: false, reason: `Đã đủ trần (${contactsThisMonth}/${cap}) — gom vào lần sau` };
}

export interface CappedCallPlan {
  /** Sinh việc gọi MỚI (trong trần). */
  toCreate: ReminderCall[];
  /** Vượt trần => KHÔNG sinh cuộc gọi mới; gom nội dung vào việc gần nhất (REM-R-08). */
  toMerge: ReminderCall[];
}

/**
 * 🔴 REM-R-06/07/08 (FIX-4): áp trần chống làm phiền khi SINH việc.
 * service_contact KHÔNG bị trần. Proactive/marketing: chỉ tạo tối đa (cap − đã liên hệ trong tháng)
 * việc MỚI; phần vượt trần được gom (không mất). Việc đến hạn SỚM hơn được ưu tiên tạo trước.
 */
export function planContactCap(
  callsForCustomer: ReminderCall[],
  priorContactsThisMonth: number,
  scope: FrequencyCapScopeStr,
  config: EngineConfig,
): CappedCallPlan {
  const sorted = [...callsForCustomer].sort(
    (a, b) => a.remindDate.getTime() - b.remindDate.getTime(),
  );
  if (scope === 'service_contact') {
    return { toCreate: sorted, toMerge: [] };
  }
  const cap =
    scope === 'proactive_sales_contact'
      ? config.contactCap.proactiveSalesPerMonth
      : config.contactCap.marketingPerMonth;
  const allowedNew = Math.max(0, cap - priorContactsThisMonth);
  return {
    toCreate: sorted.slice(0, allowedNew),
    toMerge: sorted.slice(allowedNew),
  };
}

// ---------- 4.5 Tự động đóng khi mua lại (REM-R-13/14) ----------

export interface AutoCloseFollowUp {
  targetCustomerId: string;
  babyKey: string; // babyId hoặc 'customer_level'
  replacementGroupId: string | null;
  remindDate: Date;
}

export interface RepurchaseEvent {
  customerId: string;
  babyKey: string | null; // bé của giao dịch mua lại (nếu biết)
  replacementGroupId: string | null;
  purchaseDate: Date;
}

/**
 * 🔴 Tự đóng (da_mua_lai) khi khách mua lại SP cùng replacement_group cho ĐÚNG bé
 * (hoặc cùng khách nếu cấp khách) TRƯỚC ngày nhắc. Mua cho BÉ KHÁC => KHÔNG tính (REM-R-14).
 */
export function shouldAutoClose(fu: AutoCloseFollowUp, ev: RepurchaseEvent): boolean {
  if (ev.customerId !== fu.targetCustomerId) return false;
  // Trước hoặc đúng ngày nhắc.
  if (ev.purchaseDate.getTime() > fu.remindDate.getTime()) return false;
  // Cùng nhóm thay thế.
  if (!fu.replacementGroupId || fu.replacementGroupId !== ev.replacementGroupId) return false;
  // Kiểm tra bé.
  if (fu.babyKey !== CUSTOMER_LEVEL_KEY) {
    // Nhắc theo bé cụ thể => phải mua đúng bé đó.
    if (ev.babyKey !== fu.babyKey) return false;
  }
  return true;
}

// ---------- 4.7 Xác minh mua lại KHI GHI KẾT QUẢ (CONV-01) ----------

export interface RepurchaseSource {
  customerId: string;
  babyKey: string; // babyId hoặc 'customer_level'
  replacementGroupId: string | null;
}

export interface RepurchaseCandidate {
  customerId: string;
  /** Bé của dòng mua lại (qua allocation), null nếu chưa phân bổ/không biết. */
  babyKey: string | null;
  replacementGroupId: string | null;
  invoiceId: string;
  invoiceLineId: string;
  purchaseDate: Date;
}

export interface RepurchaseMatch {
  source: RepurchaseSource;
  candidate: RepurchaseCandidate;
}

/**
 * 🔴 CONV-01 (FIX-5): khớp hóa đơn mua lại để XÁC MINH sau khi liên hệ.
 * Khác `shouldAutoClose`: KHÔNG ràng buộc remindDate (cửa sổ ngày đã lọc ở tầng query).
 * Cùng khách + cùng replacement_group + đúng bé (nếu nhắc theo bé) hoặc bất kỳ (nếu cấp khách).
 * Mua cùng nhóm cho BÉ KHÁC => KHÔNG khớp (REM-R-14).
 */
export function matchRepurchaseForVerify(
  sources: RepurchaseSource[],
  candidates: RepurchaseCandidate[],
): RepurchaseMatch | null {
  for (const cand of candidates) {
    for (const s of sources) {
      if (s.customerId !== cand.customerId) continue;
      if (!s.replacementGroupId || s.replacementGroupId !== cand.replacementGroupId) continue;
      if (s.babyKey !== CUSTOMER_LEVEL_KEY) {
        // Nhắc theo bé cụ thể => dòng mua lại phải đúng bé đó.
        if (cand.babyKey !== s.babyKey) continue;
      }
      return { source: s, candidate: cand };
    }
  }
  return null;
}

// ---------- 4.7 Xác minh mua lại & attempt (CONV-01..04) ----------

export type ContactResultKind = 'already_purchased' | 'intends_to_purchase' | 'no_answer';

export interface NoAnswerDecision {
  action: 'defer' | 'suggest_change_channel' | 'allow_close';
  deferDays: number;
}

/** "Không nghe máy" = attempt, KHÔNG phải lý do đóng (CONV-04). */
export function decideNoAnswer(attemptCount: number, config: EngineConfig): NoAnswerDecision {
  if (attemptCount >= config.reminder.noAnswerCloseThreshold) {
    return { action: 'allow_close', deferDays: 0 };
  }
  if (attemptCount >= config.reminder.noAnswerChangeChannelAt) {
    return { action: 'suggest_change_channel', deferDays: config.reminder.noAnswerDeferDays };
  }
  return { action: 'defer', deferDays: config.reminder.noAnswerDeferDays };
}
