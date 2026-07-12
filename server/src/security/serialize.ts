// Serializer có MASKING theo quyền — mọi endpoint trả dữ liệu khách/bé PHẢI đi qua đây (§3).
import type { Permissions } from './permissions';
import { maskAddress, maskBabyName, maskBirthDate, maskPhone, maskSensitiveText } from './masking';
import { computeCurrentAgeMonths, ageStageOf } from '../engines/babyAge';
import { DEFAULT_ENGINE_CONFIG } from '../lib/config';
import { formatVnDate } from '../lib/datetime';

export interface PhoneLike {
  id: string;
  phoneRaw: string;
  phoneNormalized: string;
  type: string;
  isPrimary: boolean;
  source: string;
}

export function serializePhone(p: PhoneLike, perms: Permissions) {
  return {
    id: p.id,
    type: p.type,
    isPrimary: p.isPrimary,
    source: p.source,
    phone: maskPhone(p.phoneRaw || p.phoneNormalized, perms.viewSensitive),
    masked: !perms.viewSensitive,
  };
}

export interface BabyLike {
  id: string;
  customerId: string;
  babyName: string | null;
  birthDate: Date | null;
  estimatedBirthMonth: Date | null;
  ageMonthsAtRecording: number | null;
  ageRecordedAt: Date | null;
  datePrecision: string;
  gender: string | null;
  allergies: string | null;
  condition: string | null;
  note: string | null;
  deletedAt: Date | null;
}

/** Serialize hồ sơ bé + TÍNH tuổi hiện tại (BABY-01). Mask theo quyền. */
export function serializeBaby(b: BabyLike, perms: Permissions, now: Date = new Date()) {
  const ageMonths = computeCurrentAgeMonths(
    {
      birthDate: b.birthDate,
      estimatedBirthMonth: b.estimatedBirthMonth,
      ageMonthsAtRecording: b.ageMonthsAtRecording,
      ageRecordedAt: b.ageRecordedAt,
    },
    now,
  );
  const stage = ageStageOf(ageMonths, DEFAULT_ENGINE_CONFIG.baby.ageStageThresholds);
  return {
    id: b.id,
    customerId: b.customerId,
    babyName: maskBabyName(b.babyName, perms.viewBaby),
    birthDate: maskBirthDate(b.birthDate, perms.viewBaby),
    datePrecision: b.datePrecision,
    ageMonths, // tuổi tính động — không phải giá trị lưu tĩnh
    ageStage: stage,
    gender: perms.viewBaby ? b.gender : null,
    allergies: maskSensitiveText(b.allergies, perms.viewBaby),
    condition: maskSensitiveText(b.condition, perms.viewBaby),
    note: perms.viewBaby ? b.note : null,
    deleted: b.deletedAt != null,
    disclaimer: 'Thông tin do khách hàng cung cấp, KHÔNG phải chẩn đoán y tế.',
  };
}

export interface CustomerLike {
  id: string;
  fullName: string;
  displayName: string | null;
  careAddress: string | null;
  retentionStatus: string;
  preferredChannel: string | null;
  note: string | null;
  createdAt: Date;
}

export function serializeCustomerSummary(
  c: CustomerLike & {
    phones?: PhoneLike[];
    roles?: { role: string }[];
    _count?: { babies?: number; externalIdentities?: number };
    lastPurchaseAt?: Date | null;
  },
  perms: Permissions,
) {
  const primaryPhone = (c.phones ?? []).find((p) => p.isPrimary) ?? (c.phones ?? [])[0];
  const roles = (c.roles ?? []).map((r) => r.role);
  return {
    id: c.id,
    displayName: c.displayName ?? c.fullName,
    phone: primaryPhone ? maskPhone(primaryPhone.phoneRaw, perms.viewSensitive) : null,
    roles,
    roleLabel: roleLabel(roles),
    kvLinks: c._count?.externalIdentities ?? 0,
    babyCount: c._count?.babies ?? 0,
    retentionStatus: c.retentionStatus,
    lastPurchaseAt: c.lastPurchaseAt ? formatVnDate(c.lastPurchaseAt) : null,
    masked: !perms.viewSensitive,
  };
}

// ---------- FIX-1: nội dung follow-up KHÔNG lộ tên bé cho vai thiếu quyền ----------

/** Nội dung TRUNG TÍNH (không tên bé) theo loại việc — dùng khi !perms.viewBaby. */
export function neutralFollowUpContent(reminderType: string, targetType: string): string {
  if (targetType === 'organization' || reminderType === 'replenishment' || reminderType === 'agency_investigation') {
    return 'Nhắc nhập bù đại lý';
  }
  return 'Nhắc chăm sóc khách';
}

/**
 * 🔴 FIX-1: `followUp.content` cho cấp confirmed/auto_assigned CHỨA TÊN BÉ.
 * Vai thiếu `viewBaby` (marketing, tro_ly_du_lieu) KHÔNG được nhận nội dung này.
 * Trả nội dung thật khi có quyền; ngược lại thay bằng nội dung trung tính.
 */
export function serializeFollowUpContent(
  perms: Permissions,
  fu: { reminderType: string; targetType: string; content: string | null },
): string {
  if (perms.viewBaby) return fu.content ?? '';
  return neutralFollowUpContent(fu.reminderType, fu.targetType);
}

function roleLabel(roles: string[]): string {
  const retail = roles.includes('retail_customer');
  const wholesale = roles.includes('wholesale_contact');
  if (retail && wholesale) return 'Cả hai (lẻ + sỉ)';
  if (wholesale) return 'Sỉ';
  if (retail) return 'Lẻ';
  return 'Chưa phân loại';
}
