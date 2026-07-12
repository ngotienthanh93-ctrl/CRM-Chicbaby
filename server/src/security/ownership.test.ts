import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma để test chuỗi suy khách + đối chiếu bé mà KHÔNG cần DB thật.
vi.mock('../lib/prisma', () => ({
  prisma: {
    kvInvoiceLine: { findUnique: vi.fn() },
    customerExternalIdentity: { findFirst: vi.fn() },
    babyProfile: { findFirst: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma';
import {
  babyBelongsToCustomer,
  resolveCustomerIdFromInvoiceLine,
  assertBabyBelongsToCustomer,
  assertBabyBelongsToInvoiceLine,
  BABY_OWNERSHIP_MSG,
} from './ownership';

const kvLine = prisma.kvInvoiceLine.findUnique as unknown as ReturnType<typeof vi.fn>;
const identity = prisma.customerExternalIdentity.findFirst as unknown as ReturnType<typeof vi.fn>;
const baby = prisma.babyProfile.findFirst as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SEC-FIX-1 — babyBelongsToCustomer (quyết định thuần)', () => {
  it('cùng customerId => true', () => {
    expect(babyBelongsToCustomer('cust_1', 'cust_1')).toBe(true);
  });
  it('🔴 khác customerId (id chéo khách) => false', () => {
    expect(babyBelongsToCustomer('cust_2', 'cust_1')).toBe(false);
  });
  it('thiếu dữ kiện (null) => false (từ chối an toàn)', () => {
    expect(babyBelongsToCustomer(null, 'cust_1')).toBe(false);
    expect(babyBelongsToCustomer('cust_1', null)).toBe(false);
    expect(babyBelongsToCustomer(null, null)).toBe(false);
  });
});

describe('SEC-FIX-1 — resolveCustomerIdFromInvoiceLine (chuỗi kv_invoice → identity → customer)', () => {
  it('suy đúng khách CRM từ dòng hóa đơn', async () => {
    kvLine.mockResolvedValue({ invoice: { kvCustomerId: 'KVCUST_1' } });
    identity.mockResolvedValue({ customerId: 'cust_1' });
    await expect(resolveCustomerIdFromInvoiceLine('KVLINE_1')).resolves.toBe('cust_1');
    expect(identity).toHaveBeenCalledWith({
      where: { externalCustomerId: 'KVCUST_1', unlinkedAt: null },
    });
  });
  it('hóa đơn không có khách => null', async () => {
    kvLine.mockResolvedValue({ invoice: { kvCustomerId: null } });
    await expect(resolveCustomerIdFromInvoiceLine('KVLINE_1')).resolves.toBeNull();
  });
  it('mã KV chưa liên kết khách CRM => null', async () => {
    kvLine.mockResolvedValue({ invoice: { kvCustomerId: 'KVCUST_X' } });
    identity.mockResolvedValue(null);
    await expect(resolveCustomerIdFromInvoiceLine('KVLINE_1')).resolves.toBeNull();
  });
});

describe('SEC-FIX-1 — assertBabyBelongsToCustomer (dùng cho followups)', () => {
  it('bé thuộc đúng khách => không ném', async () => {
    baby.mockResolvedValue({ customerId: 'cust_1' });
    await expect(assertBabyBelongsToCustomer('baby_1', 'cust_1')).resolves.toBeUndefined();
  });
  it('🔴 bé của KHÁCH KHÁC => ném 400 trung tính (không lộ id)', async () => {
    baby.mockResolvedValue({ customerId: 'cust_2' });
    await expect(assertBabyBelongsToCustomer('baby_of_2', 'cust_1')).rejects.toMatchObject({
      status: 400,
      message: BABY_OWNERSHIP_MSG,
    });
  });
  it('🔴 bé không tồn tại => ném 400 (cùng message, không phân biệt)', async () => {
    baby.mockResolvedValue(null);
    await expect(assertBabyBelongsToCustomer('baby_ghost', 'cust_1')).rejects.toMatchObject({
      status: 400,
      message: BABY_OWNERSHIP_MSG,
    });
  });
  it('🔴 SEC round 2: truy vấn LOẠI bé đã soft-delete (where deletedAt: null)', async () => {
    baby.mockResolvedValue({ customerId: 'cust_1' });
    await assertBabyBelongsToCustomer('baby_1', 'cust_1');
    expect(baby).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'baby_1', deletedAt: null } }),
    );
  });
  it('🔴 SEC round 2: bé đã xóa (findFirst trả null do lọc deletedAt) => 400', async () => {
    // Bé tồn tại nhưng deletedAt != null => query kèm deletedAt:null trả null => từ chối.
    baby.mockResolvedValue(null);
    await expect(assertBabyBelongsToCustomer('baby_deleted', 'cust_1')).rejects.toMatchObject({
      status: 400,
      message: BABY_OWNERSHIP_MSG,
    });
  });
});

describe('SEC-FIX-1 — assertBabyBelongsToInvoiceLine (dùng cho allocations)', () => {
  it('bé thuộc khách của hóa đơn => không ném', async () => {
    kvLine.mockResolvedValue({ invoice: { kvCustomerId: 'KVCUST_1' } });
    identity.mockResolvedValue({ customerId: 'cust_1' });
    baby.mockResolvedValue({ customerId: 'cust_1' });
    await expect(assertBabyBelongsToInvoiceLine('baby_1', 'KVLINE_1')).resolves.toBeUndefined();
  });
  it('🔴 gán bé của khách KHÁC vào hóa đơn khách A => 400 (chặn IDOR)', async () => {
    // hóa đơn thuộc cust_1, nhưng client gửi babyId của cust_2
    kvLine.mockResolvedValue({ invoice: { kvCustomerId: 'KVCUST_1' } });
    identity.mockResolvedValue({ customerId: 'cust_1' });
    baby.mockResolvedValue({ customerId: 'cust_2' });
    await expect(assertBabyBelongsToInvoiceLine('baby_of_2', 'KVLINE_1')).rejects.toMatchObject({
      status: 400,
      message: BABY_OWNERSHIP_MSG,
    });
  });
  it('🔴 hóa đơn không suy được khách => 400 (không cho gán mù)', async () => {
    kvLine.mockResolvedValue({ invoice: { kvCustomerId: null } });
    baby.mockResolvedValue({ customerId: 'cust_1' });
    await expect(assertBabyBelongsToInvoiceLine('baby_1', 'KVLINE_1')).rejects.toMatchObject({
      status: 400,
    });
  });
});
