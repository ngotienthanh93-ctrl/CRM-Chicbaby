// 🔵 KV-05 — ORCHESTRATOR pull KiotViet (Public API): backfill lịch sử (resume qua lastCursor) + poll delta
// (lastModifiedFrom). Fetch từng trang → chuẩn hóa mỗi bản ghi (recordToSyncEvent) → enqueueSyncEvent ⇒ đi CHUNG
// processor + mapper như webhook (idempotent SYNC-03, KHÔNG nhân đôi, KHÔNG đụng dữ liệu CRM — SYNC-24). Phạm vi
// hiện tại: SẢN PHẨM + KHÁCH (shape §7 đã chắc); hóa đơn/trả HOÃN (KV-04) vì tài khoản trả total=0.
//
// TIÊM PHỤ THUỘC (kvGet/enqueue/cursor/now) ⇒ backfillObject/pullDelta unit-test được KHÔNG cần KiotViet/DB thật.
import { prisma } from '../../lib/prisma';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { kiotviet } from '../../lib/kiotviet/client';
import { recordToSyncEvent, type NormalizedSyncEvent } from '../../engines/syncEvent';
import { enqueueSyncEvent, processSyncEventsBatch, type ProcessResult } from './sync.processor';
import {
  acquireGenerationLease,
  releaseGenerationLease,
  renewGenerationLease,
} from '../experiments/generationLock';

/** Loại đối tượng PULL trong phạm vi này (hóa đơn/trả HOÃN — KV-04). */
export type PullObjectType = 'customer' | 'product';

/** Endpoint Public API tương ứng (§7). */
const PULL_OBJECT_PATHS: Record<PullObjectType, string> = {
  customer: '/customers',
  product: '/products',
};

/** Thứ tự backfill: SẢN PHẨM trước, KHÁCH sau (không làm hóa đơn ở phạm vi này). */
const BACKFILL_ORDER: PullObjectType[] = ['product', 'customer'];

/** Lease chống chạy chồng backfill (đa-instance / trùng lượt tay) — RIÊNG khỏi lease sinh việc thí nghiệm. */
const BACKFILL_LEASE = 'sync_backfill';

/** 🔴 CWE-400: TRẦN số trang mỗi lượt pull — chặn upstream lỗi/độc trả `total` dối + trang non-rỗng vô hạn
 * (chạy mãi, phình queue/DB). pageSize 100 ⇒ ~1 triệu record/đối tượng, thừa cho quy mô shop; vượt ⇒ DỪNG an toàn. */
const MAX_PULL_PAGES = 10_000;
/** 🔴 Gia hạn lease mỗi 3' trong lúc backfill CHẠY (< TTL 10') ⇒ lượt dài (rate-limit) KHÔNG bị hết hạn lease. */
const LEASE_RENEW_INTERVAL_MS = 3 * 60 * 1000;

/** Response phân trang KiotViet (§7): `{ total, pageSize, data[] }`. */
interface KvListResponse {
  total?: number;
  pageSize?: number;
  data?: unknown[];
}

/** Phụ thuộc TIÊM cho orchestrator — production nối prisma + kiotviet; test nối mock. */
export interface PullDeps {
  kvGet: <T = unknown>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;
  enqueue: (ev: NormalizedSyncEvent) => Promise<'enqueued' | 'duplicate'>;
  /** Đọc offset resume (SyncState.lastCursor) — 0 nếu chưa có / không hợp lệ. */
  readCursor: (objectType: PullObjectType) => Promise<number>;
  /** Ghi offset resume + mốc đồng bộ sau mỗi trang. cursor=null ⇒ đã hoàn tất (không còn điểm resume). */
  writeCursor: (objectType: PullObjectType, cursor: number | null, at: Date) => Promise<void>;
  /** Đọc mốc đồng bộ gần nhất (SyncState.lastSyncAt) cho delta. */
  readLastSyncAt: (objectType: PullObjectType) => Promise<Date | null>;
  /** Ghi mốc đồng bộ (dùng cho delta). */
  writeLastSyncAt: (objectType: PullObjectType, at: Date) => Promise<void>;
  pageSize: number;
  now: () => Date;
  /** Trần số trang mỗi lượt (mặc định MAX_PULL_PAGES) — tiêm nhỏ lại để test fail-closed. */
  maxPages?: number;
}

