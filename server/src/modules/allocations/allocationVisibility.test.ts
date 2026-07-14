import { describe, it, expect, vi } from 'vitest';

// Mock prisma để import router (kéo theo audit/session) mà KHÔNG chạm DB. Predicate dưới test là THUẦN
// (không gọi prisma) — chỉ cần import không nổ. Mirror style customerVisibility.test.ts.
vi.mock('../../lib/prisma', () => ({ prisma: {} }));

import { allocationBabyWholesaleWhere } from './allocations.router';
import { permissionsFor } from '../../security/permissions';

const withView = { ...permissionsFor('cskh'), viewOrganization: true };
const noView = { ...permissionsFor('cskh'), viewOrganization: false };

describe('allocationBabyWholesaleWhere (BẤT BIẾN #6 / ISSUE-2)', () => {
  it('viewOrganization=true => {} (không lọc — chu_shop/đủ quyền vô hại)', () => {
    expect(allocationBabyWholesaleWhere(withView)).toEqual({});
  });

  it('🔴 viewOrganization=false => loại allocation có bé XÁC NHẬN hoặc GỢI Ý thuộc khách sỉ', () => {
    expect(allocationBabyWholesaleWhere(noView)).toEqual({
      NOT: {
        OR: [
          { baby: { is: { customer: { is: { roles: { some: { role: 'wholesale_contact' } } } } } } },
          {
            suggestedBaby: {
              is: { customer: { is: { roles: { some: { role: 'wholesale_contact' } } } } },
            },
          },
        ],
      },
    });
  });

  it('🔴 predicate xét CẢ hai con trỏ bé (baby + suggestedBaby), không bỏ sót gợi ý bé', () => {
    const where = allocationBabyWholesaleWhere(noView) as {
      NOT: { OR: Array<Record<string, unknown>> };
    };
    const keys = where.NOT.OR.map((o) => Object.keys(o)[0]);
    expect(keys).toContain('baby');
    expect(keys).toContain('suggestedBaby');
  });
});
