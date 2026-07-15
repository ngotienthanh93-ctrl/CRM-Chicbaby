// Ghi audit_logs APPEND-ONLY (SEC-12). Dữ liệu nhạy cảm trong log phải được MASK/scrub.
// Log KHÔNG chứa SĐT/tên bé/secret/token/OTP (SEC-10/12).
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/** Client ghi được: PrismaClient thường HOẶC transaction client (để audit nằm TRONG cùng transaction). */
type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'otp',
  'secret',
  'sessionsecret',
  'phone',
  'phoneraw',
  'phonenormalized',
  'babyname',
  'birthdate',
  'allergies',
  'condition',
];

/** Scrub đệ quy: che giá trị dưới các key nhạy cảm để không lọt vào log. */
export function scrubSensitive(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(scrubSensitive);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        out[k] = '[ĐÃ ẨN]';
      } else {
        out[k] = scrubSensitive(v);
      }
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  userId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip?: string | null;
  device?: string | null;
}

/**
 * Ghi audit. Truyền `client` = transaction client để audit nằm TRONG cùng transaction với mutation
 * (đảm bảo mutation nhạy cảm + audit cùng commit/rollback — không có mutation "mồ côi" không audit).
 */
export async function writeAudit(input: AuditInput, client: AuditClient = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      oldValue: input.oldValue == null ? undefined : (scrubSensitive(input.oldValue) as object),
      newValue: input.newValue == null ? undefined : (scrubSensitive(input.newValue) as object),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      device: input.device ?? null,
    },
  });
}

/**
 * Ghi audit "best-effort": KHÔNG bao giờ ném lỗi ra ngoài (dùng cho audit PHỤ như feed thông báo).
 * Lý do: các audit này được thêm SAU khi mutation nghiệp vụ đã commit (ngoài transaction); nếu ghi log
 * lỗi thì KHÔNG được để nó làm hỏng thao tác đã thành công (tránh client retry gây double-effect).
 * Audit bảo mật quan trọng vẫn dùng `writeAudit` thường (hoặc trong transaction).
 */
export async function writeAuditBestEffort(
  input: AuditInput,
  client: AuditClient = prisma,
): Promise<void> {
  try {
    await writeAudit(input, client);
  } catch (err) {
    console.error('[audit] best-effort thất bại:', (err as Error)?.message);
  }
}
