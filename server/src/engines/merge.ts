// Gộp khách (§11.3 — MERGE / PHONE / CONSENT). Engine THUẦN (không phụ thuộc Prisma) => test được không cần DB.
// 🔴 Nguyên tắc #7: KHÔNG tự động gộp; chỉ Chủ shop duyệt + nhập lại mật khẩu (router lo phần đó).
// Ở đây chỉ có các phép biến đổi/quyết định thuần: canonical phone, consent-sau-gộp, guard unmerge, preview.
import { normalizePhone } from '../lib/phone';

// ---------- PHONE-01: canonical phone ----------
export interface PhoneInput {
  phoneRaw: string;
  type?: string | null;
  isPrimary?: boolean;
  source?: string | null;
}

export interface CanonicalPhone {
  phoneRaw: string;
  phoneNormalized: string;
  types: string[];
  sources: string[];
  isPrimary: boolean;
}

/**
 * 🔴 PHONE-01: `0912…` và `+84912…` (và `0912.345.678`) là MỘT bản ghi canonical.
 * Gộp theo phoneNormalized: KHÔNG nhân đôi số; gộp nhãn (type) + nguồn (source); isPrimary = có bất kỳ.
 * Thứ tự đầu vào được giữ (bản ghi đầu tiên của mỗi canonical quyết định phoneRaw hiển thị).
 */
export function canonicalizePhones(phones: PhoneInput[]): CanonicalPhone[] {
  const byNorm = new Map<string, CanonicalPhone>();
  for (const p of phones) {
    const norm = normalizePhone(p.phoneRaw);
    if (!norm) continue;
    const existing = byNorm.get(norm);
    if (!existing) {
      byNorm.set(norm, {
        phoneRaw: p.phoneRaw,
        phoneNormalized: norm,
        types: p.type ? [p.type] : [],
        sources: p.source ? [p.source] : [],
        isPrimary: !!p.isPrimary,
      });
      continue;
    }
    if (p.type && !existing.types.includes(p.type)) existing.types.push(p.type);
    if (p.source && !existing.sources.includes(p.source)) existing.sources.push(p.source);
    existing.isPrimary = existing.isPrimary || !!p.isPrimary;
  }
  return [...byNorm.values()];
}

/** Metadata một dòng SĐT ở tầng DB (schema single-column: type/source đơn trị). */
export interface PhoneMetaRow {
  /** PhoneType: primary | zalo | receiver | backup. */
  type: string;
  isPrimary: boolean;
  /** DataSource: KV | CRM. */
  source: string;
}

/**
 * 🔴 FIX-1 / PHONE-01 "gộp nhãn nguồn": khi 2 khách có cùng số CANONICAL, KHÔNG được XÓA
 * bản ghi của merged làm MẤT nhãn — hợp nhất metadata về bản ghi của master.
 * Schema lưu type/source ĐƠN TRỊ ⇒ chọn giá trị deterministic, không mất thông tin ở mức tối đa:
 * - `isPrimary`: union (bất kỳ bên là số chính ⇒ giữ "số chính").
 * - `type`: giữ nhãn CỤ THỂ hơn — nếu master còn là mặc định `primary` mà merged có nhãn khác
 *   (zalo/receiver/backup) ⇒ dùng nhãn merged (tránh mất nhãn). Ngược lại giữ master (master ưu tiên).
 * - `source`: ưu tiên `KV` (nguồn KiotViet — nguồn sự thật giao dịch) khi hai nguồn khác nhau.
 */
export function mergePhoneMetadata(master: PhoneMetaRow, merged: PhoneMetaRow): PhoneMetaRow {
  const isPrimary = master.isPrimary || merged.isPrimary;
  const type = master.type === 'primary' && merged.type !== 'primary' ? merged.type : master.type;
  const source = master.source === 'KV' || merged.source === 'KV' ? 'KV' : master.source;
  return { type, isPrimary, source };
}

// ---------- CONSENT-01: consent sau gộp ----------
export type ConsentStatusStr = 'granted' | 'revoked';

export interface ConsentEventInput {
  /** khóa loại consent (consentTypeId hoặc key). */
  consentKey: string;
  /** khóa đối tượng (customer | baby:<id>) — mặc định 'customer'. */
  subjectKey?: string;
  status: ConsentStatusStr;
  at: Date;
}

export interface ResolvedConsent {
  consentKey: string;
  subjectKey: string;
  status: ConsentStatusStr;
  at: Date;
}

/**
 * 🔴 CONSENT-01: hợp nhất lịch sử consent của 2 khách.
 * Với mỗi (loại consent, đối tượng): SỰ KIỆN HỢP LỆ MỚI NHẤT thắng.
 * Nếu KHÔNG có "đồng ý lại" mới hơn (hoặc trùng mốc thời gian) ⇒ revoked THẮNG (bảo thủ, KHÔNG tự suy diễn).
 * Trả về TRẠNG THÁI HIỆN HÀNH sau gộp cho từng khóa (không phải toàn bộ lịch sử — lịch sử giữ nguyên ở DB).
 */
