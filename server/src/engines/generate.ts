// Orchestration: đọc dữ liệu DB, chạy engine THUẦN, sinh allocations/follow_ups + cập nhật chỉ số đại lý.
// Dùng bởi seed (nạp dữ liệu SCR-02) và có thể gọi lại khi resync. KHÔNG chứa business rule mới —
// mọi quyết định nằm ở engine thuần (allocation/consumption/replenishment).
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from '../lib/config';

/** Client trong transaction (dùng cho các helper ghi idempotent). */
type PrismaTx = Prisma.TransactionClient;
import { diffDaysVn, vnStartOfMonthUtc, vnToday } from '../lib/datetime';
import { subMonths } from './babyAge';
import {
  computeRemindDate,
  groupReminders,
  planContactCap,
  shouldCreateReminder,
  type ReminderCall,
  type ReminderLineInput,
  type ReminderSourceGroup,
} from './consumption';
import {
  computeMedianCadenceDays,
  evaluateOrganization,
  pickAgencyContact,
} from './replenishment';
import { CUSTOMER_LEVEL_KEY } from './types';

export interface GenerateOptions {
  now?: Date;
  config?: EngineConfig;
  /** Nhân viên nhận việc tiêu dùng (round-robin). */
  consumptionAssigneeIds: string[];
  /** Chủ shop nhận việc at_risk. */
  ownerId: string;
  /** CRM officer nhận việc đại lý slow/due. */
  agencyAssigneeIds: string[];
  /** Khách thuộc nhóm holdout (việc KHÔNG hiện SCR-02). */
  holdoutCustomerIds?: Set<string>;
}

// ---------- WORK-03 base priority theo loại việc ----------
const PRIORITY = {
  atRisk: 1,
  overdueOrCommitted: 3,
  slow: 4,
  consumptionDue: 5,
  agencyDue: 6,
  dataEnrichment: 7,
} as const;

