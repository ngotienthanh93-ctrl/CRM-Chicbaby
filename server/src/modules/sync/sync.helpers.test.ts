import { describe, it, expect } from 'vitest';
import { scrubSyncError } from './sync.helpers';

describe('sync — scrub lỗi trước khi trả client (🔴 FIX-7 / SEC-10)', () => {
  it('null/rỗng => errorCode & errorSummary đều null', () => {
    expect(scrubSyncError(null)).toEqual({ errorCode: null, errorSummary: null });
    expect(scrubSyncError('')).toEqual({ errorCode: null, errorSummary: null });
    expect(scrubSyncError('   ')).toEqual({ errorCode: null, errorSummary: null });
  });

  it('🔴 che Bearer token trong thông báo', () => {
    const r = scrubSyncError('HTTP 401 Unauthorized: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');
    expect(r.errorSummary).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(r.errorSummary).not.toContain('Bearer eyJ');
    expect(r.errorSummary).toContain('***');
  });

  it('🔴 che token/secret dạng key=value', () => {
    const r = scrubSyncError('call failed token=SECRET123 secret=topsecret apikey=ABCDEF');
    expect(r.errorSummary).not.toContain('SECRET123');
    expect(r.errorSummary).not.toContain('topsecret');
    expect(r.errorSummary).not.toContain('ABCDEF');
  });

  it('🔴 che credential/token nhúng trong URL', () => {
    const withUserInfo = scrubSyncError('connect https://user:p4ssw0rd@kv.example.com/api failed');
    expect(withUserInfo.errorSummary).not.toContain('p4ssw0rd');
    const withQuery = scrubSyncError('GET https://kv.example.com/api?access_token=XYZ789&x=1 => 500');
    expect(withQuery.errorSummary).not.toContain('XYZ789');
  });

  it('🔴 che header Authorization', () => {
    const r = scrubSyncError('request headers Authorization: Basic dXNlcjpwYXNz rejected');
    expect(r.errorSummary).not.toContain('dXNlcjpwYXNz');
  });

  it('🔴 chỉ giữ DÒNG ĐẦU — cắt stack trace nhiều dòng', () => {
    const raw = 'ECONNREFUSED connect failed\n    at TCPConnectWrap.afterConnect\n    at process._tickCallback';
    const r = scrubSyncError(raw);
    expect(r.errorSummary).not.toContain('at TCPConnectWrap');
    expect(r.errorSummary).not.toContain('\n');
  });

  it('cắt độ dài tối đa (không trả body upstream dài)', () => {
    const raw = 'X'.repeat(1000);
    const r = scrubSyncError(raw);
    expect(r.errorSummary!.length).toBeLessThanOrEqual(200);
  });

  it('trích errorCode kỹ thuật khi có (ECONNREFUSED / HTTP 500)', () => {
    expect(scrubSyncError('ECONNREFUSED connect failed').errorCode).toBe('ECONNREFUSED');
    expect(scrubSyncError('HTTP 500 Internal Server Error').errorCode).toBe('HTTP 500');
    expect(scrubSyncError('cái gì đó không có mã').errorCode).toBeNull();
  });
});
