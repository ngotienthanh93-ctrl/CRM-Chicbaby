// 🔴 §12.3 SCR-15 — Worker phân bổ holdout PRODUCTION (EXP-01..07).
// Orchestration: nạp dữ liệu DB 1 lần (tránh N+1) → chạy phần THUẦN ở engine experiment.ts →
// upsert experiment_assignments (ổn định EXP-01) → cung cấp tập holdout cho engine sinh việc.
// KHÔNG chứa business rule mới — mọi quyết định loại trừ/phân nhóm nằm ở engine thuần.
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/http';
import {
  classifyForExperiment,
  isOpenOrderStatus,
  type ExperimentAssignmentContext,
} from '../../engines/experiment';

/** Trạng thái follow-up "đang mở" (đồng bộ với engine generate). */
const OPEN_FOLLOWUP_STATUSES = ['cho_toi_han', 'den_han', 'da_lien_he', 'hen_lai'] as const;

/**
 * Nạp toàn bộ ngữ cảnh loại trừ 1 LẦN từ DB (mỗi luật 1 truy vấn) rồi tra bằng Set trong vòng lặp khách.
 * Ánh xạ 6 luật khóa cứng (§12.3):
 *   - VIP            ← CustomerRole role='wholesale_contact'.
 *   - agencyAtRisk   ← CustomerOrganizationRole tới Organization status='at_risk' (liên kết THẬT customer↔org).
 *   - callback       ← FollowUp mở status='hen_lai'.
 *   - service_contact← FollowUp mở frequencyCapScope='service_contact' (cũng suy ra hasComplaint).
 *   - order/debt     ← KvOrder trạng thái mở, map kvCustomerId→crm qua CustomerExternalIdentity (best-effort).
 */
export async function loadAssignmentContext(): Promise<ExperimentAssignmentContext> {
  const [vipRoles, atRiskOrgs, callbackFu, serviceFu, identities, orders] = await Promise.all([
    prisma.customerRole.findMany({
      where: { role: 'wholesale_contact' },
      select: { customerId: true },
    }),
    prisma.organization.findMany({
      where: { status: 'at_risk', deletedAt: null },
      select: { id: true },
    }),
    prisma.followUp.findMany({
      where: { targetType: 'customer', status: 'hen_lai', customerId: { not: null } },
      select: { customerId: true },
    }),
    prisma.followUp.findMany({
      where: {
        targetType: 'customer',
        frequencyCapScope: 'service_contact',
        status: { in: [...OPEN_FOLLOWUP_STATUSES] },
        customerId: { not: null },
      },
      select: { customerId: true },
    }),
    prisma.customerExternalIdentity.findMany({
      where: { sourceSystem: 'kiotviet', unlinkedAt: null },
      select: { customerId: true, externalCustomerId: true },
    }),
    prisma.kvOrder.findMany({
      where: { kvCustomerId: { not: null } },
      select: { kvCustomerId: true, status: true },
    }),
  ]);

  const vipCustomerIds = new Set(vipRoles.map((r) => r.customerId));

  // Đại lý at_risk: từ org → liên hệ khách (best-effort nhưng liên kết rõ ràng qua bảng customer_organization_roles).
  const atRiskOrgIds = atRiskOrgs.map((o) => o.id);
  const atRiskRoles = atRiskOrgIds.length
    ? await prisma.customerOrganizationRole.findMany({
        where: { organizationId: { in: atRiskOrgIds } },
        select: { customerId: true },
      })
    : [];
  const atRiskCustomerIds = new Set(atRiskRoles.map((r) => r.customerId));

  const callbackCustomerIds = new Set(
    callbackFu.map((f) => f.customerId).filter((id): id is string => id != null),
  );
  const serviceContactCustomerIds = new Set(
    serviceFu.map((f) => f.customerId).filter((id): id is string => id != null),
  );

  const kvToCrm = new Map<string, string>();
  identities.forEach((i) => kvToCrm.set(i.externalCustomerId, i.customerId));
  const openOrderDebtCustomerIds = new Set<string>();
  for (const o of orders) {
    if (!isOpenOrderStatus(o.status)) continue;
    const crmId = o.kvCustomerId ? kvToCrm.get(o.kvCustomerId) : undefined;
    if (crmId) openOrderDebtCustomerIds.add(crmId);
  }

  return {
    vipCustomerIds,
    atRiskCustomerIds,
    callbackCustomerIds,
    serviceContactCustomerIds,
    openOrderDebtCustomerIds,
  };
}

export interface AssignExperimentResult {
  /** Số khách được gán nhóm (treatment + holdout). */
  assigned: number;
  treatment: number;
  holdout: number;
  /** Số khách bị loại khỏi thí nghiệm bởi 6 luật khóa cứng. */
  excluded: number;
}

