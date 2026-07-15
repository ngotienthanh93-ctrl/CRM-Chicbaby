// 🔵 KV-03 — Test MAPPER THUẦN (không DB): ánh xạ payload KiotViet → trường mirror kv_*. Fixture dựng từ
// SHAPE THẬT §7 (KIOTVIET-INTEGRATION-PLAN.md, retailer vodka, 2026-07-15). KHÔNG gọi KiotViet thật.
import { describe, it, expect } from 'vitest';
import { mapProduct, mapCustomer } from './sync.processor';

// Shape THẬT /products §7 (camelCase). KiotViet KHÔNG trả `unit`.
const productFixture = {
  id: 1001,
  code: 'SP001',
  barCode: '8938505970013',
  name: 'Sữa A',
  fullName: 'Sữa A - 900g',
  categoryId: 45,
  categoryName: 'Sữa công thức',
  allowsSale: true,
  type: 2,
  hasVariants: false,
  basePrice: 350000,
  weight: 900,
  conversionValue: 1,
  modifiedDate: '2026-07-14T10:00:00Z',
  isActive: true,
};

describe('KV-03 · mapProduct (shape thật §7)', () => {
  it('price = basePrice, categoryId = String(categoryId), name = name, code đúng, unit null', () => {
    const m = mapProduct(productFixture);
    expect(m.price).toBe(350000); // basePrice → Decimal (số)
    expect(m.categoryId).toBe('45'); // số → String
    expect(m.name).toBe('Sữa A');
    expect(m.code).toBe('SP001');
    expect(m.unit).toBeNull(); // KiotViet không trả unit
    expect(m.kvDeleted).toBe(false); // isActive=true ⇒ chưa xóa
  });
  it('isActive=false ⇒ kvDeleted=true', () => {
    expect(mapProduct({ ...productFixture, isActive: false }).kvDeleted).toBe(true);
  });
  it('thiếu name ⇒ fallback fullName', () => {
    const { name: _drop, ...rest } = productFixture;
    void _drop;
    expect(mapProduct(rest).name).toBe('Sữa A - 900g');
  });
  it('thiếu isActive ⇒ KHÔNG tự đánh dấu xóa (an toàn: thiếu cờ không suy ra deleted)', () => {
    const { isActive: _drop, ...rest } = productFixture;
    void _drop;
    expect(mapProduct(rest).kvDeleted).toBe(false);
  });
  it('basePrice = 0 giữ nguyên 0 (không nhầm thành null)', () => {
    expect(mapProduct({ ...productFixture, basePrice: 0 }).price).toBe(0);
  });
  it('chấp cả PascalCase (webhook có thể gửi) — phòng thủ', () => {
    const m = mapProduct({ Id: 5, Code: 'X', Name: 'Y', BasePrice: 10, CategoryId: 9, IsActive: false });
    expect(m.code).toBe('X');
    expect(m.price).toBe(10);
    expect(m.categoryId).toBe('9');
    expect(m.kvDeleted).toBe(true);
  });
});

// Shape THẬT /customers §7 (camelCase). KHÔNG có customerGroup / isActive.
const customerFixture = {
  id: 2002,
  code: 'KH002',
  name: 'Nguyễn Thị A',
  contactNumber: '0901234567',
  address: 'Hà Nội',
  retailerId: 5,
  branchId: 1,
  locationName: 'Hà Nội - Hà Nội',
  wardName: 'Phường X',
  modifiedDate: '2026-07-14T10:00:00Z',
  createdDate: '2020-01-01T00:00:00Z',
  type: 0,
  debt: 0,
};

describe('KV-03 · mapCustomer (shape thật §7)', () => {
  it('phone = contactNumber; code/name/address đúng; customerGroup null; chưa xóa', () => {
    const m = mapCustomer(customerFixture);
    expect(m.phone).toBe('0901234567'); // §7: contactNumber
    expect(m.code).toBe('KH002');
    expect(m.name).toBe('Nguyễn Thị A');
    expect(m.address).toBe('Hà Nội');
    expect(m.customerGroup).toBeNull(); // không có trong response
    expect(m.kvDeleted).toBe(false);
  });
  it('thiếu name ⇒ "(không tên)" (không để rỗng)', () => {
    const { name: _drop, ...rest } = customerFixture;
    void _drop;
    expect(mapCustomer(rest).name).toBe('(không tên)');
  });
  it('chấp cả PascalCase + phone (phòng thủ webhook)', () => {
    const m = mapCustomer({ Code: 'C', Name: 'N', Phone: '0987', Address: 'HP' });
    expect(m.phone).toBe('0987');
    expect(m.code).toBe('C');
  });
});
