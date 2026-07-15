// 🔵 KV-02 — Client gọi KiotViet Public API (PULL). Lo: lấy access_token (client_credentials, CACHE theo hạn +
// refresh sớm + dedup khi gọi song song), gắn header Retailer + Bearer, RETRY/BACKOFF (429 tôn trọng Retry-After,
// 5xx exp-backoff, 401 làm mới token 1 lần), và THROTTLE chủ động ≤ maxRequestsPerMinute để tránh 429.
//
// Thiết kế TIÊM PHỤ THUỘC (fetch/now/sleep/loader) ⇒ unit-test được token-cache/backoff bằng mock, KHÔNG cần API
// thật. Bản singleton `kiotviet` cuối file nối phụ thuộc thật (global fetch + Date.now + đọc creds/config từ DB).
// 🔴 BẢO MẬT: KHÔNG log/ném token hay client_secret (SEC-10). Token ở header, không nằm trong URL.
import { prisma } from '../prisma';
import { decryptSecret } from '../crypto';
import { DEFAULT_ENGINE_CONFIG, isValidKiotVietUrl } from '../config';

const PUBLIC_API_PROVIDER = 'kiotviet_public_api';
/** 🔴 CWE-400: bound MỖI request outbound — upstream chậm/blackhole KHÔNG được giữ handler/worker vô hạn. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Làm mới token SỚM hơn hạn chừng này (tránh dùng token vừa hết hạn giữa chừng). */
const TOKEN_SKEW_MS = 60_000;
/** Hạn token mặc định nếu KiotViet không trả `expires_in` (phòng thủ). */
const DEFAULT_TOKEN_TTL_S = 3600;
/** Số lần thử lại tối đa cho một request (ngoài lần đầu) khi 429/5xx. */
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export interface KiotVietCredentials {
  clientId: string;
  clientSecret: string;
  retailer: string;
}
export interface KiotVietClientConfig {
  baseUrl: string;
  tokenEndpoint: string;
  maxRequestsPerMinute: number;
}

/** Chưa cấu hình credential Public API (chưa ai POST /public-api-credentials) — phân biệt với lỗi mạng/API. */
export class KiotVietNotConfiguredError extends Error {
  constructor() {
    super('Chưa cấu hình credential KiotViet Public API. Vào Đồng bộ → nhập clientId/secret/retailer.');
    this.name = 'KiotVietNotConfiguredError';
  }
}
/** Lỗi từ KiotViet (HTTP không thành công) — CHỈ giữ status + path, KHÔNG kèm token/secret/header. */
export class KiotVietApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message?: string,
  ) {
    super(message ?? `KiotViet API lỗi ${status} tại ${path}.`);
    this.name = 'KiotVietApiError';
  }
}

export interface KiotVietClientDeps {
  fetchFn: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  loadCredentials: () => Promise<KiotVietCredentials>;
  loadConfig: () => Promise<KiotVietClientConfig>;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Lấy `client_RetailerCode` từ claims của access_token (JWT KiotViet) — nguồn CHÍNH XÁC cho header `Retailer`
 * (token thuộc gian hàng nào thì claim này ghi rõ), tránh lỗi "Shop's name is invalid" do người dùng nhập sai
 * tên shop. Chỉ ĐỌC claims (không xác minh chữ ký — token đã lấy qua TLS bằng client_secret của mình).
 */
export function retailerFromToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const claims = JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { client_RetailerCode?: unknown };
    const code = claims.client_RetailerCode;
    return typeof code === 'string' && code.trim() !== '' ? code : null;
  } catch {
    return null;
  }
}

/** Giới hạn nhịp: nối tiếp các request cách nhau tối thiểu `minIntervalMs` ⇒ đảm bảo ≤ rpm (kể cả gọi song song). */
class RateSpacer {
  private nextAt = 0;
  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}
  async acquire(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const t = this.now();
    const at = Math.max(t, this.nextAt);
    this.nextAt = at + this.minIntervalMs;
    const wait = at - t;
    if (wait > 0) await this.sleep(wait);
  }
}

export interface KiotVietClient {
  /** Lấy access_token hợp lệ (cache + refresh). Public chủ yếu để test/health. */
  getAccessToken(): Promise<string>;
  /** GET một endpoint Public API, trả JSON đã parse. Tự gắn header, throttle, retry/backoff. */
  kvGet<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  /** Xóa token cache (dùng khi 401 hoặc đổi credential). */
  invalidateToken(): void;
}

