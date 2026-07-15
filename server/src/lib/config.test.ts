// KV-01 — Catalogue cấu hình cho tích hợp KiotViet Public API (pull). Bảo đảm các key mới TỒN TẠI trong
// CONFIG_CATALOGUE (seed đọc thẳng catalogue này) với đúng nhóm 'sync' + default hợp lý, và không trùng key.
import { describe, it, expect } from 'vitest';
import {
  CONFIG_CATALOGUE,
  DEFAULT_ENGINE_CONFIG,
  getConfigItem,
  isValidKiotVietUrl,
} from './config';

describe('KV-01 · config catalogue KiotViet Public API', () => {
  const NEW_KEYS = [
    'sync.public_api_base_url',
    'sync.token_endpoint',
    'sync.page_size',
    'sync.pull_enabled',
    'sync.max_requests_per_minute',
  ];

  it('mỗi key mới có trong catalogue, thuộc nhóm sync, không khóa cứng', () => {
    for (const key of NEW_KEYS) {
      const item = getConfigItem(key);
      expect(item, `thiếu catalogue cho ${key}`).toBeDefined();
      expect(item!.group).toBe('sync');
      expect(item!.locked ?? false).toBe(false);
    }
  });

  it('default hợp lý: base_url/token_endpoint là URL, page_size=100, pull tắt mặc định, throttle dương', () => {
    expect(String(getConfigItem('sync.public_api_base_url')!.value)).toMatch(/^https:\/\//);
    expect(String(getConfigItem('sync.token_endpoint')!.value)).toContain('connect/token');
    expect(getConfigItem('sync.page_size')!.value).toBe(100);
    expect(getConfigItem('sync.pull_enabled')!.value).toBe(0); // 0=tắt: bật thủ công khi sẵn sàng
    expect(getConfigItem('sync.max_requests_per_minute')!.value).toBeGreaterThan(0);
  });

  it('catalogue phản chiếu đúng DEFAULT_ENGINE_CONFIG.sync (không lệch nguồn sự thật)', () => {
    expect(getConfigItem('sync.page_size')!.value).toBe(DEFAULT_ENGINE_CONFIG.sync.pageSize);
    expect(getConfigItem('sync.pull_enabled')!.value).toBe(DEFAULT_ENGINE_CONFIG.sync.pullEnabled);
    expect(getConfigItem('sync.max_requests_per_minute')!.value).toBe(
      DEFAULT_ENGINE_CONFIG.sync.maxRequestsPerMinute,
    );
    expect(getConfigItem('sync.public_api_base_url')!.value).toBe(
      DEFAULT_ENGINE_CONFIG.sync.publicApiBaseUrl,
    );
    expect(getConfigItem('sync.token_endpoint')!.value).toBe(
      DEFAULT_ENGINE_CONFIG.sync.tokenEndpoint,
    );
  });

  it('CONFIG_CATALOGUE không có key trùng', () => {
    const keys = CONFIG_CATALOGUE.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('KV-02 · isValidKiotVietUrl (allowlist chống SSRF/exfil)', () => {
  it('chấp nhận https + miền kiotviet.vn / kiotapi.com (kể cả subdomain)', () => {
    expect(isValidKiotVietUrl('https://public.kiotapi.com')).toBe(true); // host API bán lẻ
    expect(isValidKiotVietUrl('https://public.kiotapi.com/categories')).toBe(true);
    expect(isValidKiotVietUrl('https://id.kiotviet.vn/connect/token')).toBe(true);
    expect(isValidKiotVietUrl('https://kiotviet.vn/api')).toBe(true);
    expect(isValidKiotVietUrl('https://kiotapi.com')).toBe(true);
    // default trong catalogue (base = public.kiotapi.com, token = id.kiotviet.vn) phải hợp lệ
    expect(isValidKiotVietUrl(getConfigItem('sync.public_api_base_url')!.value)).toBe(true);
    expect(isValidKiotVietUrl(getConfigItem('sync.token_endpoint')!.value)).toBe(true);
  });
  it('từ chối http, host lạ, userinfo, host giả mạo, rỗng', () => {
    expect(isValidKiotVietUrl('http://public.kiotapi.com')).toBe(false); // không https
    expect(isValidKiotVietUrl('https://evil.com')).toBe(false); // host lạ
    expect(isValidKiotVietUrl('https://user:pass@id.kiotviet.vn')).toBe(false); // userinfo
    expect(isValidKiotVietUrl('https://kiotviet.vn.evil.com')).toBe(false); // giả mạo suffix
    expect(isValidKiotVietUrl('https://kiotapi.com.evil.com')).toBe(false); // giả mạo suffix
    expect(isValidKiotVietUrl('https://192.168.0.1/internal')).toBe(false); // dịch vụ nội bộ
    expect(isValidKiotVietUrl('not-a-url')).toBe(false);
    expect(isValidKiotVietUrl('')).toBe(false);
    expect(isValidKiotVietUrl(123)).toBe(false);
  });
});
