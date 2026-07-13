// 🔴 §12.3 SCR-15 — Quản lý thí nghiệm holdout (EXP-01..07).
// CHỈ Chủ shop/Quản trị (manageConfig). Mọi mutation NHẠY CẢM ⇒ nhập lại mật khẩu (AUTH-12/EXP-05)
// + ghi audit append-only TRONG cùng transaction với mutation.
// 🔴 EXP-06: chưa đủ mẫu ⇒ hasConclusion=false ⇒ frontend KHÔNG hiển thị kết luận.
// 🔴 §12.3: 6 luật loại trừ KHÓA CỨNG luôn được lưu, server LUÔN ép đủ — client không gỡ được.
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { HARD_EXCLUSION_RULES, enforceHardExclusions } from '../../engines/experiment';

export const experimentsRouter = Router();
// 🔴 Toàn bộ module chỉ cho vai cấu hình hệ thống (chỉ chu_shop). Gõ URL trực tiếp vẫn bị chặn (SEC-05).
experimentsRouter.use(requireAuth, requirePermission('manageConfig'));

// ---- Hằng số cấu hình ⚙️ (Phụ lục B / §12.3) — KHÔNG hard-code rải rác ----
/** ⚙️ experiment.holdout_ratio: dải cho phép 10–15%. Mặc định lấy từ DEFAULT_ENGINE_CONFIG. */
const HOLDOUT_RATIO_MIN = 0.1;
const HOLDOUT_RATIO_MAX = 0.15;
const DEFAULT_HOLDOUT_RATIO = DEFAULT_ENGINE_CONFIG.experiment.holdoutRatio; // 0.1 (⚙️)
/** ⚙️ Phụ lục B: cỡ mẫu tối thiểu để có kết luận. */
const DEFAULT_MIN_SAMPLE_TREATMENT = 300; // ⚙️ experiment.min_sample_treatment
const DEFAULT_MIN_SAMPLE_HOLDOUT = 100; // ⚙️ experiment.min_sample_holdout

type ExperimentStatusStr = 'draft' | 'running' | 'paused' | 'completed';

/**
 * 🔴 Chuyển trạng thái hợp lệ. draft↔running↔paused và *→completed.
 * completed là điểm cuối (không quay lại) — chặn chuyển vô lý (vd completed→running) => 400.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<ExperimentStatusStr, ExperimentStatusStr[]> = {
  draft: ['running', 'completed'],
  running: ['paused', 'completed'],
  paused: ['running', 'completed'],
  completed: [],
};

/** Scope áp dụng: vai + nhóm SP. Lưu gộp trong exclusionRules JSON (cạnh hardRules khóa cứng). */
interface ExperimentScope {
  roles: string[];
  productGroups: string[];
}

interface StoredExclusionRules {
  /** 🔴 6 luật loại trừ khóa cứng (đã ép đủ). */
  hardRules: string[];
  scope: ExperimentScope;
}

/** Đọc exclusionRules JSON đã lưu (khoan dung với dữ liệu cũ/null): luôn ép đủ 6 luật + scope hợp lệ. */
function readStored(raw: Prisma.JsonValue | null): StoredExclusionRules {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawHard = Array.isArray(obj.hardRules) ? (obj.hardRules as unknown[]).map(String) : [];
  const rawScope =
    obj.scope && typeof obj.scope === 'object' && !Array.isArray(obj.scope)
      ? (obj.scope as Record<string, unknown>)
      : {};
  const roles = Array.isArray(rawScope.roles) ? (rawScope.roles as unknown[]).map(String) : [];
  const productGroups = Array.isArray(rawScope.productGroups)
    ? (rawScope.productGroups as unknown[]).map(String)
    : [];
  return { hardRules: enforceHardExclusions(rawHard), scope: { roles, productGroups } };
}

/** Dựng exclusionRules JSON để lưu: LUÔN ép đủ 6 luật khóa cứng (dù client gửi gì). */
function buildExclusionRules(input: {
  hardRules?: string[];
  appliesToRoles?: string[];
  appliesToProductGroups?: string[];
}): StoredExclusionRules {
  return {
    hardRules: enforceHardExclusions(input.hardRules),
    scope: {
      roles: input.appliesToRoles ?? [],
      productGroups: input.appliesToProductGroups ?? [],
    },
  };
}

/** Nhãn tiếng Việt của luật loại trừ (để trả ra cho frontend hiển thị checkbox khóa). */
const HARD_RULE_LABEL = new Map(HARD_EXCLUSION_RULES.map((r) => [r.key, r.label]));

