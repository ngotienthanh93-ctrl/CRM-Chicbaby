import { describe, it, expect } from 'vitest';
import { workTargetIds, serializeConfirmableBaby } from './work.helpers';
import { permissionsFor } from '../../security/permissions';

describe('work/today — trả customerId/organizationId cho hành động inline (§11.1)', () => {
  it('việc target=customer => customerId có, organizationId null', () => {
    const r = workTargetIds({ targetType: 'customer', customerId: 'cust_1', organizationId: null });
    expect(r.customerId).toBe('cust_1');
    expect(r.organizationId).toBeNull();
  });

  it('việc target=organization => organizationId có, customerId null', () => {
    const r = workTargetIds({ targetType: 'organization', customerId: null, organizationId: 'org_1' });
    expect(r.organizationId).toBe('org_1');
    expect(r.customerId).toBeNull();
  });
});

describe('work/today — danh sách bé để Xác nhận bé (§11.1, masking)', () => {
  it('vai có viewBaby => displayName = tên thật', () => {
    const b = serializeConfirmableBaby({ id: 'b1', babyName: 'Bin' }, permissionsFor('crm_officer'));
    expect(b).toEqual({ id: 'b1', displayName: 'Bin' });
  });

  it('bé chưa đặt tên => nhãn thay thế (không lỗi)', () => {
    const b = serializeConfirmableBaby({ id: 'b2', babyName: null }, permissionsFor('cskh'));
    expect(b.displayName).toBe('(chưa đặt tên)');
  });
});
