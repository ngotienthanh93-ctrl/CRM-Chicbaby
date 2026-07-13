// 🔴 §12.2 SCR-14 — Cấu hình hệ thống (CFG-01..06, Phụ lục B).
// CHỈ Chủ shop. Mỗi thay đổi: BẮT BUỘC lý do + nhập lại mật khẩu (AUTH-12) + audit append-only.
// Version bump append-only cho configuration_versions; rollback = TẠO version mới (không sửa/xóa version cũ).
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import { addDays } from '../../lib/datetime';
import { runSerializable } from '../../lib/serializable';
import {
  CONFIG_GROUP_LABELS,
  getConfigItem,
  isConfigLocked,
} from '../../lib/config';
import {
  computeRecalcPreview,
  type OpenFollowUpSnapshot,
  type RegeneratedReminder,
} from './recalcPreview';

export const configRouter = Router();
configRouter.use(requireAuth);

/** Trạng thái follow-up ĐANG MỞ (dùng cho preview tác động — đối chiếu với generate.ts). */
const OPEN_STATUSES = ['cho_toi_han', 'den_han', 'da_lien_he', 'hen_lai'] as const;

/** 🔴 CWE-400: chặn preview quét không giới hạn — mỗi lần đọc tối đa N việc (bounded, không phụ thuộc kẻ gọi). */
const PREVIEW_SCAN_CAP = 5000;

/** Chuỗi báo lỗi tham số khóa cứng (CFG-05/REM-R-07). */
const LOCKED_MSG = 'Tham số bị khóa (∞), không sửa được.';

/**
 * 🔴 SEC (A01/least-privilege): các key CẤU HÌNH mọi vai đã đăng nhập được ĐỌC (không nhạy cảm, UI cần).
 * Vai KHÔNG có `manageConfig` chỉ nhận các key trong allowlist này; toàn bộ tham số vận hành ⇒ chỉ chu_shop.
 * `consultation.quick_templates`: màn Tư vấn (CSKH/CRM/marketing) cần để hiện mẫu nhanh.
 */
const PUBLIC_CONFIG_KEYS = new Set<string>(['consultation.quick_templates']);

/** Biên an toàn theo key cho tham số SỐ (nguyên tắc #9: cấu hình được NHƯNG trong ngưỡng hợp lệ). */
interface NumericBound {
  min?: number;
  max?: number;
  integer?: boolean;
}
// Cận trên (max) đặt rộng-rãi-hợp-lý để chống giá trị "khổng lồ" gây DoS vận hành, KHÔNG bó nghiệp vụ thực tế.
const NUMERIC_BOUNDS: Record<string, NumericBound> = {
  'experiment.holdout_ratio': { min: 0.1, max: 0.15 },
  'reminder.buffer_days': { min: 0, max: 365, integer: true },
  'reminder.grouping_window_days': { min: 1, max: 90, integer: true },
  'contact_cap.proactive_sales_per_month': { min: 0, max: 100, integer: true },
  'contact_cap.marketing_per_month': { min: 0, max: 100, integer: true },
  'agency.due_multiplier': { min: 0.1, max: 100 },
  'agency.slow_multiplier': { min: 0.1, max: 100 },
  'agency.at_risk_multiplier': { min: 0.1, max: 100 },
  'agency.min_sample_size': { min: 1, max: 1000, integer: true },
  'agency.cadence_window_months': { min: 1, max: 60, integer: true },
  'agency.revenue_decline_threshold': { min: 0, max: 1 },
  'dedup.merge_suggest_threshold': { min: 0, max: 100 },
  'customer.dormant_after_days': { min: 1, max: 3650, integer: true },
  'purchase.verification_window_days': { min: 1, max: 90, integer: true },
  'intent.recheck_days': { min: 1, max: 90, integer: true },
  'sync.polling_interval_minutes': { min: 1, max: 1440, integer: true },
  'sync.initial_load_months': { min: 1, max: 120, integer: true },
  'claim.claimed_ttl_minutes': { min: 1, max: 1440, integer: true },
  'claim.in_progress_ttl_minutes': { min: 1, max: 1440, integer: true },
  'claim.heartbeat_seconds': { min: 1, max: 3600, integer: true },
  'claim.grace_minutes': { min: 1, max: 1440, integer: true },
};