/** Kết quả một lượt pull (backfill hoặc delta) của một đối tượng. */
export interface BackfillResult {
  objectType: PullObjectType;
  fetched: number; // số record đọc từ KiotViet
  enqueued: number; // số enqueue MỚI
  duplicate: number; // số trùng (idempotent SYNC-03)
  skipped: number; // số bản ghi dị dạng (thiếu id) ⇒ BỎ, không enqueue
  total: number; // total báo từ response (cuối)
  pages: number; // số trang đã đọc
  capped: boolean; // 🔴 chạm TRẦN trang (MAX_PULL_PAGES) ⇒ dừng an toàn, CÒN dữ liệu chưa nạp (không im lặng)
}

function emptyResult(objectType: PullObjectType): BackfillResult {
  return { objectType, fetched: 0, enqueued: 0, duplicate: 0, skipped: 0, total: 0, pages: 0, capped: false };
}

/**
 * Vòng lặp phân trang dùng chung: fetch từ `startItem`, enqueue từng record, `currentItem += pageSize` tới khi
 * hết total HOẶC gặp trang rỗng (chặn lặp vô hạn nếu total nói dối). `onAfterPage(nextCursor, done)` để lớp trên
 * ghi cursor/mốc. Idempotency + ghi mirror do enqueue/processor lo (không đụng ở đây).
 */
async function drainPages(
  path: string,
  startItem: number,
  extraQuery: Record<string, string | number | undefined>,
  deps: PullDeps,
  res: BackfillResult,
  onAfterPage: (nextCursor: number, done: boolean) => Promise<void>,
): Promise<void> {
  const maxPages = deps.maxPages ?? MAX_PULL_PAGES;
  let currentItem = startItem;
  for (;;) {
    // 🔴 CWE-400: chạm trần trang ⇒ DỪNG (fail-closed), đánh cờ capped để lớp trên/UI biết còn dữ liệu chưa nạp.
    if (res.pages >= maxPages) {
      res.capped = true;
      break;
    }
    const page = await deps.kvGet<KvListResponse>(path, { ...extraQuery, pageSize: deps.pageSize, currentItem });
    const records = Array.isArray(page.data) ? page.data : [];
    const total = Number(page.total);
    const hasTotal = Number.isFinite(total);
    if (hasTotal) res.total = total;

    for (const record of records) {
      res.fetched++;
      const ev = recordToSyncEvent(res.objectType, record);
      // 🔴 Bản ghi thiếu id ⇒ objectId rỗng ⇒ BỎ (không enqueue): tránh ghi mirror sai khóa (SYNC-03).
      if (!ev.objectId) {
        res.skipped++;
        continue;
      }
      const outcome = await deps.enqueue(ev);
      if (outcome === 'enqueued') res.enqueued++;
      else res.duplicate++;
    }
    res.pages++;
    currentItem += deps.pageSize;

    // Hết dữ liệu khi: trang rỗng (lưới an toàn) HOẶC đã vượt total báo từ API.
    const done = records.length === 0 || (hasTotal && currentItem >= total);
    await onAfterPage(currentItem, done);
    if (done) break;
  }
}

/**
 * BACKFILL một đối tượng: resume từ SyncState.lastCursor, phân trang tới hết total. Sau MỖI trang ghi cursor
 * (offset kế tiếp) + lastSyncAt ⇒ Tạm dừng/Dừng an toàn rồi resume KHÔNG mất/không nhân đôi (SYNC-02). Hoàn tất
 * ⇒ cursor=null (không còn điểm resume; lần backfill sau chạy lại từ đầu, idempotent theo id KV).
 */
