// 🔵 KV-05 — Test ORCHESTRATOR backfill/delta bằng PHỤ THUỘC TIÊM (mock kvGet/enqueue/cursor), KHÔNG DB, KHÔNG
// gọi KiotViet thật. Kiểm: phân trang đủ record, cursor cập nhật + resume, dừng đúng khi hết total, delta lọc mốc.
import { describe, it, expect } from 'vitest';
import { backfillObject, pullDelta, type PullDeps, type PullObjectType } from './pull.service';
import type { NormalizedSyncEvent } from '../../engines/syncEvent';

interface Rec {
  id: number;
  modifiedDate?: string;
}

const NOW_MS = 1_700_000_000_000;

/** Harness: dataset đầy đủ → kvGet cắt lát theo currentItem/pageSize; ghi lại enqueue + cursor + lastSyncAt. */
function harness(opts: {
  records: Rec[];
  total: number;
  pageSize: number;
  startCursor?: number;
  lastSyncAt?: Date | null;
  enqueueResult?: (ev: NormalizedSyncEvent) => 'enqueued' | 'duplicate';
  maxPages?: number;
  infinite?: boolean; // luôn trả trang non-rỗng (mô phỏng upstream total nói dối)
}) {
  const kvGetCalls: { path: string; query: Record<string, unknown> }[] = [];
  const enqueued: NormalizedSyncEvent[] = [];
  const cursorWrites: { objectType: string; cursor: number | null; at: Date }[] = [];
  const lastSyncWrites: { objectType: string; at: Date }[] = [];

  const deps: PullDeps = {
    kvGet: (async (path: string, query?: Record<string, string | number | undefined>) => {
      kvGetCalls.push({ path, query: query ?? {} });
      const currentItem = Number(query?.currentItem ?? 0);
      const data = opts.infinite
        ? Array.from({ length: opts.pageSize }, (_, i) => ({ id: currentItem + i + 1 }))
        : opts.records.slice(currentItem, currentItem + opts.pageSize);
      return { total: opts.total, pageSize: opts.pageSize, data };
    }) as PullDeps['kvGet'],
    enqueue: async (ev) => {
      enqueued.push(ev);
      return opts.enqueueResult ? opts.enqueueResult(ev) : 'enqueued';
    },
    readCursor: async () => opts.startCursor ?? 0,
    writeCursor: async (objectType, cursor, at) => {
      cursorWrites.push({ objectType, cursor, at });
    },
    readLastSyncAt: async () => opts.lastSyncAt ?? null,
    writeLastSyncAt: async (objectType, at) => {
      lastSyncWrites.push({ objectType, at });
    },
    pageSize: opts.pageSize,
    now: () => new Date(NOW_MS),
    maxPages: opts.maxPages,
  };
  return { deps, kvGetCalls, enqueued, cursorWrites, lastSyncWrites };
}

const OBJ: PullObjectType = 'product';

