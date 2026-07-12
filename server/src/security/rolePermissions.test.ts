import { describe, it, expect } from 'vitest';
import { permissionsFor } from './permissions';
import {
  mergePermissions,
  sanitizeOverrides,
  effectiveFields,
  fieldsFromPermissions,
  OVERRIDABLE_FLAGS,
  LOCKED_FLAGS,
} from './rolePermissions';

describe('§12.1 mergePermissions — áp cờ nghiệp vụ (OVERRIDABLE_FLAGS)', () => {
  it('override tắt cskh.viewOrganization => viewOrganization = false', () => {
    const base = permissionsFor('cskh');
    expect(base.viewOrganization).toBe(true);
    const merged = mergePermissions(base, { flags: { viewOrganization: false } });
    expect(merged.viewOrganization).toBe(false);
    // Các cờ khác giữ nguyên.
    expect(merged.manageCustomer).toBe(base.manageCustomer);
  });

  it('override bật lại cờ đã tắt (crm_officer.viewSync=false) => true', () => {
    const base = permissionsFor('cskh'); // cskh.viewSync = false
    expect(base.viewSync).toBe(false);
    const merged = mergePermissions(base, { flags: { viewSync: true } });
    expect(merged.viewSync).toBe(true);
  });

  it('role không có override => trả base NGUYÊN', () => {
    const base = permissionsFor('crm_officer');
    expect(mergePermissions(base, undefined)).toEqual(base);
  });
});

describe('§12.1 mergePermissions — field-derived (field THẮNG flag cho 3 cờ nhạy cảm)', () => {
  it('field baby="hidden" cho marketing => viewBaby = false', () => {
    const base = permissionsFor('marketing'); // viewBaby vốn đã false
    const merged = mergePermissions(base, { fields: { baby: 'hidden' } });
    expect(merged.viewBaby).toBe(false);
  });

  it('🔴 SEC: field baby="masked" KHÔNG cấp full view (chỉ "full" mới mở) => viewBaby = false', () => {
    // Bảo thủ: chưa có masking một phần cho bé/tư vấn ở server ⇒ "masked" coi như "hidden" (không rò rỉ đầy đủ).
    const base = permissionsFor('marketing');
    expect(base.viewBaby).toBe(false);
    expect(mergePermissions(base, { fields: { baby: 'masked' } }).viewBaby).toBe(false);
    // consultation cũng vậy.
    const cskh = permissionsFor('cskh'); // viewConsultation vốn true
    expect(mergePermissions(cskh, { fields: { consultation: 'masked' } }).viewConsultation).toBe(false);
  });

  it('field baby="full" => viewBaby = true', () => {
    const base = permissionsFor('marketing');
    expect(mergePermissions(base, { fields: { baby: 'full' } }).viewBaby).toBe(true);
  });

  it('field phone="full"/"masked" điều khiển viewSensitive', () => {
    const base = permissionsFor('marketing'); // viewSensitive false
    expect(mergePermissions(base, { fields: { phone: 'full' } }).viewSensitive).toBe(true);
    expect(mergePermissions(base, { fields: { phone: 'masked' } }).viewSensitive).toBe(false);
    expect(mergePermissions(base, { fields: { phone: 'hidden' } }).viewSensitive).toBe(false);
  });

  it('field consultation="hidden" => viewConsultation = false', () => {
    const base = permissionsFor('cskh'); // viewConsultation true
    expect(mergePermissions(base, { fields: { consultation: 'hidden' } }).viewConsultation).toBe(
      false,
    );
  });

  it('field THẮNG flag khi cả hai cùng có (field baby="full" override flag viewBaby=false)', () => {
    const base = permissionsFor('marketing');
    const merged = mergePermissions(base, {
      flags: { viewBaby: false },
      fields: { baby: 'full' },
    });
    // field áp SAU flag => field thắng.
    expect(merged.viewBaby).toBe(true);
  });
});