/**
 * 🔴 Nguyên tắc #9 + CWE-20: tham số CẤU HÌNH ĐƯỢC nhưng phải trong BIÊN AN TOÀN.
 * Chặn admin lưu giá trị vô lý (âm/0/khổng lồ/không phải số nguyên) gây hỏng lịch/tính toán (DoS vận hành).
 */
function validateConfigValueRange(key: string, value: unknown): void {
  const bound = NUMERIC_BOUNDS[key];
  if (!bound) return; // key chuỗi/không ràng buộc: bỏ qua (assertSameKind vẫn chặn đổi kiểu).
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) throw badRequest(`Tham số "${key}" phải là một số hợp lệ.`);
  if (bound.integer && !Number.isInteger(n))
    throw badRequest(`Tham số "${key}" phải là số nguyên.`);
  if (bound.min !== undefined && n < bound.min)
    throw badRequest(`Tham số "${key}" phải ≥ ${bound.min}.`);
  if (bound.max !== undefined && n > bound.max)
    throw badRequest(`Tham số "${key}" phải ≤ ${bound.max}.`);
}

/**
 * 🔴 Không cho ĐỔI KIỂU tham số (vd số → chuỗi) — engine đọc value theo kiểu cố định; đổi kiểu sẽ phá tính toán.
 * `current` là giá trị đang active (đã loại key khóa/null trước đó).
 */
function assertSameKind(current: unknown, next: unknown): void {
  if (current === null || current === undefined) return;
  if (typeof current !== typeof next)
    throw badRequest('Kiểu giá trị mới không khớp kiểu tham số hiện tại.');
}

// GET /api/config — các giá trị đang active. Kèm nhóm + cờ khóa cho SCR-14 (additive, không phá contract cũ).
// 🔴 SEC A01: vai KHÔNG có manageConfig chỉ nhận allowlist công khai (vd mẫu tư vấn), không lộ toàn bộ tham số vận hành.
configRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const canSeeAll = req.permissions?.manageConfig === true;
    const rows = await prisma.configurationVersion.findMany({
      where: canSeeAll ? { isActive: true } : { isActive: true, key: { in: [...PUBLIC_CONFIG_KEYS] } },
      orderBy: { key: 'asc' },
    });
    res.json({
      items: rows.map((r) => {
        const item = getConfigItem(r.key);
        const group = item?.group ?? null;
        return {
          key: r.key,
          value: r.value,
          version: r.version,
          locked: item?.locked === true,
          group,
          groupLabel: group ? CONFIG_GROUP_LABELS[group] : null,
        };
      }),
    });
  }),
);