/** Sinh follow_ups tiêu dùng (khách lẻ). Trả về số việc tạo. */
export async function generateConsumptionFollowUps(opts: GenerateOptions): Promise<number> {
  const now = opts.now ?? new Date();
  const config = opts.config ?? DEFAULT_ENGINE_CONFIG;
  const holdout = opts.holdoutCustomerIds ?? new Set<string>();

  // consent chăm sóc còn hiệu lực
  const careType = await prisma.consentType.findUnique({
    where: { key: 'cham_soc_nhac_tai_mua' },
  });
  const careSet = new Set<string>();
  if (careType) {
    const grants = await prisma.customerConsent.findMany({
      where: { consentTypeId: careType.id, status: 'granted' },
      select: { customerId: true },
    });
    grants.forEach((g) => careSet.add(g.customerId));
  }

  // khách có vai bán lẻ
  const retailRoles = await prisma.customerRole.findMany({
    where: { role: 'retail_customer' },
    select: { customerId: true },
  });
  const retailSet = new Set(retailRoles.map((r) => r.customerId));

  // map kvCustomerId -> crm customerId
  const identities = await prisma.customerExternalIdentity.findMany({
    where: { sourceSystem: 'kiotviet', unlinkedAt: null },
    select: { customerId: true, externalCustomerId: true },
  });
  const kvToCrm = new Map<string, string>();
  identities.forEach((i) => kvToCrm.set(i.externalCustomerId, i.customerId));

  const allocations = await prisma.invoiceItemBabyAllocation.findMany({
    include: {
      invoiceLine: { include: { invoice: true, product: { include: { crmMeta: true } } } },
      baby: true,
    },
  });

  const lineInputs: ReminderLineInput[] = [];
  const lineMeta = new Map<
    string,
    { kvInvoiceLineId: string; allocationId: string; babyId: string | null }
  >();

  for (const alloc of allocations) {
    const invoice = alloc.invoiceLine.invoice;
    const meta = alloc.invoiceLine.product.crmMeta;
    const customerId = alloc.babyId
      ? alloc.baby?.customerId
      : invoice.kvCustomerId
        ? kvToCrm.get(invoice.kvCustomerId)
        : undefined;
    if (!customerId) continue;
    if (!retailSet.has(customerId)) continue;

    const eligible = shouldCreateReminder({
      invoiceStatus: invoice.status,
      autoRemindEnabled: meta?.autoRemindEnabled ?? false,
      approvedCycleDays: meta?.approvedCycleDays ?? null,
      hasCareConsent: careSet.has(customerId),
    });
    if (!eligible || !meta) continue;

    const cycle = alloc.cycleDaysOverride ?? meta.approvedCycleDays!;
    const qty = Number(alloc.assignedQuantity);
    const { depletionDate, remindDate } = computeRemindDate({
      consumptionStartDate: alloc.consumptionStartDate,
      cycleDays: cycle,
      assignedQuantity: qty,
      bufferDays: config.reminder.bufferDays,
    });

    const canNameBaby =
      (alloc.assignmentStatus === 'auto_assigned' || alloc.assignmentStatus === 'confirmed') &&
      !!alloc.babyId;
    const babyKey = canNameBaby ? alloc.babyId! : CUSTOMER_LEVEL_KEY;

    lineInputs.push({
      lineId: alloc.id,
      invoiceId: invoice.kvInvoiceId,
      customerId,
      babyKey,
      babyName: canNameBaby ? alloc.baby?.babyName ?? null : null,
      replacementGroupId: meta.replacementGroupId ?? null,
      depletionDate,
      remindDate,
      assignmentStatus: alloc.assignmentStatus,
      confidence: alloc.assignmentConfidence,
      productName: alloc.invoiceLine.product.name,
    });
    lineMeta.set(alloc.id, {
      kvInvoiceLineId: alloc.kvInvoiceLineId,
      allocationId: alloc.id,
      babyId: canNameBaby ? alloc.babyId! : null,
    });
  }

  const calls = groupReminders(lineInputs, config);
  const today = vnToday(now);
  const monthStart = vnStartOfMonthUtc(now);
  let created = 0;
  let rr = 0;

  // Gom call theo khách để (1) idempotent theo sourceKey, (2) áp trần chống làm phiền theo khách.
  const callsByCustomer = new Map<string, ReminderCall[]>();
  for (const c of calls) {
    const arr = callsByCustomer.get(c.customerId) ?? [];
    arr.push(c);
    callsByCustomer.set(c.customerId, arr);
  }

  for (const [customerId, custCalls] of callsByCustomer) {
    const isHoldout = holdout.has(customerId);

    // 🔴 FIX-3: tra follow-up ĐANG MỞ hiện có theo sourceKey => tái dùng, không tạo trùng.
    const allSourceKeys = custCalls.flatMap((c) => c.sources.map((s) => s.sourceKey));
    const existingSources = allSourceKeys.length
      ? await prisma.reminderSource.findMany({
          where: { sourceKey: { in: allSourceKeys } },
          include: { followUp: true },
        })
      : [];
    const openFollowUpBySourceKey = new Map<string, string>();
    for (const es of existingSources) {
      if (es.sourceKey && es.followUpId && es.followUp && OPEN_STATUS_SET.has(es.followUp.status)) {
        openFollowUpBySourceKey.set(es.sourceKey, es.followUpId);
      }
    }

    const reuseCalls: { call: ReminderCall; followUpId: string }[] = [];
    const newCalls: ReminderCall[] = [];
    const reusedFollowUpIds = new Set<string>();
    for (const call of custCalls) {
      let target: string | undefined;
      for (const s of call.sources) {
        const fid = openFollowUpBySourceKey.get(s.sourceKey);
        if (fid) {
          target = fid;
          break;
        }
      }
      if (target) {
        reuseCalls.push({ call, followUpId: target });
        reusedFollowUpIds.add(target);
      } else {
        newCalls.push(call);
      }
    }

    // 🔴 FIX-4 (ISSUE-4 refine): trần proactive tính theo LIÊN HỆ THẬT trong tháng (contactedAt),
    // KHÔNG phải số việc mở tạo trong tháng. Cộng công suất đã "đặt chỗ" bởi việc proactive ĐANG MỞ
    // chưa liên hệ (contactedAt = null) để không over-schedule vượt trần.
    const [contactedThisMonth, reservedOpen] = await Promise.all([
      prisma.followUp.count({
        where: {
          customerId,
          targetType: 'customer',
          frequencyCapScope: 'proactive_sales_contact',
          contactedAt: { gte: monthStart },
        },
      }),
      prisma.followUp.count({
        where: {
          customerId,
          targetType: 'customer',
          frequencyCapScope: 'proactive_sales_contact',
          status: { in: [...OPEN_STATUSES] },
          contactedAt: null,
          ...(reusedFollowUpIds.size > 0 ? { id: { notIn: [...reusedFollowUpIds] } } : {}),
        },
      }),
    ]);
    const plan = planContactCap(
      newCalls,
      contactedThisMonth + reservedOpen,
      'proactive_sales_contact',
      config,
    );

    await prisma.$transaction(async (tx) => {
      // Tái dùng: cập nhật follow-up + upsert nguồn (không nhân đôi).
      for (const { call, followUpId } of reuseCalls) {
        await persistReminderCall(tx, {
          mode: 'reuse',
          followUpId,
          call,
          today,
          lineMeta,
        });
      }
      // Tạo mới trong trần.
      let lastNewFollowUpId: string | null = null;
      for (const call of plan.toCreate) {
        const assigneeId =
          opts.consumptionAssigneeIds.length > 0
            ? opts.consumptionAssigneeIds[rr++ % opts.consumptionAssigneeIds.length]!
            : null;
        lastNewFollowUpId = await persistReminderCall(tx, {
          mode: 'create',
          call,
          today,
          lineMeta,
          assigneeId,
          isHoldout,
        });
        created++;
      }
      // Vượt trần => KHÔNG sinh cuộc gọi mới; gom vào việc gần nhất (không mất nhắc — REM-R-08).
      if (plan.toMerge.length > 0) {
        let mergeTarget: string | null = lastNewFollowUpId ?? [...reusedFollowUpIds][0] ?? null;
        if (!mergeTarget) {
          const openProactive = await tx.followUp.findFirst({
            where: {
              customerId,
              frequencyCapScope: 'proactive_sales_contact',
              status: { in: [...OPEN_STATUSES] },
            },
            orderBy: { createdAt: 'desc' },
          });
          mergeTarget = openProactive?.id ?? null;
        }
        // Nếu vẫn không có nơi gom, tạo 1 việc để KHÔNG mất nhắc (thà tạo còn hơn mất).
        if (!mergeTarget) {
          const first = plan.toMerge[0]!;
          mergeTarget = await persistReminderCall(tx, {
            mode: 'create',
            call: first,
            today,
            lineMeta,
            assigneeId:
              opts.consumptionAssigneeIds.length > 0
                ? opts.consumptionAssigneeIds[rr++ % opts.consumptionAssigneeIds.length]!
                : null,
            isHoldout,
          });
          created++;
          for (const call of plan.toMerge.slice(1)) {
            await persistReminderCall(tx, { mode: 'reuse', followUpId: mergeTarget, call, today, lineMeta });
          }
        } else {
          for (const call of plan.toMerge) {
            await persistReminderCall(tx, { mode: 'reuse', followUpId: mergeTarget, call, today, lineMeta });
          }
        }
      }
    });
  }
  return created;
}