export async function backfillObject(objectType: PullObjectType, deps: PullDeps): Promise<BackfillResult> {
  const res = emptyResult(objectType);
  const start = await deps.readCursor(objectType);
  await drainPages(PULL_OBJECT_PATHS[objectType], start, {}, deps, res, async (nextCursor, done) => {
    await deps.writeCursor(objectType, done ? null : nextCursor, deps.now());
  });
  return res;
}

/** Định dạng mốc cho tham số `lastModifiedFrom` của KiotViet (ISO 8601). */
function toLastModifiedFrom(since: Date | null): string | undefined {
  return since ? since.toISOString() : undefined;
}

/**
 * PULL DELTA: chỉ lấy record đổi từ SyncState.lastSyncAt (lastModifiedFrom). Cập nhật mốc = thời điểm BẮT ĐẦU
 * pull (chốt trước khi fetch) ⇒ tránh sót record đổi trong lúc pull. KHÔNG dùng cursor (delta luôn quét từ đầu
 * tập đã lọc). Đi chung enqueue/processor như backfill.
 *
 * ⚠️ CHƯA ĐƯỢC LÊN LỊCH (KV-06). Watermark hiện dùng chung `SyncState.lastSyncAt` — MÀ processor
 * (processSyncEventsBatch) cũng đẩy `lastSyncAt=now()` mỗi sự kiện cho mục "đồng bộ lần cuối". Nếu lên lịch delta
 * ngay, record đổi TRONG lúc backfill/xử lý có thể bị bỏ (TOCTOU, security review #1). KV-06 phải tách MỘT field
 * watermark RIÊNG (migration, processor không đụng) = thời điểm bắt đầu pull, TRƯỚC khi bật poll delta tự động.
 */
export async function pullDelta(objectType: PullObjectType, deps: PullDeps): Promise<BackfillResult> {
  const res = emptyResult(objectType);
  const since = await deps.readLastSyncAt(objectType);
  const startedAt = deps.now();
  const extraQuery = { lastModifiedFrom: toLastModifiedFrom(since) };
  await drainPages(PULL_OBJECT_PATHS[objectType], 0, extraQuery, deps, res, async () => {
    /* delta không ghi cursor từng trang; mốc cập nhật một lần sau khi xong */
  });
  await deps.writeLastSyncAt(objectType, startedAt);
  return res;
}

// ============================================================
// Wiring production — nối prisma + kiotviet.
// ============================================================