/** Tạo client với phụ thuộc tiêm vào (test dùng mock; production dùng bản `kiotviet`). */
export function createKiotVietClient(deps: KiotVietClientDeps): KiotVietClient {
  let cached: CachedToken | null = null;
  let inflight: Promise<string> | null = null;
  // 🔴 CONC: tăng mỗi lần invalidate ⇒ VÔ HIỆU kết quả của refresh đang bay (chống creds cũ ghi đè cache SAU khi xoay).
  let tokenEpoch = 0;
  let spacer: RateSpacer | null = null;
  let spacerRpm = -1;

  async function fetchToken(): Promise<string> {
    const myEpoch = tokenEpoch; // chốt epoch tại thời điểm bắt đầu fetch
    const [creds, cfg] = await Promise.all([deps.loadCredentials(), deps.loadConfig()]);
    const body = new URLSearchParams({
      scopes: 'PublicApi.Access',
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    const res = await deps.fetchFn(cfg.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) {
      // KHÔNG kèm body (có thể vọng lại thông tin nhạy cảm); chỉ status.
      throw new KiotVietApiError(res.status, 'connect/token', `Lấy token KiotViet thất bại (HTTP ${res.status}).`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new KiotVietApiError(res.status, 'connect/token', 'KiotViet không trả access_token.');
    const ttlS = Number.isFinite(json.expires_in) && (json.expires_in as number) > 0 ? (json.expires_in as number) : DEFAULT_TOKEN_TTL_S;
    // 🔴 CHỈ ghi cache nếu credential CHƯA bị xoay trong lúc fetch đang bay (epoch không đổi) — nếu đã xoay
    // (invalidateToken chạy giữa chừng), bỏ kết quả token cũ, KHÔNG poison cache; caller đang chờ vẫn nhận token này.
    if (tokenEpoch === myEpoch) cached = { accessToken: json.access_token, expiresAtMs: deps.now() + ttlS * 1000 };
    return json.access_token;
  }

  async function getAccessToken(): Promise<string> {
    if (cached && deps.now() < cached.expiresAtMs - TOKEN_SKEW_MS) return cached.accessToken;
    // Dedup: nhiều request song song cùng hết hạn ⇒ chỉ MỘT lần gọi token endpoint.
    if (inflight) return inflight;
    const p = fetchToken();
    inflight = p;
    // Dọn inflight khi xong — NHƯNG chỉ khi vẫn là promise của mình (tránh clobber refresh MỚI khởi động sau invalidate).
    p.finally(() => {
      if (inflight === p) inflight = null;
    }).catch(() => {});
    return p;
  }

  function invalidateToken(): void {
    cached = null;
    inflight = null; // buộc lần sau fetch MỚI với creds mới, KHÔNG await refresh đang bay của creds cũ
    tokenEpoch++;
  }

  async function getSpacer(rpm: number): Promise<RateSpacer> {
    if (!spacer || spacerRpm !== rpm) {
      spacer = new RateSpacer(rpm > 0 ? 60_000 / rpm : 0, deps.now, deps.sleep);
      spacerRpm = rpm;
    }
    return spacer;
  }

  function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
    const base = baseUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    const qs = new URLSearchParams();
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return `${base}${p}${q ? `?${q}` : ''}`;
  }

  /** Chờ backoff cho lần thử `attempt` (0-based). 429 có Retry-After ⇒ ưu tiên; còn lại exp-backoff (cận trên).
   * Retry-After (RFC 7231) có 2 dạng: số GIÂY, hoặc HTTP-date — hỗ trợ cả hai. */
  async function backoff(attempt: number, retryAfterHeader: string | null): Promise<void> {
    let ms = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    if (retryAfterHeader) {
      const secs = Number(retryAfterHeader);
      if (Number.isFinite(secs) && secs >= 0) {
        ms = Math.min(secs * 1000, MAX_BACKOFF_MS);
      } else {
        // Dạng HTTP-date: khoảng cách từ NGAY tới mốc đó, kẹp trong [0, trần].
        const dateMs = Date.parse(retryAfterHeader);
        if (Number.isFinite(dateMs)) ms = Math.min(Math.max(dateMs - deps.now(), 0), MAX_BACKOFF_MS);
      }
    }
    await deps.sleep(ms);
  }

  async function kvGet<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const cfg = await deps.loadConfig();
    const creds = await deps.loadCredentials();
    const url = buildUrl(cfg.baseUrl, path, query);
    const spacerInst = await getSpacer(cfg.maxRequestsPerMinute);

    let didRefreshOn401 = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await spacerInst.acquire();
      const token = await getAccessToken();
      // 🔵 Retailer LẤY TỪ TOKEN (client_RetailerCode) — chính xác hơn giá trị người dùng nhập; fallback về creds.
      const retailer = retailerFromToken(token) ?? creds.retailer;
      let res: Response;
      try {
        res = await deps.fetchFn(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Retailer: retailer, Accept: 'application/json' },
        });
      } catch (e) {
        // 🔴 Lỗi mạng / timeout (AbortError). Còn lượt ⇒ backoff & thử lại; hết ⇒ ném lỗi ĐÃ chuẩn hóa (không kèm chi tiết).
        if (attempt < MAX_RETRIES) {
          await backoff(attempt, null);
          continue;
        }
        throw new KiotVietApiError(0, path, 'Gọi KiotViet thất bại (mạng/timeout).');
      }
      if (res.ok) return (await res.json()) as T;

      // 401: token có thể vừa bị thu hồi/hết hạn — làm mới MỘT lần rồi thử lại (không tính vào backoff).
      if (res.status === 401 && !didRefreshOn401) {
        didRefreshOn401 = true;
        invalidateToken();
        continue;
      }
      // 429 / 5xx: còn lượt ⇒ backoff rồi thử lại.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await backoff(attempt, res.headers.get('retry-after'));
        continue;
      }
      // 4xx khác (hoặc hết lượt) ⇒ lỗi cứng. KHÔNG kèm token/header.
      throw new KiotVietApiError(res.status, path);
    }
    // Về lý thuyết không tới đây (vòng lặp luôn return/throw), nhưng để TS yên tâm:
    throw new KiotVietApiError(0, path, 'Hết số lần thử lại mà chưa thành công.');
  }

  return { getAccessToken, kvGet, invalidateToken };
}