export function resolveMergedConsent(events: ConsentEventInput[]): ResolvedConsent[] {
  const groups = new Map<string, ConsentEventInput[]>();
  for (const e of events) {
    const subjectKey = e.subjectKey ?? 'customer';
    const key = `${e.consentKey}__${subjectKey}`;
    const arr = groups.get(key) ?? [];
    arr.push({ ...e, subjectKey });
    groups.set(key, arr);
  }

  const out: ResolvedConsent[] = [];
  for (const [, arr] of groups) {
    const maxAt = Math.max(...arr.map((e) => e.at.getTime()));
    const atMax = arr.filter((e) => e.at.getTime() === maxAt);
    // Trùng mốc thời gian mới nhất mà có revoked ⇒ revoked thắng (không tự suy diễn đồng ý lại).
    const status: ConsentStatusStr = atMax.some((e) => e.status === 'revoked')
      ? 'revoked'
      : 'granted';
    const first = arr[0]!;
    out.push({
      consentKey: first.consentKey,
      subjectKey: first.subjectKey!,
      status,
      at: new Date(maxAt),
    });
  }
  return out;
}

// ---------- MERGE-05 / CUS-19: guard cho unmerge ----------
/**
 * 🔴 Chỉ cho TÁCH (unmerge) khi CHƯA phát sinh dữ liệu mới sau thời điểm gộp.
 * `newestDataAt` = mốc tạo mới nhất của mọi dữ liệu gắn với master SAU khi gộp (null = không có).
 * Đã phát sinh dữ liệu mới ⇒ false ⇒ router tạo ticket xử lý tay (không tự tách nguy hiểm).
 */
export function canUnmerge(mergedAt: Date, newestDataAt: Date | null): boolean {
  if (newestDataAt == null) return true;
  return newestDataAt.getTime() <= mergedAt.getTime();
}

// ---------- MERGE preview: so sánh từng trường + tổng kết GIỮ ----------
export interface MergeSideInput {
  id: string;
  fullName: string;
  displayName: string | null;
  facebook: string | null;
  zalo: string | null;
  careAddress: string | null;
  phones: PhoneInput[];
  consentEvents: ConsentEventInput[];
  babyCount: number;
  consultationCount: number;
  kvCodes: string[];
  createdAt: Date;
}

export interface MergeFieldComparison {
  field: string;
  master: string | null;
  merged: string | null;
  resolution: string;
}

export interface MergePreview {
  masterId: string;
  mergedId: string;
  fields: MergeFieldComparison[];
  canonicalPhones: CanonicalPhone[];
  consent: ResolvedConsent[];
  kept: {
    babies: number;
    consultations: number;
    kvCodes: number;
    phones: number;
    consentEvents: number;
  };
  babyMergeNote: string;
  disclaimer: string;
}

/** 🔴 MERGE-07: KHÔNG dùng câu "không mất dữ liệu nào". */
export const MERGE_DISCLAIMER =
  'KHÔNG XÓA dữ liệu nguồn; mọi xung đột được giải quyết hoặc giữ lịch sử.';
export const BABY_MERGE_NOTE =
  'KHÔNG gộp hồ sơ bé — giữ riêng, gắn cờ nghi trùng (suspected_duplicate_baby) để người dùng kiểm tra.';

/** So sánh 1 trường văn bản, ưu tiên giữ giá trị master; nếu master trống mà merged có ⇒ dùng merged. */
function compareField(
  field: string,
  master: string | null,
  merged: string | null,
): MergeFieldComparison {
  let resolution: string;
  if (master && merged && master !== merged) resolution = 'giu_master';
  else if (!master && merged) resolution = 'dung_merged';
  else if (master) resolution = 'giu_master';
  else resolution = 'ca_hai_trong';
  return { field, master, merged, resolution };
}

/**
 * Dựng preview gộp: so sánh từng trường A/B, canonical phone gộp cả 2, consent-sau-gộp,
 * và TỔNG KẾT những gì được GIỮ (bé/tư vấn/mã KV/consent — KHÔNG mất).
 * 🔴 Không gộp bé: kept.babies = tổng bé của cả hai (giữ riêng).
 */
export function buildMergePreview(master: MergeSideInput, merged: MergeSideInput): MergePreview {
  const fields: MergeFieldComparison[] = [
    compareField('fullName', master.fullName, merged.fullName),
    compareField('displayName', master.displayName, merged.displayName),
    compareField('facebook', master.facebook, merged.facebook),
    compareField('zalo', master.zalo, merged.zalo),
    compareField('careAddress', master.careAddress, merged.careAddress),
  ];
  const canonicalPhones = canonicalizePhones([...master.phones, ...merged.phones]);
  const consent = resolveMergedConsent([...master.consentEvents, ...merged.consentEvents]);
  const kvCodes = new Set([...master.kvCodes, ...merged.kvCodes]);
  return {
    masterId: master.id,
    mergedId: merged.id,
    fields,
    canonicalPhones,
    consent,
    kept: {
      // 🔴 GIỮ TẤT CẢ: bé/tư vấn KHÔNG gộp, cộng dồn; consent giữ FULL lịch sử.
      babies: master.babyCount + merged.babyCount,
      consultations: master.consultationCount + merged.consultationCount,
      kvCodes: kvCodes.size,
      phones: canonicalPhones.length,
      consentEvents: master.consentEvents.length + merged.consentEvents.length,
    },
    babyMergeNote: BABY_MERGE_NOTE,
    disclaimer: MERGE_DISCLAIMER,
  };
}
