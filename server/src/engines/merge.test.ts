import { describe, it, expect } from 'vitest';
import {
  canonicalizePhones,
  mergePhoneMetadata,
  resolveMergedConsent,
  canUnmerge,
  buildMergePreview,
  type MergeSideInput,
} from './merge';

describe('merge — canonical phone (🔴 PHONE-01, UAT-16)', () => {
  it('0912.345.678 và +84912345678 => MỘT bản ghi canonical (KHÔNG nhân đôi)', () => {
    const out = canonicalizePhones([
      { phoneRaw: '0912.345.678', type: 'primary', isPrimary: true, source: 'KV' },
      { phoneRaw: '+84912345678', type: 'zalo', isPrimary: false, source: 'CRM' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.phoneNormalized).toBe('0912345678');
    // gộp nhãn nguồn + type, KHÔNG mất thông tin
    expect(out[0]!.types.sort()).toEqual(['primary', 'zalo']);
    expect(out[0]!.sources.sort()).toEqual(['CRM', 'KV']);
    expect(out[0]!.isPrimary).toBe(true);
  });

  it('hai số THỰC SỰ khác nhau => giữ 2 bản ghi', () => {
    const out = canonicalizePhones([
      { phoneRaw: '0912345678' },
      { phoneRaw: '0988777666' },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('merge — hợp nhất metadata phone trùng canonical (🔴 FIX-1 / PHONE-01 "gộp nhãn nguồn")', () => {
  it('isPrimary = union: bất kỳ bên là số chính => giữ số chính', () => {
    const r = mergePhoneMetadata(
      { type: 'primary', isPrimary: false, source: 'CRM' },
      { type: 'primary', isPrimary: true, source: 'CRM' },
    );
    expect(r.isPrimary).toBe(true);
  });

  it('🔴 KHÔNG mất nhãn cụ thể: master mặc định "primary" + merged "zalo" => giữ "zalo"', () => {
    const r = mergePhoneMetadata(
      { type: 'primary', isPrimary: true, source: 'KV' },
      { type: 'zalo', isPrimary: false, source: 'CRM' },
    );
    expect(r.type).toBe('zalo');
  });

  it('master đã có nhãn cụ thể => GIỮ nhãn master (deterministic, master ưu tiên)', () => {
    const r = mergePhoneMetadata(
      { type: 'zalo', isPrimary: false, source: 'CRM' },
      { type: 'receiver', isPrimary: false, source: 'CRM' },
    );
    expect(r.type).toBe('zalo');
  });

  it('🔴 gộp nguồn: KV (KiotViet — nguồn sự thật) thắng khi hai nguồn khác nhau', () => {
    expect(
      mergePhoneMetadata(
        { type: 'primary', isPrimary: true, source: 'CRM' },
        { type: 'primary', isPrimary: false, source: 'KV' },
      ).source,
    ).toBe('KV');
    expect(
      mergePhoneMetadata(
        { type: 'primary', isPrimary: true, source: 'KV' },
        { type: 'primary', isPrimary: false, source: 'CRM' },
      ).source,
    ).toBe('KV');
  });

  it('hai nguồn giống nhau => giữ nguyên nguồn', () => {
    expect(
      mergePhoneMetadata(
        { type: 'primary', isPrimary: true, source: 'CRM' },
        { type: 'backup', isPrimary: false, source: 'CRM' },
      ).source,
    ).toBe('CRM');
  });
});

describe('merge — consent sau gộp (🔴 CONSENT-01)', () => {
  const t = (s: string) => new Date(s);

  it('revoked MỚI HƠN grant => revoked thắng (ngừng nhắc)', () => {
    const r = resolveMergedConsent([
      { consentKey: 'cham_soc', status: 'granted', at: t('2026-01-01') },
      { consentKey: 'cham_soc', status: 'revoked', at: t('2026-06-01') },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe('revoked');
  });

  it('đồng-ý-lại MỚI NHẤT sau khi revoke => granted thắng', () => {
    const r = resolveMergedConsent([
      { consentKey: 'cham_soc', status: 'granted', at: t('2026-01-01') },
      { consentKey: 'cham_soc', status: 'revoked', at: t('2026-03-01') },
      { consentKey: 'cham_soc', status: 'granted', at: t('2026-06-01') },
    ]);
    expect(r[0]!.status).toBe('granted');
  });

  it('🔴 KHÔNG có đồng-ý-lại mới hơn (revoked là mới nhất) => revoked thắng — KHÔNG tự suy diễn', () => {
    const r = resolveMergedConsent([
      { consentKey: 'cham_soc', subjectKey: 'customer', status: 'granted', at: t('2026-05-01') },
      { consentKey: 'cham_soc', subjectKey: 'customer', status: 'revoked', at: t('2026-05-10') },
    ]);
    expect(r[0]!.status).toBe('revoked');
  });

  it('🔴 trùng MỐC thời gian mới nhất (granted vs revoked) => revoked THẮNG (bảo thủ)', () => {
    const r = resolveMergedConsent([
      { consentKey: 'cham_soc', status: 'granted', at: t('2026-06-01') },
      { consentKey: 'cham_soc', status: 'revoked', at: t('2026-06-01') },
    ]);
    expect(r[0]!.status).toBe('revoked');
  });

  it('tách theo từng loại consent + đối tượng (baby vs customer)', () => {
    const r = resolveMergedConsent([
      { consentKey: 'cham_soc', subjectKey: 'customer', status: 'revoked', at: t('2026-06-01') },
      { consentKey: 'ho_so_be', subjectKey: 'baby:b1', status: 'granted', at: t('2026-06-01') },
    ]);
    expect(r).toHaveLength(2);
    const care = r.find((x) => x.consentKey === 'cham_soc')!;
    const baby = r.find((x) => x.consentKey === 'ho_so_be')!;
    expect(care.status).toBe('revoked');
    expect(baby.status).toBe('granted');
  });
});

describe('merge — unmerge guard (🔴 MERGE-05/CUS-19)', () => {
  it('CHƯA phát sinh dữ liệu mới => cho tách', () => {
    expect(canUnmerge(new Date('2026-06-01'), null)).toBe(true);
    expect(canUnmerge(new Date('2026-06-01'), new Date('2026-05-30'))).toBe(true);
  });

  it('🔴 ĐÃ phát sinh dữ liệu mới sau khi gộp => KHÔNG cho tách (=> ticket)', () => {
    expect(canUnmerge(new Date('2026-06-01'), new Date('2026-06-02'))).toBe(false);
  });
});

describe('merge — preview GIỮ TẤT CẢ (🔴 keep-all, MERGE-07)', () => {
  const side = (o: Partial<MergeSideInput> & { id: string }): MergeSideInput => ({
    id: o.id,
    fullName: o.fullName ?? '',
    displayName: o.displayName ?? null,
    facebook: o.facebook ?? null,
    zalo: o.zalo ?? null,
    careAddress: o.careAddress ?? null,
    phones: o.phones ?? [],
    consentEvents: o.consentEvents ?? [],
    babyCount: o.babyCount ?? 0,
    consultationCount: o.consultationCount ?? 0,
    kvCodes: o.kvCodes ?? [],
    createdAt: o.createdAt ?? new Date('2026-01-01'),
  });

  it('bé/tư vấn/mã KV/consent của CẢ HAI đều được GIỮ (cộng dồn, không mất)', () => {
    const master = side({
      id: 'A',
      fullName: 'Nguyễn Thị A',
      phones: [{ phoneRaw: '0912345678', isPrimary: true, source: 'KV' }],
      consentEvents: [{ consentKey: 'cham_soc', status: 'granted', at: new Date('2026-01-01') }],
      babyCount: 1,
      consultationCount: 2,
      kvCodes: ['KV1'],
    });
    const merged = side({
      id: 'B',
      fullName: 'Nguyễn Thị A',
      phones: [{ phoneRaw: '+84912345678', isPrimary: false, source: 'CRM' }],
      consentEvents: [{ consentKey: 'cham_soc', status: 'revoked', at: new Date('2026-06-01') }],
      babyCount: 1,
      consultationCount: 1,
      kvCodes: ['KV2'],
    });
    const p = buildMergePreview(master, merged);
    // 🔴 KHÔNG gộp bé => tổng bé của cả hai được giữ riêng.
    expect(p.kept.babies).toBe(2);
    expect(p.kept.consultations).toBe(3);
    expect(p.kept.kvCodes).toBe(2);
    // canonical phone: 2 số cùng canonical => 1 bản ghi (KHÔNG nhân đôi).
    expect(p.kept.phones).toBe(1);
    // consent FULL lịch sử giữ cả 2 sự kiện; trạng thái hiện hành = revoked (mới hơn).
    expect(p.kept.consentEvents).toBe(2);
    expect(p.consent[0]!.status).toBe('revoked');
    // 🔴 MERGE-07: KHÔNG dùng câu "không mất dữ liệu nào".
    expect(p.disclaimer).not.toContain('không mất');
    expect(p.babyMergeNote).toContain('suspected_duplicate_baby');
  });
});