// ============================================================
// Bản singleton production — nối phụ thuộc thật.
// ============================================================

/** Đọc credential Public API từ DB (row riêng, secret giải mã). Thiếu ⇒ KiotVietNotConfiguredError. */
async function loadCredentialsFromDb(): Promise<KiotVietCredentials> {
  const cred = await prisma.apiCredential.findFirst({ where: { provider: PUBLIC_API_PROVIDER } });
  const meta = (cred?.meta as { clientId?: string; retailer?: string } | null) ?? null;
  if (!cred?.secretCipher || !meta?.clientId || !meta?.retailer) throw new KiotVietNotConfiguredError();
  return { clientId: meta.clientId, clientSecret: decryptSecret(cred.secretCipher), retailer: meta.retailer };
}

/** Đọc config client từ configuration_versions active (fallback DEFAULT). */
async function loadConfigFromDb(): Promise<KiotVietClientConfig> {
  const rows = await prisma.configurationVersion.findMany({
    where: {
      key: { in: ['sync.public_api_base_url', 'sync.token_endpoint', 'sync.max_requests_per_minute'] },
      isActive: true,
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_ENGINE_CONFIG.sync;
  // 🔴 SEC (CWE-918): URL đọc từ config phải qua allowlist; giá trị lạ (đã lỡ lọt / bị sửa DB) ⇒ fallback DEFAULT an toàn.
  const urlOr = (k: string, fb: string): string => {
    const v = byKey.get(k);
    return isValidKiotVietUrl(v) ? (v as string) : fb;
  };
  const rpm = Number(byKey.get('sync.max_requests_per_minute'));
  return {
    baseUrl: urlOr('sync.public_api_base_url', d.publicApiBaseUrl),
    tokenEndpoint: urlOr('sync.token_endpoint', d.tokenEndpoint),
    maxRequestsPerMinute: Number.isFinite(rpm) && rpm > 0 ? rpm : d.maxRequestsPerMinute,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Client production — dùng ở fetcher/backfill (KV-05) và endpoint test-connection.
 * 🔴 fetchFn bọc AbortSignal.timeout ⇒ MỖI request (token + GET) có trần thời gian; retry/backoff ở lớp core. */
export const kiotviet: KiotVietClient = createKiotVietClient({
  fetchFn: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  now: () => Date.now(),
  sleep,
  loadCredentials: loadCredentialsFromDb,
  loadConfig: loadConfigFromDb,
});