const OPEN_STATUSES = ['cho_toi_han', 'den_han', 'da_lien_he', 'hen_lai'] as const;
const OPEN_STATUS_SET = new Set<string>(OPEN_STATUSES);

interface PersistCallArgs {
  mode: 'create' | 'reuse';
  call: ReminderCall;
  today: Date;
  lineMeta: Map<string, { kvInvoiceLineId: string; allocationId: string; babyId: string | null }>;
  followUpId?: string;
  assigneeId?: string | null;
  isHoldout?: boolean;
}

/**
 * Ghi 1 việc gọi (follow-up) + nguồn nhắc theo cách IDEMPOTENT (FIX-3).
 * mode=create: tạo follow-up mới; mode=reuse: gắn/gom nguồn vào follow-up có sẵn.
 * Nguồn nhắc upsert theo sourceKey; lines được đồng bộ (xóa+tạo lại) — chạy 2 lần KHÔNG nhân đôi.
 */
async function persistReminderCall(
  tx: PrismaTx,
  args: PersistCallArgs,
): Promise<string> {
  const { call, today, lineMeta } = args;
  const overdue = call.remindDate.getTime() < today.getTime();
  const status = overdue || call.remindDate.getTime() === today.getTime() ? 'den_han' : 'cho_toi_han';

  let followUpId: string;
  if (args.mode === 'create') {
    const fu = await tx.followUp.create({
      data: {
        targetType: 'customer',
        customerId: call.customerId,
        reminderType: 'consumption',
        dueDate: call.remindDate,
        assigneeId: args.assigneeId ?? null,
        status,
        priority: overdue ? PRIORITY.overdueOrCommitted : PRIORITY.consumptionDue,
        frequencyCapScope: 'proactive_sales_contact',
        content: call.contentLines.join(' · '),
        isHoldout: args.isHoldout ?? false,
        reminderCount: 1,
      },
    });
    await tx.followUpStateHistory.create({
      data: { followUpId: fu.id, newStatus: status, note: 'Khởi tạo bởi engine consumption' },
    });
    followUpId = fu.id;
  } else {
    followUpId = args.followUpId!;
    // Gom nội dung: hợp nhất các dòng nội dung (không trùng lặp).
    const existing = await tx.followUp.findUnique({ where: { id: followUpId } });
    const merged = mergeContentLines(existing?.content ?? null, call.contentLines);
    // Chọn ngày nhắc SỚM NHẤT giữa việc hiện có và cụm mới (REM-R-02).
    const dueDate =
      existing && existing.dueDate < call.remindDate ? existing.dueDate : call.remindDate;
    await tx.followUp.update({
      where: { id: followUpId },
      data: { content: merged, dueDate },
    });
  }

  for (const src of call.sources) {
    await upsertReminderSource(tx, followUpId, src, lineMeta);
  }
  return followUpId;
}