/**
 * 🔴 Phân bổ khách bán lẻ vào treatment/holdout cho MỘT thí nghiệm đang `running`.
 * - Chỉ chạy khi status='running' (khác ⇒ 400; không thấy ⇒ 404).
 * - Khách dính 1/6 luật loại trừ ⇒ BỎ (không treatment/holdout).
 * - upsert theo [experimentId, customerId]: chạy lại KHÔNG đổi nhóm khách đã gán (EXP-01 ổn định).
 */
export async function assignExperiment(experimentId: string): Promise<AssignExperimentResult> {
  const experiment = await prisma.experiment.findUnique({ where: { id: experimentId } });
  if (!experiment) throw notFound('Không tìm thấy thí nghiệm.');
  if (experiment.status !== 'running') {
    throw badRequest('Chỉ phân bổ được khi thí nghiệm đang chạy (running).');
  }

  const holdoutRatio = Number(experiment.holdoutRatio);

  // Đối tượng thí nghiệm = khách có vai bán lẻ (distinct).
  const retailRoles = await prisma.customerRole.findMany({
    where: { role: 'retail_customer' },
    select: { customerId: true },
  });
  const retailCustomerIds = [...new Set(retailRoles.map((r) => r.customerId))];

  const ctx = await loadAssignmentContext();

  let assigned = 0;
  let treatment = 0;
  let holdout = 0;
  const excludedCustomerIds: string[] = [];
  for (const customerId of retailCustomerIds) {
    const cls = classifyForExperiment(customerId, experimentId, holdoutRatio, ctx);
    if (cls.excluded) {
      excludedCustomerIds.push(customerId);
      continue;
    }
    await prisma.experimentAssignment.upsert({
      where: { experimentId_customerId: { experimentId, customerId } },
      create: { experimentId, customerId, group: cls.group },
      update: { group: cls.group },
    });
    assigned++;
    if (cls.group === 'holdout') holdout++;
    else treatment++;
  }

  // 🔴 Khách GIỜ dính 1/6 luật loại trừ mà TRƯỚC ĐÓ đã được gán (vd mới phát sinh khiếu nại) ⇒ GỠ khỏi
  // thí nghiệm: không để VIP/khiếu nại kẹt trong holdout (bị từ chối nhắc chủ động). Loại trừ cứng ƯU TIÊN
  // hơn ổn định nhóm EXP-01 (EXP-01 chỉ chi phối treatment↔holdout của khách ĐƯỢC đưa vào).
  if (excludedCustomerIds.length) {
    await prisma.experimentAssignment.deleteMany({
      where: { experimentId, customerId: { in: excludedCustomerIds } },
    });
  }

  return { assigned, treatment, holdout, excluded: excludedCustomerIds.length };
}

/**
 * 🔴 EXP-04: hợp nhất customerId thuộc nhóm holdout của MỌI thí nghiệm đang `running`.
 * Trả Set để engine sinh việc loại các khách này khỏi việc chủ động (không hiện SCR-02).
 */
export async function computeHoldoutCustomerIds(): Promise<Set<string>> {
  const rows = await prisma.experimentAssignment.findMany({
    where: { group: 'holdout', experiment: { status: 'running' } },
    select: { customerId: true },
  });
  return new Set(rows.map((r) => r.customerId));
}

export interface GenerationAssignees {
  ownerId: string;
  consumptionAssigneeIds: string[];
  agencyAssigneeIds: string[];
}

/**
 * Derive ĐỘNG người nhận việc từ bảng User (active) theo vai (giống seed nhưng không hard-code id):
 *   - ownerId              = một `chu_shop`.
 *   - consumptionAssignee  = `cskh` + `crm_officer`.
 *   - agencyAssignee       = `crm_officer`.
 * Thiếu vai nào ⇒ fallback về owner (để engine luôn có người nhận). Không có user active ⇒ 400.
 */
export async function resolveGenerationAssignees(): Promise<GenerationAssignees> {
  const users = await prisma.user.findMany({
    where: { status: 'active' },
    select: { id: true, role: { select: { key: true } } },
  });

  const byRole = new Map<string, string[]>();
  for (const u of users) {
    const arr = byRole.get(u.role.key) ?? [];
    arr.push(u.id);
    byRole.set(u.role.key, arr);
  }

  const ownerId = (byRole.get('chu_shop') ?? [])[0] ?? users[0]?.id;
  if (!ownerId) throw badRequest('Không có người dùng đang hoạt động để giao việc.');

  const cskh = byRole.get('cskh') ?? [];
  const crm = byRole.get('crm_officer') ?? [];
  const consumptionAssigneeIds = [...cskh, ...crm];

  return {
    ownerId,
    consumptionAssigneeIds: consumptionAssigneeIds.length > 0 ? consumptionAssigneeIds : [ownerId],
    agencyAssigneeIds: crm.length > 0 ? crm : [ownerId],
  };
}