/** Serialize một thí nghiệm + số mẫu hiện tại. 🔴 EXP-06: hasConclusion = đủ cả hai cỡ mẫu. */
function serializeExperiment(
  exp: {
    id: string;
    name: string;
    startAt: Date;
    endAt: Date | null;
    holdoutRatio: Prisma.Decimal;
    status: ExperimentStatusStr;
    assignmentUnit: string;
    minSampleTreatment: number;
    minSampleHoldout: number;
    exclusionRules: Prisma.JsonValue | null;
    createdBy: string;
    approvedBy: string | null;
    createdAt: Date;
  },
  sampleTreatment: number,
  sampleHoldout: number,
) {
  const stored = readStored(exp.exclusionRules);
  const enoughTreatment = sampleTreatment >= exp.minSampleTreatment;
  const enoughHoldout = sampleHoldout >= exp.minSampleHoldout;
  const enoughSample = enoughTreatment && enoughHoldout;
  return {
    id: exp.id,
    name: exp.name,
    startAt: exp.startAt,
    endAt: exp.endAt,
    // 🔴 Decimal(4,3) => Number khi trả JSON.
    holdoutRatio: Number(exp.holdoutRatio),
    status: exp.status,
    assignmentUnit: exp.assignmentUnit,
    minSampleTreatment: exp.minSampleTreatment,
    minSampleHoldout: exp.minSampleHoldout,
    sampleTreatment,
    sampleHoldout,
    enoughTreatment,
    enoughHoldout,
    enoughSample,
    // 🔴 EXP-06: chưa đủ mẫu ⇒ KHÔNG kết luận.
    hasConclusion: enoughSample,
    // 6 luật khóa cứng kèm nhãn + cờ locked để frontend render checkbox khóa (không cho bỏ).
    exclusionRules: stored.hardRules.map((key) => ({
      key,
      label: HARD_RULE_LABEL.get(key) ?? key,
      locked: true,
    })),
    scope: stored.scope,
    createdBy: exp.createdBy,
    approvedBy: exp.approvedBy,
    createdAt: exp.createdAt,
  };
}

/** Đếm số mẫu theo nhóm cho MỘT thí nghiệm. */
async function countSamples(experimentId: string): Promise<{ treatment: number; holdout: number }> {
  const grouped = await prisma.experimentAssignment.groupBy({
    by: ['group'],
    where: { experimentId },
    _count: { _all: true },
  });
  let treatment = 0;
  let holdout = 0;
  for (const g of grouped) {
    if (g.group === 'treatment') treatment = g._count._all;
    else if (g.group === 'holdout') holdout = g._count._all;
  }
  return { treatment, holdout };
}

// ---- Zod schemas ----
const scopeFields = {
  appliesToRoles: z.array(z.string()).optional(),
  appliesToProductGroups: z.array(z.string()).optional(),
  // Client có thể gửi hardRules; server LUÔN ép đủ 6 nên chỉ tham khảo.
  hardRules: z.array(z.string()).optional(),
};

const createSchema = z.object({
  name: z.string().min(1),
  startAt: z.string().min(1),
  // 🔴 §12.3: endAt BẮT BUỘC (thí nghiệm phải có kết thúc).
  endAt: z.string().min(1),
  holdoutRatio: z.number().optional(),
  minSampleTreatment: z.number().int().positive().optional(),
  minSampleHoldout: z.number().int().positive().optional(),
  ...scopeFields,
  password: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  endAt: z.string().min(1).optional(),
  holdoutRatio: z.number().optional(),
  minSampleTreatment: z.number().int().positive().optional(),
  minSampleHoldout: z.number().int().positive().optional(),
  ...scopeFields,
  password: z.string().min(1),
});

const statusSchema = z.object({
  status: z.enum(['draft', 'running', 'paused', 'completed']),
  password: z.string().min(1),
});

/** Parse ISO datetime => Date; ném badRequest nếu sai định dạng. */
function parseRequiredDate(v: string, field: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`Giá trị "${field}" không phải ngày giờ hợp lệ.`);
  return d;
}

/** Kiểm tra holdoutRatio trong dải cho phép ⚙️ 10–15%. */
function validateHoldoutRatio(ratio: number): void {
  if (ratio < HOLDOUT_RATIO_MIN || ratio > HOLDOUT_RATIO_MAX) {
    throw badRequest(`Tỉ lệ holdout phải trong khoảng ${HOLDOUT_RATIO_MIN}–${HOLDOUT_RATIO_MAX} (10–15%).`);
  }
}

/**
 * 🔴 Nguyên tắc #9: tỉ lệ holdout mặc định ĐỌC TỪ cấu hình active (`experiment.holdout_ratio`),
 * KHÔNG hard-code — đổi ở SCR-14 phải ảnh hưởng tới thí nghiệm tạo mới. Fallback về hằng số nếu thiếu/hỏng.
 */
async function activeHoldoutRatioDefault(): Promise<number> {
  const row = await prisma.configurationVersion.findFirst({
    where: { key: 'experiment.holdout_ratio', isActive: true },
  });
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) ? v : DEFAULT_HOLDOUT_RATIO;
}