/** Upsert nguồn nhắc theo sourceKey + đồng bộ lines (idempotent). */
async function upsertReminderSource(
  tx: PrismaTx,
  followUpId: string,
  src: ReminderSourceGroup,
  lineMeta: Map<string, { kvInvoiceLineId: string; allocationId: string; babyId: string | null }>,
): Promise<void> {
  const firstMeta = lineMeta.get(src.lineIds[0]!);
  const babyId = src.babyKey === CUSTOMER_LEVEL_KEY ? null : firstMeta?.babyId ?? null;
  const data = {
    followUpId,
    customerId: src.customerId,
    babyId,
    babyKey: src.babyKey,
    replacementGroupId: src.replacementGroupId,
    invoiceId: src.invoiceId,
    assignmentStatus: src.assignmentStatus,
    confidenceLevel: src.confidence,
    expectedDepletionDate: src.depletionDate,
    remindDate: src.remindDate,
    contentLine: src.contentLine,
  };
  const rs = await tx.reminderSource.upsert({
    where: { sourceKey: src.sourceKey },
    create: { sourceKey: src.sourceKey, ...data },
    update: data,
  });
  // Đồng bộ lines: xóa cũ + tạo lại theo lineIds (số dòng ổn định qua các lần chạy).
  await tx.reminderSourceLine.deleteMany({ where: { reminderSourceId: rs.id } });
  for (const lid of src.lineIds) {
    const m = lineMeta.get(lid);
    if (!m) continue;
    await tx.reminderSourceLine.create({
      data: { reminderSourceId: rs.id, kvInvoiceLineId: m.kvInvoiceLineId, allocationId: m.allocationId },
    });
  }
}

/** Hợp nhất dòng nội dung (dedupe) khi gom nhiều nguồn vào một việc. */
function mergeContentLines(current: string | null, add: string[]): string {
  const parts = new Set<string>();
  if (current) current.split(' · ').forEach((p) => parts.add(p.trim()));
  add.forEach((p) => parts.add(p.trim()));
  return [...parts].filter(Boolean).join(' · ');
}

