import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma để test chốt hiển thị khách sỉ mà KHÔNG cần DB thật (mirror ownership.test.ts).
vi.mock('../lib/prisma', () => ({
  prisma: {
    customerCrm: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma';
import {
  assertCustomerVisible,
  visibleCustomerWhere,
  visibleCustomerRelationWhere,
} from './customerVisibility';
import { permissionsFor, type Permissions } from './permissions';

const findUnique = prisma.customerCrm.findUnique as unknown as ReturnType<typeof vi.fn>;

// viewOrganization=true (chu_shop/crm_officer/cskh mặc định) vs =false (bị hạ quyền / marketing).
const withView: Permissions = { ...permissionsFor('cskh'), viewOrganization: true };
const noView: Permissions = { ...permissionsFor('cskh'), viewOrganization: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('visibleCustomerWhere', () => {
  it('viewOrganization=true => {} (không lọc)', () => {
    expect(visibleCustomerWhere(withView)).toEqual({});
  });
  it('🔴 viewOrganization=false => loại khách có vai wholesale_contact', () => {
    expect(visibleCustomerWhere(noView)).toEqual({ roles: { none: { role: 'wholesale_contact' } } });
  });
});

describe('visibleCustomerRelationWhere', () => {
  it('viewOrganization=true => {} (no-op cho quan hệ bắt buộc)', () => {
    expect(visibleCustomerRelationWhere(withView)).toEqual({});
  });
  it('🔴 viewOrganization=false => loại khách sỉ qua quan hệ customer', () => {
    expect(visibleCustomerRelationWhere(noView)).toEqual({
      roles: { none: { role: 'wholesale_contact' } },
    });
  });
});

describe('assertCustomerVisible', () => {
  it('viewOrganization=true => KHÔNG truy vấn DB, KHÔNG ném (chu_shop qua vô hại)', async () => {
    await expect(assertCustomerVisible('cust_1', withView)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('🔴 thiếu quyền + khách là KHÁCH SỈ => ném 404 (mặc định "Không tìm thấy khách hàng.")', async () => {
    findUnique.mockResolvedValue({ roles: [{ role: 'wholesale_contact' }] });
    await expect(assertCustomerVisible('cust_w', noView)).rejects.toMatchObject({
      status: 404,
      message: 'Không tìm thấy khách hàng.',
    });
  });

  it('🔴 thiếu quyền + KHÁCH SỈ + message tùy biến => ném 404 với message khớp resource (không lộ tồn tại)', async () => {
    findUnique.mockResolvedValue({ roles: [{ role: 'wholesale_contact' }] });
    await expect(
      assertCustomerVisible('cust_w', noView, 'Không tìm thấy hồ sơ bé.'),
    ).rejects.toMatchObject({ status: 404, message: 'Không tìm thấy hồ sơ bé.' });
  });

  it('🔴 dual-role lẻ+sỉ => vẫn bị chặn (có wholesale_contact là chặn)', async () => {
    findUnique.mockResolvedValue({
      roles: [{ role: 'retail_customer' }, { role: 'wholesale_contact' }],
    });
    await expect(assertCustomerVisible('cust_dual', noView)).rejects.toMatchObject({ status: 404 });
  });

  it('thiếu quyền + khách BÁN LẺ => KHÔNG ném (không chặn nhầm khách lẻ)', async () => {
    findUnique.mockResolvedValue({ roles: [{ role: 'retail_customer' }] });
    await expect(assertCustomerVisible('cust_r', noView)).resolves.toBeUndefined();
  });

  it('thiếu quyền + khách không có vai nào => KHÔNG ném', async () => {
    findUnique.mockResolvedValue({ roles: [] });
    await expect(assertCustomerVisible('cust_none', noView)).resolves.toBeUndefined();
  });

  it('thiếu quyền + khách không tồn tại (null) => KHÔNG ném (caller tự trả 404 theo resource)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(assertCustomerVisible('cust_missing', noView)).resolves.toBeUndefined();
  });
});