// ============================================================
// GET /api/experiments — danh sách + số mẫu + cờ đủ mẫu (EXP-06)
// ============================================================
experimentsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [experiments, counts] = await Promise.all([
      prisma.experiment.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.experimentAssignment.groupBy({
        by: ['experimentId', 'group'],
        _count: { _all: true },
      }),
    ]);
    // Map experimentId => { treatment, holdout }.
    const byExp = new Map<string, { treatment: number; holdout: number }>();
    for (const c of counts) {
      const entry = byExp.get(c.experimentId) ?? { treatment: 0, holdout: 0 };
      if (c.group === 'treatment') entry.treatment = c._count._all;
      else if (c.group === 'holdout') entry.holdout = c._count._all;
      byExp.set(c.experimentId, entry);
    }
    res.json({
      items: experiments.map((exp) => {
        const n = byExp.get(exp.id) ?? { treatment: 0, holdout: 0 };
        return serializeExperiment(exp, n.treatment, n.holdout);
      }),
    });
  }),
);

// ============================================================
// POST /api/experiments — tạo (draft). Reauth + audit (EXP-05).
// ============================================================
experimentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu tạo thí nghiệm không hợp lệ.');
    const input = parsed.data;

    const startAt = parseRequiredDate(input.startAt, 'startAt');
    const endAt = parseRequiredDate(input.endAt, 'endAt');
    // 🔴 §12.3: endAt bắt buộc SAU startAt.
    if (endAt <= startAt) throw badRequest('Thời điểm kết thúc phải sau thời điểm bắt đầu.');

    const holdoutRatio = input.holdoutRatio ?? (await activeHoldoutRatioDefault());
    validateHoldoutRatio(holdoutRatio);
    const minSampleTreatment = input.minSampleTreatment ?? DEFAULT_MIN_SAMPLE_TREATMENT;
    const minSampleHoldout = input.minSampleHoldout ?? DEFAULT_MIN_SAMPLE_HOLDOUT;

    // 🔴 Reauth trước khi ghi (AUTH-12/EXP-05).
    await verifyReauth(req.auth!.userId, input.password, req.ip);

    // 🔴 LUÔN ép đủ 6 luật khóa cứng, dù client gửi gì.
    const exclusionRules = buildExclusionRules(input);

    const created = await prisma.$transaction(async (tx) => {
      const exp = await tx.experiment.create({
        data: {
          name: input.name,
          startAt,
          endAt,
          holdoutRatio,
          status: 'draft',
          createdBy: req.auth!.userId,
          minSampleTreatment,
          minSampleHoldout,
          exclusionRules: exclusionRules as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit(
        {
          userId: req.auth!.userId,
          action: 'experiment.create',
          objectType: 'experiment',
          objectId: exp.id,
          newValue: {
            name: input.name,
            holdoutRatio,
            minSampleTreatment,
            minSampleHoldout,
            // ISO string: audit scrub coi Date là object rỗng => phải stringify để giữ giá trị.
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            scope: exclusionRules.scope,
            hardRules: exclusionRules.hardRules,
          },
        },
        tx,
      );
      return exp;
    });

    // Vừa tạo => chưa có phân bổ => mẫu 0/0.
    res.json(serializeExperiment(created, 0, 0));
  }),
);

