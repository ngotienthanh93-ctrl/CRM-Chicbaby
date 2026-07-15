// 🔴 §11.4 / SYNC — Worker XỬ LÝ hàng đợi sync_events (CHỜ API THẬT). Cơ chế hàng đợi HOÀN CHỈNH
// (idempotent enqueue SYNC-03 · claim chống double-process · retry/dead-letter theo trần · cập nhật sync_state).
// Phần CHỜ SPIKE = ánh xạ payload→mirror cho hóa đơn/dòng/trả (quan hệ phức tạp): handler stub ném lỗi rõ ràng,
// sự kiện sẽ dead-letter (hiện ở dashboard) cho tới khi có mapping. Khách/Sản phẩm đã có handler THAM CHIẾU.
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import {
  nextStatusAfterFailure,
  type NormalizedSyncEvent,
  type SyncObjectType,
} from '../../engines/syncEvent';

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Khóa idempotency canonical KHÔNG-NULL cho một sự kiện (SYNC-03). kvModifiedAt→epoch ms | 'NULL'. */
export function syncIdempotencyKey(ev: NormalizedSyncEvent): string {
  const t = ev.kvModifiedAt ? String(ev.kvModifiedAt.getTime()) : 'NULL';
  return JSON.stringify([ev.objectType, ev.objectId, t]);
}

/**
 * Enqueue một sự kiện — IDEMPOTENT chắc chắn theo idempotencyKey (SYNC-03): create trực tiếp rồi bắt P2002
 * (unique trên cột non-null) ⇒ webhook giao lại (kể cả đua song song, kể cả kvModifiedAt null) KHÔNG nhân đôi.
 */