/** Đọc page size active (fallback DEFAULT). KiotViet trần 100/trang. */
async function activePageSize(): Promise<number> {
  const row = await prisma.configurationVersion.findFirst({ where: { key: 'sync.page_size', isActive: true } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ENGINE_CONFIG.sync.pageSize;
}

async function readCursor(objectType: PullObjectType): Promise<number> {
  const st = await prisma.syncState.findUnique({ where: { objectType } });
  const n = st?.lastCursor != null ? Number(st.lastCursor) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function writeCursor(objectType: PullObjectType, cursor: number | null, at: Date): Promise<void> {
  const lastCursor = cursor == null ? null : String(cursor);
  await prisma.syncState.upsert({
    where: { objectType },
    create: { objectType, lastCursor, lastSyncAt: at },
    update: { lastCursor, lastSyncAt: at },
  });
}

async function readLastSyncAt(objectType: PullObjectType): Promise<Date | null> {
  const st = await prisma.syncState.findUnique({ where: { objectType } });
  return st?.lastSyncAt ?? null;
}

async function writeLastSyncAt(objectType: PullObjectType, at: Date): Promise<void> {
  await prisma.syncState.upsert({
    where: { objectType },
    create: { objectType, lastSyncAt: at },
    update: { lastSyncAt: at },
  });
}

/** Deps production — client thật + prisma. */
async function productionPullDeps(): Promise<PullDeps> {
  const pageSize = await activePageSize();
  return {
    kvGet: (path, query) => kiotviet.kvGet(path, query),
    enqueue: enqueueSyncEvent,
    readCursor,
    writeCursor,
    readLastSyncAt,
    writeLastSyncAt,
    pageSize,
    now: () => new Date(),
  };
}

/** Kết quả runBackfill. `ran=false` ⇒ không giành được lease (đang có lượt khác). */
export interface RunBackfillResult {
  ran: boolean;
  objects: BackfillResult[];
  processed?: ProcessResult;
}

/**
 * Chạy backfill TUẦN TỰ sản phẩm → khách (có lease chống chạy chồng), rồi RÚT hàng đợi 1 lượt (worker theo lịch
 * rút phần còn lại). Idempotent theo id KV (upsert), KHÔNG nhân đôi, KHÔNG đụng dữ liệu CRM (SYNC-24).
 * `deps` tiêm được cho test/kịch bản đặc biệt; production tự nối prisma + kiotviet.
 */
/** Kết quả BẮT ĐẦU backfill. `started=false` ⇒ KHÔNG giành được lease (đang có lượt khác). */
export interface BeginBackfillResult {
  started: boolean;
  /** Chạy phần NẶNG (fetch/enqueue/process) rồi NHẢ lease. Chỉ có khi started=true. */
  run?: () => Promise<RunBackfillResult>;
  /** NHẢ lease NGAY mà KHÔNG chạy — dùng khi handler hủy sau khi đã giành lease (vd audit lỗi) ⇒ tránh kẹt lease tới TTL. */
  release?: () => Promise<void>;
}

/**
 * GIÀNH lease ĐỒNG BỘ (nhanh) rồi trả thunk `run()` để chạy phần nặng ở NỀN. Nhờ vậy handler biết NGAY có thật
 * sự bắt đầu không (`started`) ⇒ trả 202/409 đúng, KHÔNG báo "đã bắt đầu" khi lượt khác đang giữ lease. `run()`
 * tự NHẢ lease khi xong. Reset cursor (full-resync) nằm trong run() ⇒ chỉ mutate khi đã giành lease (SYNC-24).
 */
export async function beginBackfill(
  deps?: PullDeps,
  opts?: { resetCursors?: boolean },
): Promise<BeginBackfillResult> {
  const token = await acquireGenerationLease('sync_backfill', BACKFILL_LEASE);
  if (!token) return { started: false }; // đang có lượt khác ⇒ KHÔNG mutate sync_state
  const release = () => releaseGenerationLease(token, BACKFILL_LEASE);
  // 🔴 Đã giành lease: MỌI bước setup (đọc config productionPullDeps) phải nằm trong try — lỗi ⇒ nhả lease NGAY,
  // không kẹt tới TTL. (run() tự nhả ở finally cho đường thành công.)
  try {
    const d = deps ?? (await productionPullDeps());
    const run = async (): Promise<RunBackfillResult> => {
      // 🔴 CWE-362: gia hạn lease định kỳ khi đang chạy ⇒ lượt DÀI (rate-limit) không hết TTL để lượt khác chen vào.
      const heartbeat = setInterval(() => {
        void renewGenerationLease(token, BACKFILL_LEASE).catch(() => {});
      }, LEASE_RENEW_INTERVAL_MS);
      if (typeof heartbeat.unref === 'function') heartbeat.unref(); // không giữ process sống chỉ vì heartbeat
      try {
        if (opts?.resetCursors) {
          for (const objectType of BACKFILL_ORDER) await d.writeCursor(objectType, null, d.now());
        }
        const objects: BackfillResult[] = [];
        for (const objectType of BACKFILL_ORDER) {
          objects.push(await backfillObject(objectType, d));
        }
        const processed = await processSyncEventsBatch();
        return { ran: true, objects, processed };
      } finally {
        clearInterval(heartbeat);
        await release();
      }
    };
    return { started: true, run, release };
  } catch (e) {
    await release().catch(() => {});
    throw e;
  }
}

/** Chạy backfill ĐỒNG BỘ (giành lease → chạy → nhả). Dùng cho test / kịch bản cần CHỜ kết quả. */
export async function runBackfill(
  deps?: PullDeps,
  opts?: { resetCursors?: boolean },
): Promise<RunBackfillResult> {
  const begun = await beginBackfill(deps, opts);
  if (!begun.started) return { ran: false, objects: [] };
  return begun.run!();
}
