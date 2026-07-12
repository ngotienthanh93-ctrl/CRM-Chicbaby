// 🔴 §12.1 SCR-13 — Ma trận quyền theo vai VERSIONED + THỰC THI THẬT (nguyên tắc #6, #9).
// Chủ shop chỉnh được ma trận quyền theo vai; override lưu versioned trong configuration_versions
// (key='rbac.role_permissions'), rồi ÁP THẬT ở mọi request qua getEffectivePermissions().
//
// An toàn: chỉ các cờ nghiệp vụ (OVERRIDABLE_FLAGS) được override; các cờ QUẢN TRỊ khóa theo code
// (không override được — tránh vô tình tự khóa quyền quản trị). Vai chu_shop LUÔN full code-default.

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { badRequest } from '../lib/http';
import { writeAudit } from '../security/audit';
import { permissionsFor, isRoleKey, type Permissions, type RoleKeyStr } from './permissions';

/** Khóa cấu hình lưu override ma trận quyền (một hàng active, versioned). */
export const ROLE_PERMISSIONS_KEY = 'rbac.role_permissions';

/** Các cờ nghiệp vụ ĐƯỢC override. Cờ ngoài danh sách này bị BỎ QUA khi merge (khóa theo code). */
export const OVERRIDABLE_FLAGS = [
  'viewSensitive',
  'viewBaby',
  'viewConsultation',
  'manageCustomer',
  'manageBaby',
  'processWork',
  'viewOrganization',
  'manageOrganization',
  'viewSync',
] as const satisfies readonly (keyof Permissions)[];

export type OverridableFlag = (typeof OVERRIDABLE_FLAGS)[number];

/** Cờ quản trị KHÓA CỨNG theo code (không override được). Dùng để UI hiển thị + kiểm bất biến. */
export const LOCKED_FLAGS = [
  'manageUsers',
  'manageConfig',
  'approveMerge',
  'approveExport',
  'approveCycle',
  'handleAtRisk',
  'manageSync',
] as const satisfies readonly (keyof Permissions)[];

/** 4 mức quyền trường nhạy cảm (SCR-13): Xem đầy đủ / Xem ẩn / Ẩn hoàn toàn. */
export type FieldLevel = 'full' | 'masked' | 'hidden';

export interface SensitiveFields {
  phone: FieldLevel;
  address: FieldLevel;
  baby: FieldLevel;
  consultation: FieldLevel;
  debt: FieldLevel;
  exportAllowed: boolean;
}

export interface RoleOverride {
  flags?: Partial<Record<OverridableFlag, boolean>>;
  fields?: Partial<SensitiveFields>;
}

export type OverrideMap = Partial<Record<RoleKeyStr, RoleOverride>>;

// ---------- zod schema (validate input PUT /roles) ----------
const fieldLevelSchema = z.enum(['full', 'masked', 'hidden']);
const roleOverrideSchema = z.object({
  flags: z.record(z.string(), z.boolean()).optional(),
  fields: z
    .object({
      phone: fieldLevelSchema.optional(),
      address: fieldLevelSchema.optional(),
      baby: fieldLevelSchema.optional(),
      consultation: fieldLevelSchema.optional(),
      debt: fieldLevelSchema.optional(),
      exportAllowed: z.boolean().optional(),
    })
    .optional(),
});
/** Schema cho body {overrides} của PUT /api/admin/roles. */
export const roleOverridesSchema = z.record(z.string(), roleOverrideSchema);

// ============================================================
// Merge THUẦN (unit-test được, KHÔNG chạm DB)
// ============================================================

/**
 * Áp override lên base permissions. THUẦN.
 * - chu_shop LOCKED: luôn trả base code-default (BỎ QUA override — chống tự khóa quyền quản trị).
 * - role không có override => trả base nguyên.
 * - Áp flag override (chỉ OVERRIDABLE_FLAGS; cờ quản trị bị bỏ qua).
 * - Áp field-derived (ƯU TIÊN field hơn flag cho 3 cờ nhạy cảm). 🔴 BẢO THỦ: chỉ 'full' mới cấp
 *   quyền xem đầy đủ. Vì masking một phần của hồ sơ bé / tư vấn CHƯA có ở server, 'masked' được coi
 *   NHƯ 'hidden' (chặn) thay vì rò rỉ dữ liệu đầy đủ (an toàn hơn — nguyên tắc #6, không over-grant).
 *   viewSensitive = fields.phone==='full'; viewBaby = fields.baby==='full'; viewConsultation = fields.consultation==='full'.
 */
