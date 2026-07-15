// 🔵 KV-02 — Test client KiotViet Public API bằng phụ thuộc TIÊM (mock fetch + clock), KHÔNG chạm API/DB thật.
import { describe, it, expect } from 'vitest';
import {
  createKiotVietClient,
  retailerFromToken,
  KiotVietApiError,
  KiotVietNotConfiguredError,
  type KiotVietClientDeps,
} from './client';

/** Token giả dạng JWT có claim client_RetailerCode (để test lấy retailer từ token). */
function tokenResWithRetailer(retailerCode: string): Response {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'none' })}.${b64({ client_RetailerCode: retailerCode })}.sig`;
  return fakeRes(200, { access_token: jwt, expires_in: 3600 });
}

/** Một response giả kiểu fetch Response (chỉ phần client dùng: ok/status/json/headers.get). */
function fakeRes(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
  } as unknown as Response;
}

const tokenRes = (accessToken = 'tok-1', expiresIn = 3600) =>
  fakeRes(200, { access_token: accessToken, expires_in: expiresIn });

/** Harness: hàng đợi response lập trình sẵn + ghi lại mọi lời gọi + clock/sleep điều khiển được. */
function harness(
  responses: (Response | Error)[],
  opts?: { rpm?: number; startMs?: number; credsError?: Error },
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const sleeps: number[] = [];
  let clock = opts?.startMs ?? 1_000_000;
  let idx = 0;

  const deps: KiotVietClientDeps = {
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = responses[idx++];
      if (!r) throw new Error(`fetch gọi quá số response lập trình (idx=${idx})`);
      if (r instanceof Error) throw r; // giả lập lỗi mạng / timeout
      return r;
    }) as unknown as typeof fetch,
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms; // sleep giả LÀM TRÔI clock ⇒ test refresh/spacer tất định
    },
    loadCredentials: async () => {
      if (opts?.credsError) throw opts.credsError;
      return { clientId: 'cid-123456', clientSecret: 'SECRET-do-not-leak', retailer: 'chicbabyshop' };
    },
    loadConfig: async () => ({
      baseUrl: 'https://public.kiotviet.vn/',
      tokenEndpoint: 'https://id.kiotviet.vn/connect/token',
      maxRequestsPerMinute: opts?.rpm ?? 6000,
    }),
  };
  const client = createKiotVietClient(deps);
  return {
    client,
    calls,
    sleeps,
    tokenCalls: () => calls.filter((c) => c.url.includes('connect/token')).length,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('KV-02 · KiotVietClient', () => {
  it('cache token: 2 lần kvGet chỉ lấy token 1 lần', async () => {
    const h = harness([tokenRes(), fakeRes(200, { data: [1] }), fakeRes(200, { data: [2] })]);
    await h.client.kvGet('/customers');
    await h.client.kvGet('/products');
    expect(h.tokenCalls()).toBe(1);
    expect(h.calls.length).toBe(3); // 1 token + 2 data
  });

  it('refresh khi token hết hạn (qua mốc expiresAt − skew)', async () => {
    const h = harness([
      tokenRes('tok-1', 3600),
      fakeRes(200, { data: [1] }),
      tokenRes('tok-2', 3600),
      fakeRes(200, { data: [2] }),
    ]);
    await h.client.kvGet('/customers');
    h.advance(3600 * 1000); // vượt hạn
    await h.client.kvGet('/customers');
    expect(h.tokenCalls()).toBe(2);
  });

  it('dedup: gọi getAccessToken song song ⇒ chỉ 1 request token', async () => {
    const h = harness([tokenRes()]);
    const [a, b] = await Promise.all([h.client.getAccessToken(), h.client.getAccessToken()]);
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(h.tokenCalls()).toBe(1);
  });

  it('gắn đúng header Bearer + Retailer và query string', async () => {
    const h = harness([tokenRes('tok-x'), fakeRes(200, { ok: true })]);
    await h.client.kvGet('/customers', { pageSize: 100, currentItem: 0, empty: undefined });
    const dataCall = h.calls[1]!;
    expect(dataCall.url).toBe('https://public.kiotviet.vn/customers?pageSize=100&currentItem=0');
    const headers = dataCall.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-x');
    expect(headers.Retailer).toBe('chicbabyshop');
  });

  it('Retailer lấy từ token (client_RetailerCode) ghi đè giá trị người dùng nhập', async () => {
    const h = harness([tokenResWithRetailer('vodka'), fakeRes(200, { ok: true })]);
    await h.client.kvGet('/categories');
    const headers = h.calls[1]!.init!.headers as Record<string, string>;
    expect(headers.Retailer).toBe('vodka'); // KHÔNG phải 'chicbabyshop' trong creds
  });

  it('retailerFromToken: token không phải JWT ⇒ null (fallback về creds)', () => {
    expect(retailerFromToken('not-a-jwt')).toBeNull();
    expect(retailerFromToken('')).toBeNull();
    expect(retailerFromToken('a.b.c')).toBeNull(); // payload không decode được
  });

  it('429 ⇒ tôn trọng Retry-After rồi thử lại thành công', async () => {
    const h = harness([
      tokenRes(),
      fakeRes(429, { error: 'rate' }, { 'Retry-After': '2' }),
      fakeRes(200, { data: [1] }),
    ]);
    const out = await h.client.kvGet<{ data: number[] }>('/invoices');
    expect(out.data).toEqual([1]);
    expect(h.sleeps).toContain(2000); // Retry-After: 2 giây
  });

  it('429 ⇒ Retry-After dạng HTTP-date được tính đúng khoảng cách', async () => {
    // clock bắt đầu 1_000_000ms; mốc = +3000ms (giây chẵn ⇒ HTTP-date round-trip chính xác).
    const httpDate = new Date(1_000_000 + 3000).toUTCString();
    const h = harness(
      [tokenRes(), fakeRes(429, {}, { 'Retry-After': httpDate }), fakeRes(200, { data: [1] })],
      { startMs: 1_000_000 },
    );
    const out = await h.client.kvGet<{ data: number[] }>('/invoices');
    expect(out.data).toEqual([1]);
    expect(h.sleeps).toContain(3000);
  });

  it('5xx ⇒ exp-backoff rồi thử lại thành công', async () => {
    const h = harness([tokenRes(), fakeRes(503, {}), fakeRes(200, { data: [9] })]);
    const out = await h.client.kvGet<{ data: number[] }>('/products');
    expect(out.data).toEqual([9]);
    expect(h.sleeps).toContain(500); // backoff lần đầu = BASE_BACKOFF_MS
  });

  it('401 ⇒ làm mới token 1 lần rồi thử lại (không backoff)', async () => {
    const h = harness([
      tokenRes('tok-old'),
      fakeRes(401, { error: 'unauthorized' }),
      tokenRes('tok-new'),
      fakeRes(200, { data: [7] }),
    ]);
    const out = await h.client.kvGet<{ data: number[] }>('/customers');
    expect(out.data).toEqual([7]);
    expect(h.tokenCalls()).toBe(2);
    // 401 không dùng backoff (chỉ refresh token) — không có sleep backoff (500) từ nhánh này
    expect(h.sleeps).not.toContain(500);
  });

  it('lỗi mạng/timeout ⇒ backoff rồi thử lại thành công', async () => {
    const h = harness([tokenRes(), new Error('network down'), fakeRes(200, { data: [5] })]);
    const out = await h.client.kvGet<{ data: number[] }>('/customers');
    expect(out.data).toEqual([5]);
    expect(h.sleeps).toContain(500); // backoff lần đầu
  });

  it('lỗi mạng kéo dài hết lượt ⇒ ném KiotVietApiError(status 0), không rò chi tiết', async () => {
    const errs = Array.from({ length: 5 }, () => new Error('down')); // MAX_RETRIES(4)+1 lần data đều lỗi
    const h = harness([tokenRes(), ...errs]);
    await expect(h.client.kvGet('/customers')).rejects.toMatchObject({ status: 0 });
  });

  it('4xx khác ⇒ ném KiotVietApiError với status, KHÔNG lộ secret', async () => {
    const h = harness([tokenRes(), fakeRes(400, { error: 'bad request' })]);
    await expect(h.client.kvGet('/customers')).rejects.toMatchObject({ status: 400 });
    try {
      const h2 = harness([tokenRes(), fakeRes(400, {})]);
      await h2.client.kvGet('/customers');
    } catch (e) {
      expect(e).toBeInstanceOf(KiotVietApiError);
      expect(String((e as Error).message)).not.toContain('SECRET');
    }
  });

  it('xoay credential giữa lúc token đang refresh ⇒ token cũ KHÔNG poison cache', async () => {
    // fetch token ĐẦU bị giữ ở "gate"; ta invalidate rồi mới thả ⇒ kết quả cũ phải bị bỏ (epoch đổi).
    let openGate!: () => void;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    let tokenFetches = 0;
    let clock = 1_000_000;
    const deps: KiotVietClientDeps = {
      fetchFn: (async (url: string) => {
        if (String(url).includes('connect/token')) {
          tokenFetches++;
          if (tokenFetches === 1) {
            await gate;
            return tokenRes('tok-OLD');
          }
          return tokenRes('tok-NEW');
        }
        return fakeRes(200, { data: [1] });
      }) as unknown as typeof fetch,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      loadCredentials: async () => ({ clientId: 'c', clientSecret: 's', retailer: 'r' }),
      loadConfig: async () => ({
        baseUrl: 'https://x/',
        tokenEndpoint: 'https://id.kiotviet.vn/connect/token',
        maxRequestsPerMinute: 6000,
      }),
    };
    const client = createKiotVietClient(deps);
    const p1 = client.getAccessToken(); // khởi động fetch token cũ (đang giữ ở gate)
    client.invalidateToken(); // xoay credential GIỮA chừng
    openGate(); // token cũ resolve SAU invalidate
    expect(await p1).toBe('tok-OLD'); // caller đang chờ vẫn nhận token đang bay
    const t2 = await client.getAccessToken(); // lần sau PHẢI fetch mới (cache không bị token cũ ghi đè)
    expect(t2).toBe('tok-NEW');
    expect(tokenFetches).toBe(2);
  });

  it('chưa cấu hình credential ⇒ KiotVietNotConfiguredError', async () => {
    const h = harness([], { credsError: new KiotVietNotConfiguredError() });
    await expect(h.client.getAccessToken()).rejects.toBeInstanceOf(KiotVietNotConfiguredError);
  });

  it('throttle: request thứ 2 bị giãn theo maxRequestsPerMinute', async () => {
    // rpm=60 ⇒ tối thiểu 1000ms/lần. Lần 1 không chờ; lần 2 phải sleep ~1000ms.
    const h = harness([tokenRes(), fakeRes(200, { a: 1 }), fakeRes(200, { a: 2 })], { rpm: 60 });
    await h.client.kvGet('/a');
    await h.client.kvGet('/b');
    expect(h.sleeps).toContain(1000);
  });
});