describe('KV-05 · backfillObject', () => {
  it('phân trang đủ record qua nhiều trang, dừng khi currentItem >= total', async () => {
    const h = harness({
      records: [
        { id: 1, modifiedDate: '2026-07-01T00:00:00Z' },
        { id: 2, modifiedDate: '2026-07-02T00:00:00Z' },
        { id: 3, modifiedDate: '2026-07-03T00:00:00Z' },
      ],
      total: 3,
      pageSize: 2,
    });
    const res = await backfillObject(OBJ, h.deps);

    expect(h.enqueued.map((e) => e.objectId)).toEqual(['1', '2', '3']);
    expect(h.enqueued.every((e) => e.objectType === 'product')).toBe(true);
    // Gọi 2 trang: currentItem 0 rồi 2; KHÔNG gọi trang thừa (currentItem 4 >= total).
    expect(h.kvGetCalls.map((c) => c.query.currentItem)).toEqual([0, 2]);
    expect(h.kvGetCalls[0]!.path).toBe('/products');
    expect(res).toMatchObject({ objectType: 'product', fetched: 3, enqueued: 3, duplicate: 0, pages: 2, total: 3 });
  });

  it('cursor cập nhật sau mỗi trang; hoàn tất ⇒ null (không còn điểm resume)', async () => {
    const h = harness({
      records: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 3,
      pageSize: 2,
    });
    await backfillObject(OBJ, h.deps);
    // Sau trang 1 (offset kế = 2) ⇒ 2; sau trang 2 (hoàn tất) ⇒ null.
    expect(h.cursorWrites.map((c) => c.cursor)).toEqual([2, null]);
    expect(h.cursorWrites.every((c) => c.at.getTime() === NOW_MS)).toBe(true);
  });

  it('RESUMABLE: đọc lastCursor để tiếp, KHÔNG nạp lại trang đã xong (SYNC-02)', async () => {
    const h = harness({
      records: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 3,
      pageSize: 2,
      startCursor: 2, // đã xong trang 1, resume từ offset 2
    });
    await backfillObject(OBJ, h.deps);
    expect(h.kvGetCalls[0]!.query.currentItem).toBe(2); // bắt đầu ngay từ offset resume
    expect(h.enqueued.map((e) => e.objectId)).toEqual(['3']); // chỉ record còn lại, không nhân đôi
  });

  it('trùng (duplicate) KHÔNG tính vào enqueued', async () => {
    const h = harness({
      records: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 3,
      pageSize: 10,
      enqueueResult: (ev) => (ev.objectId === '2' ? 'duplicate' : 'enqueued'),
    });
    const res = await backfillObject(OBJ, h.deps);
    expect(res.fetched).toBe(3);
    expect(res.enqueued).toBe(2);
    expect(res.duplicate).toBe(1);
  });

  it('bản ghi thiếu id ⇒ BỎ QUA (skipped), KHÔNG enqueue (tránh ghi mirror sai khóa)', async () => {
    const h = harness({
      records: [{ id: 1 }, {} as Rec, { id: 3 }], // record giữa thiếu id
      total: 3,
      pageSize: 10,
    });
    const res = await backfillObject(OBJ, h.deps);
    expect(h.enqueued.map((e) => e.objectId)).toEqual(['1', '3']); // bỏ record thiếu id
    expect(res.fetched).toBe(3);
    expect(res.enqueued).toBe(2);
    expect(res.skipped).toBe(1);
  });

  it('trang rỗng ⇒ dừng an toàn (không lặp vô hạn kể cả total nói dối)', async () => {
    const h = harness({ records: [], total: 10, pageSize: 5 });
    const res = await backfillObject(OBJ, h.deps);
    expect(h.kvGetCalls).toHaveLength(1); // gọi 1 lần thấy rỗng ⇒ dừng
    expect(res).toMatchObject({ fetched: 0, enqueued: 0, pages: 1 });
    expect(h.cursorWrites.map((c) => c.cursor)).toEqual([null]);
  });

  it('TRẦN trang: total nói dối + trang non-rỗng vô hạn ⇒ DỪNG ở maxPages, capped=true (CWE-400)', async () => {
    const h = harness({ records: [], total: 999_999, pageSize: 2, infinite: true, maxPages: 3 });
    const res = await backfillObject(OBJ, h.deps);
    expect(h.kvGetCalls).toHaveLength(3); // dừng đúng ở trần, không chạy mãi
    expect(res.pages).toBe(3);
    expect(res.capped).toBe(true);
  });
});

describe('KV-05 · pullDelta', () => {
  it('lastModifiedFrom = SyncState.lastSyncAt (ISO); cập nhật mốc = thời điểm bắt đầu pull', async () => {
    const since = new Date('2026-07-01T00:00:00.000Z');
    const h = harness({
      records: [{ id: 5, modifiedDate: '2026-07-10T00:00:00Z' }],
      total: 1,
      pageSize: 100,
      lastSyncAt: since,
    });
    const res = await pullDelta('customer', h.deps);
    expect(h.kvGetCalls[0]!.query.lastModifiedFrom).toBe('2026-07-01T00:00:00.000Z');
    expect(h.enqueued.map((e) => e.objectId)).toEqual(['5']);
    expect(res.fetched).toBe(1);
    // Mốc mới = now() (bắt đầu pull), tránh sót record đổi trong lúc pull.
    expect(h.lastSyncWrites).toHaveLength(1);
    expect(h.lastSyncWrites[0]!.at.getTime()).toBe(NOW_MS);
  });

  it('chưa có lastSyncAt ⇒ không gắn lastModifiedFrom (lấy toàn bộ theo delta lần đầu)', async () => {
    const h = harness({ records: [{ id: 9 }], total: 1, pageSize: 100, lastSyncAt: null });
    await pullDelta('customer', h.deps);
    expect(h.kvGetCalls[0]!.query.lastModifiedFrom).toBeUndefined();
  });
});