// ============================================================
// PUT /api/experiments/:id — sửa. Reauth + audit. LUÔN ép lại đủ 6 luật.
// ============================================================
experimentsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Dữ liệu cập nhật thí nghiệm không hợp lệ.');
    const input = parsed.data;
    const id = String(req.params.id);

    const existing = await prisma.experiment.findUnique({ where: { id } });
    if (!existing) throw notFound('Không tìm thấy thí nghiệm.');

    // 🔴 Toàn vẹn thí nghiệm (A08): đã kết thúc ⇒ read-only; sau khi rời `draft` ⇒ KHÔNG đổi holdoutRatio
    // (đổi ngưỡng hash sẽ đổi nhóm holdout của khách đang chạy ⇒ nhiễm chéo, phá EXP-01/02).
    if (existing.status === 'completed')
      throw badRequest('Thí nghiệm đã kết thúc — không sửa được.');
    if (
      existing.status !== 'draft' &&
      input.holdoutRatio !== undefined &&
      input.holdoutRatio !== Number(existing.holdoutRatio)
    )
      throw badRequest('Không đổi tỉ lệ holdout sau khi thí nghiệm đã chạy (giữ ổn định phân nhóm).');

    // Tính endAt mới (nếu đổi) và kiểm tra > startAt.
    let endAt: Date | undefined;
    if (input.endAt !== undefined) {
      endAt = parseRequiredDate(input.endAt, 'endAt');
      if (endAt <= existing.startAt) throw badRequest('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
    }
    if (input.holdoutRatio !== undefined) validateHoldoutRatio(input.holdoutRatio);

    await verifyReauth(req.auth!.userId, input.password, req.ip);

    // 🔴 Luôn ép lại đủ 6 luật khóa cứng; giữ scope hiện có nếu request không gửi.
    const prevStored = readStored(existing.exclusionRules);
    const exclusionRules = buildExclusionRules({
      hardRules: input.hardRules,
      appliesToRoles: input.appliesToRoles ?? prevStored.scope.roles,
      appliesToProductGroups: input.appliesToProductGroups ?? prevStored.scope.productGroups,
    });

    const data: Prisma.ExperimentUpdateInput = {
      exclusionRules: exclusionRules as unknown as Prisma.InputJsonValue,
    };
    if (input.name !== undefined) data.name = input.name;
    if (endAt !== undefined) data.endAt = endAt;
    if (input.holdoutRatio !== undefined) data.holdoutRatio = input.holdoutRatio;
    if (input.minSampleTreatment !== undefined) data.minSampleTreatment = input.minSampleTreatment;
    if (input.minSampleHoldout !== undefined) data.minSampleHoldout = input.minSampleHoldout;

    const updated = await prisma.$transaction(async (tx) => {
      // 🔴 CWE-367 (TOCTOU): cập nhật CÓ ĐIỀU KIỆN theo status đã kiểm — nếu thí nghiệm đổi trạng thái
      // (vd sang completed) giữa lúc đọc và ghi thì count=0 ⇒ 409, ràng buộc sửa-theo-status vẫn đúng.
      const res = await tx.experiment.updateMany({ where: { id, status: existing.status }, data });
      if (res.count === 0) throw conflict('Thí nghiệm vừa đổi trạng thái, hãy tải lại rồi thử lại.');
      const exp = await tx.experiment.findUniqueOrThrow({ where: { id } });
      await writeAudit(
        {
          userId: req.auth!.userId,
          action: 'experiment.update',
          objectType: 'experiment',
          objectId: id,
          oldValue: {
            name: existing.name,
            holdoutRatio: Number(existing.holdoutRatio),
            minSampleTreatment: existing.minSampleTreatment,
            minSampleHoldout: existing.minSampleHoldout,
            // ISO string: audit scrub coi Date là object rỗng => phải stringify.
            endAt: existing.endAt?.toISOString() ?? null,
            scope: prevStored.scope,
          },
          newValue: {
            name: exp.name,
            holdoutRatio: Number(exp.holdoutRatio),
            minSampleTreatment: exp.minSampleTreatment,
            minSampleHoldout: exp.minSampleHoldout,
            endAt: exp.endAt?.toISOString() ?? null,
            scope: exclusionRules.scope,
            hardRules: exclusionRules.hardRules,
          },
        },
        tx,
      );
      return exp;
    });

    const n = await countSamples(id);
    res.json(serializeExperiment(updated, n.treatment, n.holdout));
  }),
);

// ============================================================
// POST /api/experiments/:id/status — đổi trạng thái. Reauth + audit (EXP-05).
// ============================================================
experimentsRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Trạng thái không hợp lệ.');
    const id = String(req.params.id);
    const next = parsed.data.status;

    const existing = await prisma.experiment.findUnique({ where: { id } });
    if (!existing) throw notFound('Không tìm thấy thí nghiệm.');
    const current = existing.status as ExperimentStatusStr;

    if (current === next) throw badRequest('Thí nghiệm đã ở trạng thái này.');
    // 🔴 Chặn chuyển vô lý (vd completed→running).
    if (!ALLOWED_STATUS_TRANSITIONS[current].includes(next)) {
      throw badRequest(`Không thể chuyển trạng thái từ "${current}" sang "${next}".`);
    }

    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);

    const updated = await prisma.$transaction(async (tx) => {
      // 🔴 CWE-367 (TOCTOU): cập nhật CÓ ĐIỀU KIỆN theo status kỳ vọng — 2 request đồng thời không
      // cùng vượt qua kiểm tra transition trên state cũ. count=0 ⇒ ai đó vừa đổi ⇒ 409.
      const res = await tx.experiment.updateMany({
        where: { id, status: current },
        data: { status: next },
      });
      if (res.count === 0) throw conflict('Trạng thái thí nghiệm vừa thay đổi, hãy tải lại.');
      const exp = await tx.experiment.findUniqueOrThrow({ where: { id } });
      await writeAudit(
        {
          userId: req.auth!.userId,
          action: 'experiment.status_change',
          objectType: 'experiment',
          objectId: id,
          oldValue: { status: current },
          newValue: { status: next },
        },
        tx,
      );
      return exp;
    });

    const n = await countSamples(id);
    res.json(serializeExperiment(updated, n.treatment, n.holdout));
  }),
);
