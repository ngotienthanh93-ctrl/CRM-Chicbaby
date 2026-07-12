import { describe, it, expect } from 'vitest';
import { permissionsFor } from './permissions';
import { neutralFollowUpContent, serializeFollowUpContent } from './serialize';

describe('FIX-1/FIX-2 — quyền xử lý việc (processWork)', () => {
  it('vai xử lý việc (chu_shop/crm_officer/cskh) => processWork = true', () => {
    expect(permissionsFor('chu_shop').processWork).toBe(true);
    expect(permissionsFor('crm_officer').processWork).toBe(true);
    expect(permissionsFor('cskh').processWork).toBe(true);
  });

  it('🔴 marketing & tro_ly_du_lieu => processWork = false (chặn /work/today + mutation)', () => {
    expect(permissionsFor('marketing').processWork).toBe(false);
    expect(permissionsFor('tro_ly_du_lieu').processWork).toBe(false);
  });

  it('processWork đi kèm viewBaby (chỉ vai xem được bé mới xử lý việc)', () => {
    for (const role of ['chu_shop', 'crm_officer', 'cskh', 'marketing', 'tro_ly_du_lieu'] as const) {
      const p = permissionsFor(role);
      expect(p.processWork).toBe(p.viewBaby);
    }
  });
});

describe('SEC-FIX-2 — manageOrganization (mutation đại lý)', () => {
  it('🔴 chu_shop + crm_officer => manageOrganization = true (CRM Officer ĐƯỢC quản đại lý, REM-W-11)', () => {
    expect(permissionsFor('chu_shop').manageOrganization).toBe(true);
    expect(permissionsFor('crm_officer').manageOrganization).toBe(true);
  });

  it('🔴 cskh (chỉ xem), marketing, tro_ly_du_lieu => manageOrganization = false', () => {
    expect(permissionsFor('cskh').manageOrganization).toBe(false);
    expect(permissionsFor('marketing').manageOrganization).toBe(false);
    expect(permissionsFor('tro_ly_du_lieu').manageOrganization).toBe(false);
  });

  it('cskh VẪN xem được đại lý (viewOrganization=true) nhưng KHÔNG sửa (manageOrganization=false)', () => {
    const cskh = permissionsFor('cskh');
    expect(cskh.viewOrganization).toBe(true);
    expect(cskh.manageOrganization).toBe(false);
  });
});

describe('FIX-1 — nội dung follow-up KHÔNG lộ tên bé cho vai thiếu quyền', () => {
  const withBaby = permissionsFor('crm_officer'); // viewBaby = true
  const noBaby = permissionsFor('marketing'); // viewBaby = false

  it('có viewBaby => trả content thật (có thể chứa tên bé)', () => {
    const c = serializeFollowUpContent(withBaby, {
      reminderType: 'consumption',
      targetType: 'customer',
      content: 'Sữa Aptamil số 2 của bé Bin chắc sắp hết rồi ạ?',
    });
    expect(c).toContain('Bin');
  });

  it('🔴 KHÔNG viewBaby => KHÔNG lộ tên bé, thay bằng nội dung trung tính', () => {
    const c = serializeFollowUpContent(noBaby, {
      reminderType: 'consumption',
      targetType: 'customer',
      content: 'Sữa Aptamil số 2 của bé Bin chắc sắp hết rồi ạ?',
    });
    expect(c).not.toContain('Bin');
    expect(c).toBe('Nhắc chăm sóc khách');
  });

  it('nội dung trung tính theo loại việc', () => {
    expect(neutralFollowUpContent('consumption', 'customer')).toBe('Nhắc chăm sóc khách');
    expect(neutralFollowUpContent('replenishment', 'organization')).toBe('Nhắc nhập bù đại lý');
    expect(neutralFollowUpContent('agency_investigation', 'organization')).toBe('Nhắc nhập bù đại lý');
  });
});