export function mergePermissions(base: Permissions, override: RoleOverride | undefined): Permissions {
  // 🔴 chu_shop khóa cứng — không bao giờ bị hạ quyền.
  if (base.role === 'chu_shop') return base;
  if (!override) return base;

  const result: Permissions = { ...base };

  // 1) Áp cờ nghiệp vụ (chỉ các cờ cho phép override).
  if (override.flags) {
    for (const flag of OVERRIDABLE_FLAGS) {
      const v = override.flags[flag];
      if (typeof v === 'boolean') result[flag] = v;
    }
  }

  // 2) Field-derived — field THẮNG flag cho 3 cờ nhạy cảm (nguồn sự thật cho masking server-side).
  const f = override.fields;
  if (f) {
    // 🔴 BẢO THỦ (SEC): chỉ 'full' cấp quyền xem đầy đủ; 'masked'/'hidden' đều CHẶN
    // (chưa có masking một phần cho bé/tư vấn ở server ⇒ không rò rỉ dữ liệu đầy đủ khi chọn "Xem ẩn").
    if (f.phone !== undefined) result.viewSensitive = f.phone === 'full';
    if (f.baby !== undefined) result.viewBaby = f.baby === 'full';
    if (f.consultation !== undefined) result.viewConsultation = f.consultation === 'full';
  }

  return result;
}

/** Suy mức field nhạy cảm hiệu lực từ Permissions (dùng cho code-default + hiển thị ma trận). */
export function fieldsFromPermissions(p: Permissions): SensitiveFields {
  return {
    phone: p.viewSensitive ? 'full' : 'masked',
    address: p.viewSensitive ? 'full' : 'masked',
    baby: p.viewBaby ? 'full' : 'hidden',
    consultation: p.viewConsultation ? 'full' : 'hidden',
    debt: p.viewSensitive ? 'full' : 'masked',
    exportAllowed: p.approveExport,
  };
}

/** Mức field hiệu lực = code-default phủ bởi field override (nếu có). THUẦN. */
export function effectiveFields(base: Permissions, override: RoleOverride | undefined): SensitiveFields {
  const def = fieldsFromPermissions(base);
  if (base.role === 'chu_shop' || !override?.fields) return def;
  return { ...def, ...override.fields };
}

/** Loại bỏ cờ khóa/role không hợp lệ khỏi override trước khi lưu (phòng thủ). THUẦN. */
export function sanitizeOverrides(input: OverrideMap): OverrideMap {
  const out: OverrideMap = {};
  for (const [role, ov] of Object.entries(input)) {
    if (!isRoleKey(role)) continue; // bỏ role không hợp lệ
    if (role === 'chu_shop') continue; // 🔴 không lưu override cho chủ shop
    if (!ov) continue;
    const clean: RoleOverride = {};
    if (ov.flags) {
      const flags: Partial<Record<OverridableFlag, boolean>> = {};
      for (const flag of OVERRIDABLE_FLAGS) {
        if (typeof ov.flags[flag] === 'boolean') flags[flag] = ov.flags[flag];
      }
      if (Object.keys(flags).length > 0) clean.flags = flags;
    }
    if (ov.fields && Object.keys(ov.fields).length > 0) clean.fields = ov.fields;
    if (clean.flags || clean.fields) out[role] = clean;
  }
  return out;
}

// ============================================================
// Nạp override (CACHE in-memory: invalidate khi ghi + TTL fallback ~10s)
// ============================================================

interface CacheEntry {
  map: OverrideMap;
  loadedAt: number;
}
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 10_000;

/** Ép nạp lại override ở lần đọc kế tiếp (gọi sau khi ghi ma trận quyền). */
export function invalidateRolePermissionsCache(): void {
  cache = null;
}

function parseOverrideMap(value: unknown): OverrideMap {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  // Đã được sanitize khi lưu; vẫn sanitize lại phòng thủ khi đọc.
  return sanitizeOverrides(value as OverrideMap);
}

async function loadOverrideMap(): Promise<OverrideMap> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.map;
  const row = await prisma.configurationVersion.findFirst({
    where: { key: ROLE_PERMISSIONS_KEY, isActive: true },
    orderBy: { version: 'desc' },
  });
  const map = parseOverrideMap(row?.value);
  cache = { map, loadedAt: Date.now() };
  return map;
}

/** Quyền HIỆU LỰC của một vai (code-default phủ bởi override active). chu_shop trả base ngay. */
export async function getEffectivePermissions(role: RoleKeyStr): Promise<Permissions> {
  const base = permissionsFor(role);
  if (role === 'chu_shop') return base; // 🔴 LOCKED
  const map = await loadOverrideMap();
  return mergePermissions(base, map[role]);
}

// ============================================================
// Ma trận cho UI + lưu thay đổi
// ============================================================