/** Cập nhật chỉ số + sinh follow_ups đại lý (khách sỉ). Trả về số việc tạo. */
export async function generateReplenishmentFollowUps(opts: GenerateOptions): Promise<number> {
  const now = opts.now ?? new Date();
  const config = opts.config ?? DEFAULT_ENGINE_CONFIG;
  const today = vnToday(now);

  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    include: {
      contacts: true,
      excludedPeriods: true,
      orgRoles: { include: { customer: { include: { externalIdentities: true } } } },
    },
  });

  const windowStart = subMonths(now, config.agency.cadenceWindowMonths);
  let created = 0;
  let rr = 0;

  for (const org of orgs) {
    const kvIds = org.orgRoles.flatMap((r) =>
      r.customer.externalIdentities
        .filter((e) => e.unlinkedAt == null)
        .map((e) => e.externalCustomerId),
    );
    const invoices = kvIds.length
      ? await prisma.kvInvoice.findMany({
          where: { kvCustomerId: { in: kvIds }, status: 'completed', kvDeleted: false },
        })
      : [];

    const inWindow = invoices.filter((i) => i.purchaseDate >= windowStart);
    const dates = inWindow.map((i) => i.purchaseDate);
    const { medianCadenceDays, sampleSize } = computeMedianCadenceDays(dates);
    const lastPurchaseAt =
      dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    const daysSinceLast = lastPurchaseAt ? diffDaysVn(now, lastPurchaseAt) : null;
    const revenue90d = sumTotalsBetween(invoices, now, 0, 90);
    const revenuePrev90d = sumTotalsBetween(invoices, now, 90, 180);
    const excludedNow = org.excludedPeriods.some(
      (p) => p.fromDate <= now && now <= p.toDate,
    );

    const evalRes = evaluateOrganization(
      {
        medianCadenceDays,
        sampleSize,
        daysSinceLastPurchase: daysSinceLast,
        revenue90d,
        revenuePrev90d,
        paused: org.paused,
        supplierStockoutAffected: org.supplierStockoutAffected,
        excludedNow,
      },
      config,
    );

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        status: evalRes.status,
        medianCadenceDays: medianCadenceDays ?? null,
        cadenceSampleSize: sampleSize,
        lastPurchaseAt,
        revenue90d: revenue90d ?? null,
        revenuePrev90d: revenuePrev90d ?? null,
        revenueTrend: evalRes.shrinking ? 'down' : lastPurchaseAt ? 'flat' : null,
      },
    });

    if (!evalRes.warn) continue;

    const contact = pickAgencyContact(
      org.contacts.map((c) => ({
        role: c.role,
        name: c.name,
        phone: c.phone,
        isPrimary: c.isPrimary,
      })),
    );
    const isAtRisk = evalRes.status === 'at_risk';
    const assigneeId = isAtRisk
      ? opts.ownerId
      : opts.agencyAssigneeIds.length > 0
        ? opts.agencyAssigneeIds[rr++ % opts.agencyAssigneeIds.length]!
        : opts.ownerId;

    const priority = isAtRisk
      ? PRIORITY.atRisk
      : evalRes.status === 'slow'
        ? PRIORITY.slow
        : PRIORITY.agencyDue;

    const content = `${evalRes.reason}. Gọi ${contact?.name ?? 'người đặt hàng'} để hỏi lý do / nhắc nhập bù.`;
    const reminderType = isAtRisk ? 'agency_investigation' : 'replenishment';

    // 🔴 FIX-3: tái dùng follow-up đại lý ĐANG MỞ (cùng org) thay vì tạo thêm — chạy 2 lần không nhân đôi.
    const existingOpen = await prisma.followUp.findFirst({
      where: {
        organizationId: org.id,
        targetType: 'organization',
        status: { in: [...OPEN_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingOpen) {
      await prisma.followUp.update({
        where: { id: existingOpen.id },
        data: { reminderType, dueDate: today, priority, assigneeId, content },
      });
      continue;
    }

    const fu = await prisma.followUp.create({
      data: {
        targetType: 'organization',
        organizationId: org.id,
        reminderType,
        dueDate: today,
        assigneeId,
        status: 'den_han',
        priority,
        frequencyCapScope: 'proactive_sales_contact',
        content,
      },
    });
    await prisma.followUpStateHistory.create({
      data: { followUpId: fu.id, newStatus: 'den_han', note: 'Khởi tạo bởi engine replenishment' },
    });
    created++;
  }
  return created;
}

function sumTotalsBetween(
  invoices: { purchaseDate: Date; total: unknown }[],
  now: Date,
  fromDaysAgo: number,
  toDaysAgo: number,
): number | null {
  const from = new Date(now.getTime() - toDaysAgo * 86400000);
  const to = new Date(now.getTime() - fromDaysAgo * 86400000);
  const rel = invoices.filter((i) => i.purchaseDate >= from && i.purchaseDate < to);
  if (rel.length === 0) return 0;
  return rel.reduce((s, i) => s + Number(i.total), 0);
}