// PUT /api/config/:key — CHỈ Chủ shop. Bắt buộc lý do + nhập lại mật khẩu; version mới + change log + audit.
const putSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  // 🔴 CFG: mỗi lần đổi PHẢI ghi lý do (không rỗng sau trim).
  reason: z.string().trim().min(1, 'Bắt buộc nhập lý do thay đổi.'),
  appliesTo: z.enum(['new_only', 'recalculate']).default('new_only'),
  // 🔴 §12 preamble: thao tác nhạy cảm => nhập lại mật khẩu (AUTH-12).
  password: z.string().min(1),
});
configRouter.put(
  '/:key',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest('Dữ liệu không hợp lệ: cần value, lý do (bắt buộc) và mật khẩu xác minh.');
    const key = String(req.params.key);
    // 🔴 CFG-05/REM-R-07: chặn sửa MỌI key khóa cứng (tra catalogue, KHÔNG hardcode chuỗi).
    if (isConfigLocked(key)) throw badRequest(LOCKED_MSG);
    // 🔴 Validate miền giá trị theo key TRƯỚC khi reauth (fail nhanh, không tốn lần xác minh mật khẩu).
    validateConfigValueRange(key, parsed.data.value);
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);

    // 🔴 CONC-02/03: đọc bản active + version bump + change-log + audit NGUYÊN TỬ trong 1 transaction
    // Serializable. Đọc `current` NGOÀI transaction từng gây race: 2 request đồng thời cùng tính
    // version N+1 và cùng đặt isActive=true. Serializable ⇒ một trong hai sẽ abort (không có 2 bản active).
    const newVersion = await runSerializable(async (tx) => {
        const current = await tx.configurationVersion.findFirst({
          where: { key, isActive: true },
        });
        if (!current) throw notFound('Không tìm thấy khóa cấu hình.');
        // 🔴 Không cho đổi KIỂU tham số so với giá trị hiện hành.
        assertSameKind(current.value, parsed.data.value);
        const nextVersion = current.version + 1;
        await tx.configurationVersion.update({
          where: { id: current.id },
          data: { isActive: false },
        });
        await tx.configurationVersion.create({
          data: {
            key,
            value: parsed.data.value as never,
            version: nextVersion,
            isActive: true,
            createdBy: req.auth!.userId,
          },
        });
        await tx.configurationChangeLog.create({
          data: {
            key,
            oldValue: current.value as never,
            newValue: parsed.data.value as never,
            changedBy: req.auth!.userId,
            reason: parsed.data.reason,
            appliesTo: parsed.data.appliesTo,
          },
        });
        await writeAudit(
          {
            userId: req.auth!.userId,
            action: 'config.update',
            objectType: 'configuration',
            objectId: key,
            oldValue: current.value,
            newValue: parsed.data.value,
            reason: parsed.data.reason,
          },
          tx,
        );
        return nextVersion;
    });
    res.json({ ok: true, version: newVersion });
  }),
);

// GET /api/config/:key/history — lịch sử các version của key (DESC), kèm lý do/appliesTo từ change log.
configRouter.get(
  '/:key/history',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const key = String(req.params.key);
    const [versions, logs] = await Promise.all([
      prisma.configurationVersion.findMany({ where: { key }, orderBy: { version: 'asc' } }),
      prisma.configurationChangeLog.findMany({ where: { key }, orderBy: { changedAt: 'asc' } }),
    ]);
    if (versions.length === 0) throw notFound('Không tìm thấy khóa cấu hình.');

    // Khớp mỗi version với change log theo THỜI ĐIỂM gần nhất (version + log tạo cùng transaction => chênh vài ms).
    // Mỗi log dùng tối đa 1 lần; version=1 (seed) thường không có log => reason/appliesTo = null.
    type Log = (typeof logs)[number];
    const usedLog = new Set<string>();
    const logForVersion = new Map<string, Log>();
    for (const v of versions) {
      let best: Log | null = null;
      let bestDiff = Infinity;
      for (const lg of logs) {
        if (usedLog.has(lg.id)) continue;
        const diff = Math.abs(lg.changedAt.getTime() - v.createdAt.getTime());
        if (diff < bestDiff) {
          bestDiff = diff;
          best = lg;
        }
      }
      if (best && bestDiff <= 5000) {
        usedLog.add(best.id);
        logForVersion.set(v.id, best);
      }
    }

    // Join user (createdBy version + changedBy log) — KHÔNG lộ passwordHash.
    const userIds = new Set<string>();
    for (const v of versions) if (v.createdBy) userIds.add(v.createdBy);
    for (const lg of logs) userIds.add(lg.changedBy);
    const users = userIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, username: true, fullName: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const toActor = (id: string | null | undefined) => {
      if (!id) return null;
      const u = byId.get(id);
      return u
        ? { id: u.id, username: u.username, fullName: u.fullName }
        : { id, username: null, fullName: null };
    };

    const items = [...versions]
      .sort((a, b) => b.version - a.version)
      .map((v) => {
        const lg = logForVersion.get(v.id);
        return {
          version: v.version,
          value: v.value,
          isActive: v.isActive,
          effectiveFrom: v.effectiveFrom,
          createdBy: toActor(v.createdBy),
          reason: lg?.reason ?? null,
          appliesTo: lg?.appliesTo ?? null,
          changedBy: toActor(lg?.changedBy),
          changedAt: lg?.changedAt ?? v.createdAt,
        };
      });
    res.json({ key, items });
  }),
);

