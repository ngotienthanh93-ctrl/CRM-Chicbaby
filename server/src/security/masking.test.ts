import { describe, it, expect } from 'vitest';
import {
  MASK_BABY_NAME,
  MASK_BIRTHDATE,
  MASK_SENSITIVE_TEXT,
  maskAddress,
  maskBabyName,
  maskBirthDate,
  maskPhone,
  maskSensitiveText,
} from './masking';
import { permissionsFor } from './permissions';

const d = (s: string) => new Date(s + 'T00:00:00.000Z');

describe('masking server-side (§3, SEC)', () => {
  it('SĐT: có quyền => thật; không quyền => 09xx…678', () => {
    expect(maskPhone('0912345678', true)).toBe('0912345678');
    expect(maskPhone('0912345678', false)).toBe('09xx…678');
  });

  it('địa chỉ: không quyền => 2 cụm cuối (quận, tỉnh)', () => {
    expect(maskAddress('12 Nguyễn Huệ, Quận 1, TP.HCM', false)).toBe('Quận 1, TP.HCM');
    expect(maskAddress('12 Nguyễn Huệ, Quận 1, TP.HCM', true)).toBe('12 Nguyễn Huệ, Quận 1, TP.HCM');
  });

  it('tên bé / ngày sinh: không quyền => ẩn', () => {
    expect(maskBabyName('Bin', false)).toBe(MASK_BABY_NAME);
    expect(maskBabyName('Bin', true)).toBe('Bin');
    expect(maskBirthDate(d('2025-01-01'), false)).toBe(MASK_BIRTHDATE);
    expect(maskBirthDate(d('2025-01-01'), true)).toBe('01/01/2025');
  });

  it('dị ứng/tình trạng: không quyền => [Không có quyền xem]', () => {
    expect(maskSensitiveText('Dị ứng đạm sữa bò', false)).toBe(MASK_SENSITIVE_TEXT);
    expect(maskSensitiveText('Dị ứng đạm sữa bò', true)).toBe('Dị ứng đạm sữa bò');
  });
});

describe('permissions theo vai (§7)', () => {
  it('🔴 Marketing: KHÔNG xem bé/tư vấn/SĐT đầy đủ', () => {
    const p = permissionsFor('marketing');
    expect(p.viewBaby).toBe(false);
    expect(p.viewConsultation).toBe(false);
    expect(p.viewSensitive).toBe(false);
  });

  it('Trợ lý dữ liệu: KHÔNG xem nhạy cảm', () => {
    const p = permissionsFor('tro_ly_du_lieu');
    expect(p.viewBaby).toBe(false);
    expect(p.viewSensitive).toBe(false);
  });

  it('CRM Officer / CSKH: xem đầy đủ khách+bé', () => {
    for (const role of ['crm_officer', 'cskh'] as const) {
      const p = permissionsFor(role);
      expect(p.viewBaby).toBe(true);
      expect(p.viewSensitive).toBe(true);
    }
  });

  it('chỉ Chủ shop: duyệt chu kỳ, cấu hình, duyệt gộp/export', () => {
    const owner = permissionsFor('chu_shop');
    expect(owner.approveCycle).toBe(true);
    expect(owner.manageConfig).toBe(true);
    expect(owner.approveMerge).toBe(true);
    expect(permissionsFor('crm_officer').approveCycle).toBe(false);
  });
});