const ALL_ROLES: RoleKeyStr[] = ['chu_shop', 'crm_officer', 'cskh', 'marketing', 'tro_ly_du_lieu'];

export interface RoleMatrixRow {
  role: RoleKeyStr;
  /** true với chu_shop — vai khóa cứng, không chỉnh được. */
  locked: boolean;
  /** Cờ hiệu lực (các cột hành động, đã áp override). */
  flags: Permissions;
  /** Cờ code-default (để UI so sánh / reset). */
  defaultFlags: Permissions;
  /** Mức field nhạy cảm hiệu lực (4 mức). */
  fields: SensitiveFields;
  /** Mức field code-default (để reset). */
  defaultFields: SensitiveFields;
}

export interface RoleMatrix {
  key: string;
  overridableFlags: readonly string[];
  lockedFlags: readonly string[];
  fieldKeys: readonly string[];
  fieldLevels: readonly FieldLevel[];
  rows: RoleMatrixRow[];
}

const FIELD_KEYS = ['phone', 'address', 'baby', 'consultation', 'debt'] as const;
const FIELD_LEVELS: readonly FieldLevel[] = ['full', 'masked', 'hidden'];

/** Ma trận Vai × Hành động + quyền field nhạy cảm (đã áp override), kèm code-default để UI so sánh/reset. */
export async function getRoleMatrix(): Promise<RoleMatrix> {
  const map = await loadOverrideMap();
  const rows: RoleMatrixRow[] = ALL_ROLES.map((role) => {
    const base = permissionsFor(role);
    const ov = role === 'chu_shop' ? undefined : map[role];
    return {
      role,
      locked: role === 'chu_shop',
      flags: mergePermissions(base, ov),
      defaultFlags: base,
      fields: effectiveFields(base, ov),
      defaultFields: fieldsFromPermissions(base),
    };
  });
  return {
    key: ROLE_PERMISSIONS_KEY,
    overridableFlags: OVERRIDABLE_FLAGS,
    lockedFlags: LOCKED_FLAGS,
    fieldKeys: FIELD_KEYS,
    fieldLevels: FIELD_LEVELS,
    rows,
  };
}

/**
 * Lưu override ma trận quyền (versioned) + change log + audit. Invalidate cache.
 * 🔴 TỪ CHỐI mọi thay đổi cho chu_shop (badRequest) — vai khóa cứng.
 */
export async function saveRoleOverrides(
  overrides: OverrideMap,
  changedBy: string,
): Promise<RoleMatrix> {
  // 🔴 Không cho chỉnh quyền vai Chủ shop (chống tự khóa quyền quản trị).
  if (Object.prototype.hasOwnProperty.call(overrides, 'chu_shop')) {
    throw badRequest('Không thể chỉnh quyền của vai Chủ shop/Quản trị (khóa cứng).');
  }
  const sanitized = sanitizeOverrides(overrides);

  // 🔴 Serializable + đọc version hiện tại BÊN TRONG transaction: chống 2 request đồng thời tạo
  //    nhiều hàng active / trùng version. deactivate MỌI hàng active (tự lành nếu lỡ có >1) rồi tạo 1.
  await prisma.$transaction(
    async (tx) => {
      const current = await tx.configurationVersion.findFirst({
        where: { key: ROLE_PERMISSIONS_KEY, isActive: true },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (current?.version ?? 0) + 1;
      await tx.configurationVersion.updateMany({
        where: { key: ROLE_PERMISSIONS_KEY, isActive: true },
        data: { isActive: false },
      });
      await tx.configurationVersion.create({
        data: {
          key: ROLE_PERMISSIONS_KEY,
          value: sanitized as never,
          version: nextVersion,
          isActive: true,
          createdBy: changedBy,
        },
      });
      await tx.configurationChangeLog.create({
        data: {
          key: ROLE_PERMISSIONS_KEY,
          oldValue: (current?.value ?? undefined) as never,
          newValue: sanitized as never,
          changedBy,
          reason: 'Cập nhật ma trận quyền theo vai (SCR-13)',
          appliesTo: 'new_only',
        },
      });
      // 🔴 audit TRONG cùng transaction (SEC-12): không có thay đổi quyền nào không được audit.
      await writeAudit(
        {
          userId: changedBy,
          action: 'user.role_matrix.update',
          objectType: 'configuration',
          objectId: ROLE_PERMISSIONS_KEY,
          oldValue: current?.value ?? undefined,
          newValue: sanitized,
          reason: 'Đổi ma trận quyền theo vai',
        },
        tx,
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  invalidateRolePermissionsCache();
  return getRoleMatrix();
}