// POST /api/config/:key/rollback — CFG-04: đưa THAM SỐ về version đích bằng cách TẠO version mới (append-only).
const rollbackSchema = z.object({
  toVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, 'Bắt buộc nhập lý do rollback.'),
  password: z.string().min(1),
});
configRouter.post(
  '/:key/rollback',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = rollbackSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest('Thiếu phiên bản đích, lý do (bắt buộc), hoặc mật khẩu xác minh.');
    const key = String(req.params.key);
    if (isConfigLocked(key)) throw badRequest(LOCKED_MSG);
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);

    // 🔴 CONC-02/03: đọc bản active + version đích + tạo version mới NGUYÊN TỬ (Serializable) —
    // chống race 2 bản active/trùng version như PUT.
    const result = await runSerializable(async (tx) => {
        const [current, target] = await Promise.all([
          tx.configurationVersion.findFirst({ where: { key, isActive: true } }),
          tx.configurationVersion.findFirst({ where: { key, version: parsed.data.toVersion } }),
        ]);
        if (!current) throw notFound('Không tìm thấy khóa cấu hình.');
        if (!target) throw notFound('Không tìm thấy phiên bản đích để rollback.');
        if (target.version === current.version)
          throw badRequest('Phiên bản đích đang là bản hiện hành, không cần rollback.');
        // 🔴 SEC/CWE-20: KHÔNG khôi phục giá trị lịch sử không an toàn (đúng kiểu + trong biên hợp lệ).
        assertSameKind(current.value, target.value);
        validateConfigValueRange(key, target.value);

        const reasonNote = `${parsed.data.reason} (rollback về v${target.version})`;
        const nextVersion = current.version + 1;
        await tx.configurationVersion.update({
          where: { id: current.id },
          data: { isActive: false },
        });
        await tx.configurationVersion.create({
          data: {
            key,
            // 🔴 CFG-04: copy giá trị của version đích thành VERSION MỚI (KHÔNG sửa/xóa version cũ).
            value: target.value as never,
            version: nextVersion,
            isActive: true,
            createdBy: req.auth!.userId,
          },
        });
        await tx.configurationChangeLog.create({
          data: {
            key,
            oldValue: current.value as never,
            newValue: target.value as never,
            changedBy: req.auth!.userId,
            reason: reasonNote,
            // 🔴 CFG-04: rollback THAM SỐ KHÔNG tự tính lại việc đã tính => new_only.
            appliesTo: 'new_only',
          },
        });
        await writeAudit(
          {
            userId: req.auth!.userId,
            action: 'config.rollback',
            objectType: 'configuration',
            objectId: key,
            oldValue: current.value,
            newValue: target.value,
            reason: reasonNote,
          },
          tx,
        );
        return { newVersion: nextVersion, rolledBackTo: target.version };
    });
    res.json({ ok: true, ...result });
  }),
);

