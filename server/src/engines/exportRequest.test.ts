import { describe, it, expect } from 'vitest';
import {
  effectiveExportState,
  isExportDownloadable,
  isExportDecidable,
  type ExportRequestSnapshot,
} from './exportRequest';

const now = new Date('2026-07-13T10:00:00Z');
const future = new Date('2026-07-20T10:00:00Z');
const past = new Date('2026-07-01T10:00:00Z');

function snap(p: Partial<ExportRequestSnapshot>): ExportRequestSnapshot {
  return { status: 'pending', expiresAt: null, revokedAt: null, ...p };
}

describe('exportRequest — trạng thái hiệu lực (SEC export có duyệt)', () => {
  it('pending giữ nguyên', () => {
    expect(effectiveExportState(snap({ status: 'pending' }), now)).toBe('pending');
  });

  it('approved còn hạn ⇒ approved (tải được)', () => {
    const r = snap({ status: 'approved', expiresAt: future });
    expect(effectiveExportState(r, now)).toBe('approved');
    expect(isExportDownloadable(r, now)).toBe(true);
  });

  it('approved quá hạn ⇒ expired (KHÔNG tải được) — tính động, không cần job', () => {
    const r = snap({ status: 'approved', expiresAt: past });
    expect(effectiveExportState(r, now)).toBe('expired');
    expect(isExportDownloadable(r, now)).toBe(false);
  });

  it('thu hồi ƯU TIÊN trên mọi trạng thái (kể cả còn hạn)', () => {
    const r = snap({ status: 'approved', expiresAt: future, revokedAt: now });
    expect(effectiveExportState(r, now)).toBe('revoked');
    expect(isExportDownloadable(r, now)).toBe(false);
  });

  it('rejected không tải được, không duyệt lại được', () => {
    const r = snap({ status: 'rejected' });
    expect(isExportDownloadable(r, now)).toBe(false);
    expect(isExportDecidable(r, now)).toBe(false);
  });

  it('chỉ pending mới duyệt/từ chối được', () => {
    expect(isExportDecidable(snap({ status: 'pending' }), now)).toBe(true);
    expect(isExportDecidable(snap({ status: 'approved', expiresAt: future }), now)).toBe(false);
  });

  it('approved chưa đặt hạn (expiresAt null) ⇒ state approved NHƯNG KHÔNG tải được (khớp cổng server)', () => {
    const r = snap({ status: 'approved', expiresAt: null });
    expect(effectiveExportState(r, now)).toBe('approved');
    // 🔴 downloadable=false vì thiếu hạn tải — khớp cổng tải server (đòi expiresAt > now).
    expect(isExportDownloadable(r, now)).toBe(false);
  });
});