export async function enqueueSyncEvent(ev: NormalizedSyncEvent): Promise<'enqueued' | 'duplicate'> {
  // (a) Đã có sự kiện cùng (objectType, objectId, kvModifiedAt)? findFirst theo TUPLE bắt được cả HÀNG CŨ trước
  //     migration (idempotencyKey backfill = id, khác format canonical) — độc lập format khóa.
  const existing = await prisma.syncEvent.findFirst({
    where: { objectType: ev.objectType, objectId: ev.objectId, kvModifiedAt: ev.kvModifiedAt },
    select: { id: true },
  });
  if (existing) return 'duplicate';
  // (b) Tạo mới với canonical idempotencyKey non-null. Unique key + bắt P2002 = LƯỚI CHỐNG RACE (2 webhook
  //     null-kvModifiedAt song song: findFirst đều trượt nhưng cùng canonical key ⇒ một P2002 ⇒ duplicate).
  try {
    await prisma.syncEvent.create({
      data: {
        objectType: ev.objectType,
        objectId: ev.objectId,
        kvModifiedAt: ev.kvModifiedAt,
        idempotencyKey: syncIdempotencyKey(ev),
        eventId: ev.eventId,
        payload: (ev.payload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
    return 'enqueued';
  } catch (e) {
    if (isUniqueViolation(e)) return 'duplicate'; // đã có sự kiện cùng khóa ⇒ idempotent
    throw e;
  }
}

/** ⚙️ Đọc cấu hình worker active (fallback DEFAULT). */
async function activeSyncProcessorConfig(): Promise<{ batchSize: number; maxAttempts: number }> {
  const rows = await prisma.configurationVersion.findMany({
    where: { key: { in: ['sync.processor_batch_size', 'sync.max_sync_attempts'] }, isActive: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const bs = byKey.get('sync.processor_batch_size');
  const ma = byKey.get('sync.max_sync_attempts');
  return {
    batchSize: Number.isFinite(bs) ? (bs as number) : DEFAULT_ENGINE_CONFIG.sync.processorBatchSize,
    maxAttempts: Number.isFinite(ma) ? (ma as number) : DEFAULT_ENGINE_CONFIG.sync.maxSyncAttempts,
  };
}

/** Ngữ cảnh xử lý một sự kiện: objectId + kvModifiedAt lấy từ ENVELOPE (đã ký), payload = data. */
interface HandlerCtx {
  objectId: string;
  kvModifiedAt: Date | null;
  payload: unknown;
}
/** Handler ánh xạ → mirror kv_*. Chạy TRONG transaction (tx) để done+mirror nguyên tử. */
type KvMirrorHandler = (ctx: HandlerCtx, tx: Prisma.TransactionClient) => Promise<void>;

/**
 * Sự kiện có nên BỎ QUA ghi (đến trễ)? Chống event cũ ghi đè dữ liệu mới HOẶC reset mốc về null:
 * - chưa có mirror (current null) ⇒ KHÔNG stale (luôn ghi lần đầu).
 * - mirror ĐÃ có mốc mà event KHÔNG có mốc (incoming null) ⇒ STALE (không cho event vô-mốc ghi đè/reset).
 * - cả hai có mốc ⇒ stale khi incoming < current.
 */
function isStale(incoming: Date | null, current: Date | null | undefined): boolean {
  if (!current) return false;
  if (!incoming) return true;
  return incoming.getTime() < current.getTime();
}

/** Lỗi "chưa map" (chờ API Spike) — phân biệt với lỗi vận hành. */
class NotMappedError extends Error {}

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload == null || typeof payload !== 'object') throw new Error('Payload webhook rỗng/không hợp lệ.');
  return payload as Record<string, unknown>;
}
/** Lấy giá trị theo NHIỀU tên khóa (KiotViet dùng PascalCase; ta chấp cả camelCase) — trả string|null. */
function pick(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k];
    if (v != null && v !== '') return String(v);
  }
  return null;
}
function pickBool(p: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) if (p[k] === true || p[k] === 'true' || p[k] === 1) return true;
  return false;
}
/** Lấy giá trị SỐ theo nhiều tên khóa — trả number|null. Giữ 0 (giá hợp lệ), bỏ '' / null / NaN. */
function pickNumber(p: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
/** §7: sản phẩm bị vô hiệu khi isActive === false. THIẾU cờ ⇒ KHÔNG suy ra deleted (an toàn). */
function isInactive(p: Record<string, unknown>): boolean {
  for (const k of ['isActive', 'IsActive']) {
    const v = p[k];
    if (v === false || v === 'false' || v === 0) return true;
    if (v === true || v === 'true' || v === 1) return false;
  }
  return false;
}

// 🔵 KV-03 — MAPPER THUẦN (test được, không DB): payload KiotViet → trường mirror kv_*. Chốt theo SHAPE THẬT §7
// (KIOTVIET-INTEGRATION-PLAN.md). pick() phòng thủ PascalCase (webhook) + camelCase (pull) ⇒ MỘT mapping dùng
// chung cả pull lẫn webhook. kvModifiedAt KHÔNG nằm ở đây — lấy từ ENVELOPE (đã ký / recordToSyncEvent) ở handler.

/** Trường mirror KvProduct suy từ payload (trừ kvModifiedAt lấy từ envelope). */
export interface ProductMirrorFields {
  code: string | null;
  name: string;
  unit: string | null;
  price: number | null;
  categoryId: string | null;
  kvDeleted: boolean;
}
export function mapProduct(payload: unknown): ProductMirrorFields {
  const p = asRecord(payload);
  return {
    code: pick(p, 'code', 'Code'),
    // §7: có cả name & fullName ⇒ ưu tiên name, fallback fullName.
    name: pick(p, 'name', 'Name', 'fullName', 'FullName') ?? '(không tên)',
    // §7: KiotViet KHÔNG trả unit ⇒ null; pick phòng thủ nếu webhook có gửi.
    unit: pick(p, 'unit', 'Unit'),
    // §7: basePrice (số) → cột Decimal.
    price: pickNumber(p, 'basePrice', 'BasePrice'),
    // §7: categoryId (số) → String.
    categoryId: pick(p, 'categoryId', 'CategoryId'),
    // §7: kvDeleted = !isActive (hoặc cờ isDeleted phòng thủ từ webhook).
    kvDeleted: pickBool(p, 'isDeleted', 'IsDeleted', '_deleted') || isInactive(p),
  };
}

/** Trường mirror KvCustomer suy từ payload (trừ kvModifiedAt lấy từ envelope). */
export interface CustomerMirrorFields {
  code: string | null;
  name: string;
  phone: string | null;
  customerGroup: string | null;
  address: string | null;
  kvDeleted: boolean;
}
export function mapCustomer(payload: unknown): CustomerMirrorFields {
  const p = asRecord(payload);
  return {
    code: pick(p, 'code', 'Code'),
    name: pick(p, 'name', 'Name') ?? '(không tên)',
    // §7: SĐT ở contactNumber; phone/Phone phòng thủ cho webhook.
    phone: pick(p, 'contactNumber', 'ContactNumber', 'phone', 'Phone'),
    // §7: response khách KHÔNG có nhóm ⇒ null; pick phòng thủ nếu webhook gửi.
    customerGroup: pick(p, 'customerGroup', 'CustomerGroup', 'groupName', 'GroupName'),
    address: pick(p, 'address', 'Address'),
    kvDeleted: pickBool(p, 'isDeleted', 'IsDeleted', '_deleted'),
  };
}

// 🔴 Handler khách + sản phẩm. Khóa mirror = objectId từ ENVELOPE (recordToSyncEvent / webhook đã ký) — KHÔNG
// dùng payload.id (chống payload lệch ghi sang bản ghi khác). Trường ánh xạ qua mapper thuần KV-03 (dùng chung
// pull + webhook). Stale-check: sự kiện đến trễ KHÔNG ghi đè dữ liệu mới hơn. kvModifiedAt lấy từ envelope.
const handleCustomer: KvMirrorHandler = async ({ objectId, kvModifiedAt, payload }, tx) => {
  const current = await tx.kvCustomer.findUnique({ where: { kvCustomerId: objectId }, select: { kvModifiedAt: true } });
  if (isStale(kvModifiedAt, current?.kvModifiedAt)) return; // event cũ hơn ⇒ bỏ qua
  const data = { ...mapCustomer(payload), kvModifiedAt };
  await tx.kvCustomer.upsert({ where: { kvCustomerId: objectId }, create: { kvCustomerId: objectId, ...data }, update: data });
};

const handleProduct: KvMirrorHandler = async ({ objectId, kvModifiedAt, payload }, tx) => {
  const current = await tx.kvProduct.findUnique({ where: { kvProductId: objectId }, select: { kvModifiedAt: true } });
  if (isStale(kvModifiedAt, current?.kvModifiedAt)) return;
  const data = { ...mapProduct(payload), kvModifiedAt };
  await tx.kvProduct.upsert({ where: { kvProductId: objectId }, create: { kvProductId: objectId, ...data }, update: data });
};

// 🔴 CHỜ SPIKE: hóa đơn/dòng/trả có quan hệ (khách↔hóa đơn↔dòng↔sản phẩm) — cần shape payload thật để map an
// toàn (không đoán). Stub ném NotMappedError ⇒ sự kiện dead-letter, hiện ở dashboard là "cần mapping".
const notMapped: KvMirrorHandler = async () => {
  throw new NotMappedError('Chưa có ánh xạ payload→mirror cho loại này (chờ API Spike KiotViet).');
};

export const KV_MIRROR_HANDLERS: Record<SyncObjectType, KvMirrorHandler> = {
  customer: handleCustomer,
  product: handleProduct,
  invoice: notMapped,
  invoice_line: notMapped,
  return: notMapped,
};

export interface ProcessResult {
  claimed: number;
  done: number;
  retryable: number;
  deadLettered: number;
}

/**
 * Xử lý một LƯỢT hàng đợi: lấy tối đa `batchSize` sự kiện pending (cũ trước), CLAIM từng cái (updateMany
 * where status=pending ⇒ chống 2 tick/instance xử lý trùng), chạy handler trong transaction, đánh dấu
 * done / error (retry) / dead_letter theo `maxAttempts`. KHÔNG ném ra ngoài (mỗi sự kiện tự cô lập lỗi).
 */
/** Sự kiện 'processing' lâu hơn mốc này ⇒ coi là KẸT (tiến trình crash giữa chừng) và được reclaim. */
const STALE_PROCESSING_MS = 5 * 60 * 1000;

export async function processSyncEventsBatch(opts?: {
  batchSize?: number;
  maxAttempts?: number;
}): Promise<ProcessResult> {
  const cfg = await activeSyncProcessorConfig();
  const batchSize = opts?.batchSize ?? cfg.batchSize;
  const maxAttempts = opts?.maxAttempts ?? cfg.maxAttempts;
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  // 🔴 Lấy: pending + error CÒN DƯỚI TRẦN (retry) + processing KẸT (reclaim sau crash). Cũ trước.
  const candidates = await prisma.syncEvent.findMany({
    where: {
      OR: [
        { status: { in: ['pending', 'error'] }, attempts: { lt: maxAttempts } },
        { status: 'processing', updatedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true, objectType: true, objectId: true, kvModifiedAt: true, payload: true, attempts: true, status: true, updatedAt: true },
  });

  const result: ProcessResult = { claimed: 0, done: 0, retryable: 0, deadLettered: 0 };
  for (const ev of candidates) {
    // 🔴 CLAIM nguyên tử: chỉ nhận nếu VẪN ở đúng trạng thái vừa đọc (chống 2 tick/instance tranh nhau).
    // Với 'processing' kẹt: ràng thêm updatedAt cũ ⇒ tick đầu bump updatedAt (qua @updatedAt) đẩy ra khỏi
    // cửa sổ stale, tick sau không claim được.
    const claim = await prisma.syncEvent.updateMany({
      where:
        ev.status === 'processing'
          ? { id: ev.id, status: 'processing', updatedAt: { lt: staleBefore } }
          : { id: ev.id, status: ev.status },
      data: { status: 'processing' },
    });
    if (claim.count !== 1) continue;
    result.claimed++;

    try {
      const handler = KV_MIRROR_HANDLERS[ev.objectType as SyncObjectType];
      if (!handler) throw new NotMappedError(`Không có handler cho objectType=${ev.objectType}.`);
      // 🔴 NGUYÊN TỬ: ghi mirror + đánh dấu done + cập nhật sync_state trong CÙNG một transaction ⇒ không có
      // trạng thái "mirror đã ghi nhưng event chưa done" (nếu lỗi ⇒ rollback hết, event xử lý catch bên dưới).
      await prisma.$transaction(async (tx) => {
        await handler({ objectId: ev.objectId, kvModifiedAt: ev.kvModifiedAt, payload: ev.payload }, tx);
        await tx.syncEvent.update({ where: { id: ev.id }, data: { status: 'done', error: null } });
        await tx.syncState.upsert({
          where: { objectType: ev.objectType },
          create: { objectType: ev.objectType, lastSyncAt: new Date() },
          update: { lastSyncAt: new Date() },
        });
      });
      result.done++;
    } catch (e) {
      const attempts = ev.attempts + 1;
      const status = nextStatusAfterFailure(attempts, maxAttempts);
      await prisma.syncEvent.update({
        where: { id: ev.id },
        data: { status, attempts, error: e instanceof Error ? e.message : String(e) },
      });
      if (status === 'dead_letter') result.deadLettered++;
      else result.retryable++;
    }
  }
  return result;
}