describe('§12.1 mergePermissions — chu_shop LOCKED', () => {
  it('🔴 chu_shop KHÔNG bị hạ dù override cố tắt cờ / ẩn field', () => {
    const base = permissionsFor('chu_shop');
    const merged = mergePermissions(base, {
      flags: { viewBaby: false, viewSensitive: false, manageCustomer: false },
      fields: { phone: 'hidden', baby: 'hidden', consultation: 'hidden' },
    });
    expect(merged).toEqual(base); // bỏ qua toàn bộ override
    expect(merged.viewBaby).toBe(true);
    expect(merged.viewSensitive).toBe(true);
    expect(merged.manageUsers).toBe(true);
  });
});

describe('§12.1 mergePermissions — cờ QUẢN TRỊ không override được', () => {
  it('🔴 override manageConfig/manageUsers/approveMerge... bị BỎ QUA (khóa theo code)', () => {
    const base = permissionsFor('cskh'); // toàn bộ cờ quản trị = false
    const merged = mergePermissions(base, {
      flags: {
        manageConfig: true,
        manageUsers: true,
        approveMerge: true,
        approveExport: true,
        approveCycle: true,
        handleAtRisk: true,
        manageSync: true,
      } as never,
    });
    for (const flag of LOCKED_FLAGS) {
      expect(merged[flag]).toBe(base[flag]);
      expect(merged[flag]).toBe(false);
    }
  });

  it('OVERRIDABLE_FLAGS và LOCKED_FLAGS không giao nhau', () => {
    const overlap = OVERRIDABLE_FLAGS.filter((f) => (LOCKED_FLAGS as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it('manageUsers chỉ chu_shop = true (code default)', () => {
    expect(permissionsFor('chu_shop').manageUsers).toBe(true);
    for (const role of ['crm_officer', 'cskh', 'marketing', 'tro_ly_du_lieu'] as const) {
      expect(permissionsFor(role).manageUsers).toBe(false);
    }
  });
});

describe('§12.1 sanitizeOverrides — phòng thủ', () => {
  it('loại override cho chu_shop + role không hợp lệ', () => {
    const clean = sanitizeOverrides({
      chu_shop: { flags: { viewBaby: false } },
      // @ts-expect-error role không hợp lệ để test lọc
      admin: { flags: { viewBaby: false } },
      cskh: { flags: { viewOrganization: false } },
    });
    expect(clean.chu_shop).toBeUndefined();
    // @ts-expect-error kiểm tra key không hợp lệ đã bị loại
    expect(clean.admin).toBeUndefined();
    expect(clean.cskh?.flags?.viewOrganization).toBe(false);
  });

  it('loại cờ khóa khỏi flags, chỉ giữ OVERRIDABLE_FLAGS', () => {
    const clean = sanitizeOverrides({
      cskh: { flags: { viewOrganization: false, manageConfig: true } as never },
    });
    expect(clean.cskh?.flags?.viewOrganization).toBe(false);
    expect((clean.cskh?.flags as Record<string, boolean>)?.manageConfig).toBeUndefined();
  });
});

describe('§12.1 effectiveFields / fieldsFromPermissions', () => {
  it('code-default field từ permissions', () => {
    const f = fieldsFromPermissions(permissionsFor('marketing'));
    expect(f.phone).toBe('masked');
    expect(f.baby).toBe('hidden');
    expect(f.consultation).toBe('hidden');
    expect(f.exportAllowed).toBe(false);
  });

  it('effectiveFields phủ code-default bằng override', () => {
    const base = permissionsFor('marketing');
    const f = effectiveFields(base, { fields: { baby: 'masked', phone: 'full' } });
    expect(f.baby).toBe('masked');
    expect(f.phone).toBe('full');
    // field không override giữ code-default.
    expect(f.consultation).toBe('hidden');
  });

  it('chu_shop luôn code-default field dù có override', () => {
    const base = permissionsFor('chu_shop');
    const f = effectiveFields(base, { fields: { baby: 'hidden' } });
    expect(f.baby).toBe('full');
  });
});