// POST /api/config/recalculate-preview — CFG-02/03, CYC-08: PREVIEW ảnh hưởng khi chọn `recalculate`.
// 🔴 CHỈ ĐỌC (SELECT) — KHÔNG tạo/sửa follow-up hay config. Trả số việc ĐỔI/ĐÓNG/MẤT + ghi chú trung thực.
const previewSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
});
configRouter.post(
  '/recalculate-preview',
  requireRole('chu_shop'),
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cần key và value dự kiến để xem trước ảnh hưởng.');
    const { key, value } = parsed.data;

    const active = await prisma.configurationVersion.findFirst({
      where: { key, isActive: true },
    });
    if (!active) throw notFound('Không tìm thấy khóa cấu hình.');
    if (isConfigLocked(key)) throw badRequest(LOCKED_MSG);

    // ---- buffer_days: TÍNH CHÍNH XÁC (dịch đều ngày đến hạn việc tiêu dùng đang mở) ----
    if (key === 'reminder.buffer_days') {
      const proposed = Number(value);
      if (!Number.isInteger(proposed) || proposed < 0)
        throw badRequest('Giá trị buffer_days phải là số nguyên không âm.');
      const current = Number(active.value);

      // CHỈ SELECT — việc tiêu dùng đang mở + ngày dự kiến hết của các nguồn nhắc. 🔴 giới hạn PREVIEW_SCAN_CAP.
      const openFollowUps = await prisma.followUp.findMany({
        where: { reminderType: 'consumption', status: { in: [...OPEN_STATUSES] } },
        select: { id: true, reminderSources: { select: { expectedDepletionDate: true } } },
        take: PREVIEW_SCAN_CAP,
      });
      const truncated = openFollowUps.length === PREVIEW_SCAN_CAP;

      const currentOpen: OpenFollowUpSnapshot[] = [];
      const regenerated: RegeneratedReminder[] = [];
      for (const fu of openFollowUps) {
        if (fu.reminderSources.length === 0) continue; // không có nguồn => không tính được, bỏ qua
        const minDepletion = new Date(
          Math.min(...fu.reminderSources.map((s) => s.expectedDepletionDate.getTime())),
        );
        // ngayNhac = ngayDuKienHet − buffer (REM-R-01). Dịch đều nên KHÔNG đổi cách gom nhắc.
        currentOpen.push({ key: fu.id, dueDate: addDays(minDepletion, -current) });
        regenerated.push({ key: fu.id, dueDate: addDays(minDepletion, -proposed) });
      }

      const baseNote =
        'Ước tính theo NGÀY DỰ KIẾN HẾT của các nguồn nhắc: đổi buffer_days dịch đều ngày đến hạn của MỌI việc tiêu dùng đang mở. KHÔNG bao gồm việc đã hoãn/đổi kênh thủ công.';
      const result = computeRecalcPreview(currentOpen, regenerated, {
        estimated: true,
        // 🔴 trung thực: nếu chạm trần quét, nói rõ preview chỉ trên mẫu tối đa PREVIEW_SCAN_CAP việc.
        note: truncated
          ? `${baseNote} (Chỉ tính trên tối đa ${PREVIEW_SCAN_CAP} việc gần nhất — số thực có thể cao hơn.)`
          : baseNote,
      });
      res.json({ key, currentValue: active.value, proposedValue: value, ...result });
      return;
    }

    // ---- grouping_window_days: CÓ thể gộp/tách việc — CHƯA ước lượng chính xác (trung thực: estimated=false) ----
    if (key === 'reminder.grouping_window_days') {
      const sampleSize = await prisma.followUp.count({
        where: { reminderType: 'consumption', status: { in: [...OPEN_STATUSES] } },
      });
      res.json({
        key,
        currentValue: active.value,
        proposedValue: value,
        affected: 0,
        changed: 0,
        closed: 0,
        lost: 0,
        sampleSize,
        estimated: false,
        note: 'Đổi cửa sổ gom nhắc có thể GỘP/TÁCH việc gọi; bản xem trước chưa ước lượng chính xác số việc. Hãy áp dụng rồi kiểm tra lại danh sách việc.',
      });
      return;
    }

    // ---- Các tham số còn lại (sync/claim/dedup/experiment/agency/…): KHÔNG tác động việc đã tạo ----
    res.json({
      key,
      currentValue: active.value,
      proposedValue: value,
      affected: 0,
      changed: 0,
      closed: 0,
      lost: 0,
      sampleSize: 0,
      estimated: false,
      note: 'Tham số này KHÔNG thay đổi việc đã tạo — chỉ áp dụng khi TÍNH VIỆC MỚI. Không có việc đang mở nào bị ảnh hưởng ngay.',
    });
  }),
);
