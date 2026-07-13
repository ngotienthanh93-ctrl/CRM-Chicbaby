/**
 * Seed dữ liệu MINH HỌA cho CRM Chicbaby (⚠️ Dữ liệu minh họa).
 * Deterministic: mọi mốc tính từ ANCHOR cố định (KHÔNG dùng Date.now ngẫu nhiên) => reset+seed tái lập.
 * Chạy: npm run db:seed -w server. Idempotent: xóa sạch dữ liệu (trừ audit_logs append-only) rồi nạp lại.
 */
import { env } from '../src/lib/env';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/crypto';
import { normalizePhone } from '../src/lib/phone';
import { CONFIG_CATALOGUE } from '../src/lib/config';
import { classifyAllocation } from '../src/engines/allocation';
import {
  computeCurrentAgeMonths,
  estimatedBirthMonthFrom,
  babyMatchesProductAge,
} from '../src/engines/babyAge';
import {
  generateConsumptionFollowUps,
  generateReplenishmentFollowUps,
} from '../src/engines/generate';
import { assignExperimentGroup, isExcludedFromExperiment } from '../src/engines/experiment';
import type { Prisma } from '@prisma/client';

// ---------- Mốc thời gian cố định ----------
// 2026-07-11 00:00 giờ VN (UTC+7) => 2026-07-10T17:00Z
const ANCHOR = new Date('2026-07-10T17:00:00.000Z');
const DEMO_PASSWORD = 'chicbaby@123';

function daysBefore(n: number): Date {
  return new Date(ANCHOR.getTime() - n * 86400000);
}
function monthsBefore(n: number): Date {
  return estimatedBirthMonthFrom(ANCHOR, n);
}

async function clearAll() {
  // Xóa theo thứ tự FK (con trước). audit_logs KHÔNG xóa (append-only trigger).
  await prisma.reminderSourceLine.deleteMany();
  await prisma.reminderSource.deleteMany();
  await prisma.followUpConversion.deleteMany();
  await prisma.followUpStateHistory.deleteMany();
  await prisma.followUp.deleteMany();
  await prisma.allocationHistory.deleteMany();
  await prisma.invoiceItemBabyAllocation.deleteMany();
  await prisma.kvReturnLine.deleteMany();
  await prisma.kvReturn.deleteMany();
  await prisma.kvInvoiceLine.deleteMany();
  await prisma.kvInvoice.deleteMany();
  await prisma.kvCustomer.deleteMany();
  await prisma.kvOrder.deleteMany();
  await prisma.kvStockSnapshot.deleteMany();
  await prisma.consultationAdvisedProduct.deleteMany();
  await prisma.consultationVersion.deleteMany();
  await prisma.consultation.deleteMany();
  await prisma.babyProductUsage.deleteMany();
  await prisma.babyProductAvoidance.deleteMany();
  await prisma.consentEvent.deleteMany();
  await prisma.customerConsent.deleteMany();
  await prisma.babyProfile.deleteMany();
  await prisma.customerTagAssignment.deleteMany();
  await prisma.customerOrganizationRole.deleteMany();
  await prisma.organizationExcludedPeriod.deleteMany();
  await prisma.organizationContact.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.productCrmMeta.deleteMany();
  await prisma.kvProduct.deleteMany();
  await prisma.kvCategory.deleteMany();
  await prisma.replacementGroup.deleteMany();
  await prisma.customerPhone.deleteMany();
  await prisma.customerExternalIdentity.deleteMany();
  await prisma.customerRole.deleteMany();
  await prisma.experimentAssignment.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.customerCrm.deleteMany();
  await prisma.configurationChangeLog.deleteMany();
  await prisma.configurationVersion.deleteMany();
  await prisma.consentType.deleteMany();
  await prisma.trustedDevice.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.mergeUnmergeTicket.deleteMany();
  await prisma.mergeHistory.deleteMany();
  // §11.4 hạ tầng đồng bộ (seed lại để dashboard có dữ liệu minh họa).
  await prisma.syncEvent.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.syncReconciliation.deleteMany();
  await prisma.apiCredential.deleteMany();
}

// ============================================================
// 1) Roles + Users
// ============================================================
const ROLES = [
  { key: 'chu_shop', name: 'Chủ shop / Quản trị' },
  { key: 'crm_officer', name: 'CRM Officer' },
  { key: 'cskh', name: 'CSKH' },
  { key: 'marketing', name: 'Marketing' },
  { key: 'tro_ly_du_lieu', name: 'Trợ lý dữ liệu' },
] as const;

const USERS = [
  { username: 'chushop', fullName: 'Chị Chủ Shop', role: 'chu_shop' },
  { username: 'crm', fullName: 'Nhân viên CRM', role: 'crm_officer' },
  { username: 'cskh', fullName: 'Nhân viên CSKH', role: 'cskh' },
  { username: 'marketing', fullName: 'Nhân viên Marketing', role: 'marketing' },
  { username: 'trolydulieu', fullName: 'Trợ lý dữ liệu', role: 'tro_ly_du_lieu' },
] as const;

// ============================================================
// 2) Replacement groups + products
// ============================================================
type Mode = 'baby_specific' | 'multi_audience' | 'not_baby_applicable';
interface ProductDef {
  code: string;
  name: string;
  unit: string;
  price: number;
  mode: Mode;
  cycle: number | null; // approvedCycleDays (null = chưa duyệt)
  suggested?: number;
  group: string | null;
  ageFrom?: number;
  ageTo?: number;
}

const RG = {
  sua: 'rg_sua_ct',
  bim: 'rg_bim',
  men: 'rg_men',
  dha: 'rg_dha',
  canxiMe: 'rg_canxi_me',
  satMe: 'rg_sat_me',
};

const PRODUCTS: ProductDef[] = [
  // baby_specific + đã duyệt chu kỳ
  { code: 'APT1', name: 'Sữa Aptamil số 1', unit: 'lon', price: 520000, mode: 'baby_specific', cycle: 25, group: RG.sua, ageFrom: 0, ageTo: 6 },
  { code: 'APT2', name: 'Sữa Aptamil số 2', unit: 'lon', price: 530000, mode: 'baby_specific', cycle: 30, group: RG.sua, ageFrom: 6, ageTo: 12 },
  { code: 'APT3', name: 'Sữa Aptamil số 3', unit: 'lon', price: 500000, mode: 'baby_specific', cycle: 30, group: RG.sua, ageFrom: 12, ageTo: 36 },
  { code: 'MEIJI0', name: 'Sữa Meiji số 0', unit: 'lon', price: 610000, mode: 'baby_specific', cycle: 28, group: RG.sua, ageFrom: 0, ageTo: 9 },
  { code: 'MEIJI9', name: 'Sữa Meiji số 9', unit: 'lon', price: 590000, mode: 'baby_specific', cycle: 30, group: RG.sua, ageFrom: 9, ageTo: 36 },
  { code: 'SIM2', name: 'Sữa Similac số 2', unit: 'lon', price: 480000, mode: 'baby_specific', cycle: 27, group: RG.sua, ageFrom: 6, ageTo: 12 },
  { code: 'MERM', name: 'Bỉm Merries size M', unit: 'bịch', price: 380000, mode: 'baby_specific', cycle: 20, group: RG.bim, ageFrom: 3, ageTo: 9 },
  { code: 'MERL', name: 'Bỉm Merries size L', unit: 'bịch', price: 390000, mode: 'baby_specific', cycle: 22, group: RG.bim, ageFrom: 9, ageTo: 18 },
  { code: 'BOBXL', name: 'Bỉm Bobby size XL', unit: 'bịch', price: 320000, mode: 'baby_specific', cycle: 25, group: RG.bim, ageFrom: 18, ageTo: 36 },
  // baby_specific CHƯA duyệt chu kỳ (vào danh sách cần khai)
  { code: 'NAN2', name: 'Sữa Nan số 2', unit: 'lon', price: 460000, mode: 'baby_specific', cycle: null, suggested: 29, group: RG.sua, ageFrom: 6, ageTo: 12 },
  { code: 'HUGL', name: 'Bỉm Huggies size L', unit: 'bịch', price: 300000, mode: 'baby_specific', cycle: null, group: RG.bim, ageFrom: 9, ageTo: 18 },
  // multi_audience + đã duyệt
  { code: 'BIOGAIA', name: 'Men vi sinh BioGaia', unit: 'hộp', price: 250000, mode: 'multi_audience', cycle: 30, group: RG.men },
  { code: 'DHANOR', name: 'DHA Nordic Naturals', unit: 'lọ', price: 420000, mode: 'multi_audience', cycle: 45, group: RG.dha },
  { code: 'D3AQUA', name: 'Vitamin D3 Aquadetrim', unit: 'lọ', price: 180000, mode: 'multi_audience', cycle: 60, group: RG.dha },
  // multi_audience CHƯA duyệt
  { code: 'SIROAN', name: 'Siro ăn ngon Fitobimbi', unit: 'lọ', price: 210000, mode: 'multi_audience', cycle: null, group: null },
  // not_baby_applicable (SP cho mẹ) + đã duyệt
  { code: 'CANXIME', name: 'Canxi Úc cho mẹ', unit: 'hộp', price: 350000, mode: 'not_baby_applicable', cycle: 40, group: RG.canxiMe },
  { code: 'SATME', name: 'Sắt bà bầu Elevit', unit: 'hộp', price: 400000, mode: 'not_baby_applicable', cycle: 30, group: RG.satMe },
  { code: 'SUABAU', name: 'Sữa bầu Frisomum', unit: 'lon', price: 430000, mode: 'not_baby_applicable', cycle: 20, group: RG.sua },
  // not_baby_applicable CHƯA duyệt
  { code: 'TRALOISUA', name: 'Trà lợi sữa Hipp', unit: 'hộp', price: 120000, mode: 'not_baby_applicable', cycle: null, group: null },
];

async function main() {
  // 🔴 SEC-FIX-6 (CWE-798): seed dùng CHUNG mật khẩu demo + XÓA SẠCH dữ liệu.
  // TUYỆT ĐỐI không chạy trên production trừ khi có cờ hủy diệt tường minh ALLOW_PROD_SEED=1.
  if (env.isProd && process.env.ALLOW_PROD_SEED !== '1') {
    console.error(
      '⛔ Từ chối seed/reset trên NODE_ENV=production (sẽ xóa sạch dữ liệu + đặt mật khẩu demo chung). ' +
        'Nếu THỰC SỰ cố ý, đặt ALLOW_PROD_SEED=1.',
    );
    process.exit(1);
  }
  console.log('⚠️  Seed dữ liệu MINH HỌA — CRM Chicbaby');
  await clearAll();

  // ---- Roles + Users ----
  const roleIdByKey = new Map<string, string>();
  for (const r of ROLES) {
    const role = await prisma.role.create({ data: { key: r.key as never, name: r.name } });
    roleIdByKey.set(r.key, role.id);
  }
  const userIdByUsername = new Map<string, string>();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const u of USERS) {
    const user = await prisma.user.create({
      data: {
        username: u.username,
        passwordHash,
        fullName: u.fullName,
        roleId: roleIdByKey.get(u.role)!,
      },
    });
    userIdByUsername.set(u.username, user.id);
  }
  const ownerId = userIdByUsername.get('chushop')!;
  const crmId = userIdByUsername.get('crm')!;
  const cskhId = userIdByUsername.get('cskh')!;

  // ---- Thiết bị tin cậy (⚠️ Dữ liệu minh họa — cho tab Thiết bị của SCR-13) ----
  await prisma.trustedDevice.createMany({
    data: [
      {
        userId: ownerId,
        deviceLabel: 'iPhone của Chị Chủ Shop (Dữ liệu minh họa)',
        fingerprint: 'demo-fp-owner-iphone',
        lastUsedAt: new Date(),
      },
      {
        userId: ownerId,
        deviceLabel: 'MacBook văn phòng (Dữ liệu minh họa)',
        fingerprint: 'demo-fp-owner-macbook',
        lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        userId: crmId,
        deviceLabel: 'Máy bàn CRM (Dữ liệu minh họa)',
        fingerprint: 'demo-fp-crm-desktop',
        lastUsedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ],
  });

  // ---- Consent types ----
  const CONSENTS = [
    { key: 'ho_so_tu_van_be', name: 'Lưu hồ sơ & tư vấn cho bé' },
    { key: 'cham_soc_nhac_tai_mua', name: 'Chăm sóc & nhắc tái mua' },
    { key: 'marketing', name: 'Nhận thông tin marketing' },
    { key: 'dung_anh_review', name: 'Dùng ảnh/review' },
  ];
  const consentIdByKey = new Map<string, string>();
  for (const c of CONSENTS) {
    const ct = await prisma.consentType.create({ data: c });
    consentIdByKey.set(c.key, ct.id);
  }

  // ---- Config versions (Phụ lục B) ----
  for (const item of CONFIG_CATALOGUE) {
    await prisma.configurationVersion.create({
      data: { key: item.key, value: item.value as never, isActive: true },
    });
  }
  // §11.2 CON-06: mẫu nhanh tư vấn theo nhóm vấn đề (⚙️ cấu hình, GET /api/config trả về).
  await prisma.configurationVersion.create({
    data: {
      key: 'consultation.quick_templates',
      value: [
        { group: 'bieng_an', label: 'Biếng ăn', issue: 'Bé biếng ăn, hỏi giải pháp' },
        { group: 'di_ung_dam_bo', label: 'Dị ứng đạm bò', issue: 'Nghi dị ứng đạm sữa bò' },
        { group: 'cham_tang_can', label: 'Chậm tăng cân', issue: 'Bé chậm tăng cân' },
        { group: 'tao_bon', label: 'Táo bón', issue: 'Bé táo bón, hỏi men vi sinh' },
        { group: 'khac', label: 'Khác', issue: '' },
      ] as never,
      isActive: true,
    },
  });

  // ---- Replacement groups ----
  const rgNames: Record<string, string> = {
    [RG.sua]: 'Sữa công thức (thay thế)',
    [RG.bim]: 'Bỉm/tã',
    [RG.men]: 'Men vi sinh',
    [RG.dha]: 'DHA / Vitamin bổ sung',
    [RG.canxiMe]: 'Canxi cho mẹ',
    [RG.satMe]: 'Sắt cho mẹ',
  };
  for (const [id, name] of Object.entries(rgNames)) {
    await prisma.replacementGroup.create({ data: { id, name } });
  }

  // ---- Category + products + meta ----
  const cat = await prisma.kvCategory.create({ data: { kvCategoryId: 'CAT1', name: 'Sữa & TPCN mẹ bé' } });
  const productByCode = new Map<string, { kvProductId: string; def: ProductDef }>();
  for (const p of PRODUCTS) {
    const kvProductId = `KVP_${p.code}`;
    await prisma.kvProduct.create({
      data: {
        kvProductId,
        code: p.code,
        name: p.name,
        unit: p.unit,
        price: p.price,
        categoryId: cat.kvCategoryId,
        ageFromMonths: p.ageFrom ?? null,
        ageToMonths: p.ageTo ?? null,
      },
    });
    await prisma.productCrmMeta.create({
      data: {
        kvProductId,
        babyAssignmentMode: p.mode as never,
        approvedCycleDays: p.cycle ?? null,
        approvedBy: p.cycle ? ownerId : null,
        approvedAt: p.cycle ? daysBefore(200) : null,
        suggestedCycleDays: p.suggested ?? (p.cycle ? p.cycle + 1 : null),
        suggestionSampleSize: p.suggested || p.cycle ? 8 : null,
        suggestionConfidence: p.suggested || p.cycle ? 'medium' : null,
        suggestionMethod: 'median',
        replacementGroupId: p.group,
        autoRemindEnabled: true,
      },
    });
    productByCode.set(p.code, { kvProductId, def: p });
  }

  // ============================================================
  // 3) Khách hàng (kv + CRM)
  // ============================================================
  interface BabyDef {
    name: string;
    ageMonths: number; // tuổi tại thời điểm ANCHOR (ghi qua estimatedBirthMonth)
    allergy?: string;
  }
  interface CustomerDef {
    key: string;
    kvName: string;
    group: 'le' | 'si';
    phone: string;
    phoneVariants?: string[]; // số phụ (canonical/zalo)
    roles: ('retail_customer' | 'wholesale_contact')[];
    babies: BabyDef[];
    consentCare?: boolean; // mặc định true
    extraKvCode?: string; // liên kết 2 mã KV (CUS-09)
    facebook?: string;
  }

  const SHARED_FAMILY_PHONE = '0988777666'; // 2 khách chung số (CUS-13)

  const customerDefs: CustomerDef[] = [];

  // Khách lẻ có đúng 1 bé (auto_assigned) — nhiều khách
  const oneBabyNames = ['Bin', 'Su', 'Bơ', 'Nemo', 'Kem', 'Bắp', 'Xoài', 'Tôm', 'Cua', 'Mít'];
  oneBabyNames.forEach((bn, i) => {
    customerDefs.push({
      key: `le1_${i}`,
      kvName: `Khách Lẻ 1Bé ${i + 1}`,
      group: 'le',
      phone: `09123400${String(i).padStart(2, '0')}`,
      roles: ['retail_customer'],
      babies: [{ name: bn, ageMonths: 4 + i * 2 }], // tuổi trải rộng để khớp nhiều SP
    });
  });

  // Khách lẻ có 2 bé (suggested nếu khớp tuổi 1 bé)
  for (let i = 0; i < 6; i++) {
    customerDefs.push({
      key: `le2_${i}`,
      kvName: `Khách Lẻ 2Bé ${i + 1}`,
      group: 'le',
      phone: `09123411${String(i).padStart(2, '0')}`,
      roles: ['retail_customer'],
      babies: [
        { name: `Anh${i}`, ageMonths: 30 + i }, // bé lớn
        { name: `Em${i}`, ageMonths: 7 + i }, // bé nhỏ
      ],
    });
  }

  // Khách lẻ CHƯA có bé (customer_level)
  for (let i = 0; i < 8; i++) {
    customerDefs.push({
      key: `le0_${i}`,
      kvName: `Khách Lẻ 0Bé ${i + 1}`,
      group: 'le',
      phone: `09123422${String(i).padStart(2, '0')}`,
      roles: ['retail_customer'],
      babies: [],
    });
  }

  // Khách lẻ mua SP cho mẹ (not_applicable) + có 1 bé
  for (let i = 0; i < 4; i++) {
    customerDefs.push({
      key: `leme_${i}`,
      kvName: `Khách Lẻ Mẹ ${i + 1}`,
      group: 'le',
      phone: `09123433${String(i).padStart(2, '0')}`,
      roles: ['retail_customer'],
      babies: [{ name: `Bé mẹ ${i}`, ageMonths: 5 + i }],
    });
  }

  // Khách rút consent chăm sóc (không nhắc)
  customerDefs.push({
    key: 'le_noconsent',
    kvName: 'Khách Rút Consent',
    group: 'le',
    phone: '0912349999',
    roles: ['retail_customer'],
    babies: [{ name: 'Nhóc', ageMonths: 8 }],
    consentCare: false,
  });

  // Cặp số canonical: 0912.345.678 và +84912345678 => cùng người (UAT-16)
  customerDefs.push({
    key: 'le_canonical',
    kvName: 'Khách Số Canonical',
    group: 'le',
    phone: '0912.345.678',
    phoneVariants: ['+84912345678'],
    roles: ['retail_customer'],
    babies: [{ name: 'Cà Rốt', ageMonths: 10, allergy: 'Dị ứng đạm sữa bò' }],
  });

  // 2 khách CHUNG số gia đình (UAT-17) — khác tên
  customerDefs.push({
    key: 'le_family_a',
    kvName: 'Nguyễn Thị Mẹ',
    group: 'le',
    phone: SHARED_FAMILY_PHONE,
    roles: ['retail_customer'],
    babies: [{ name: 'Bé Gia Đình', ageMonths: 9 }],
  });
  customerDefs.push({
    key: 'le_family_b',
    kvName: 'Nguyễn Văn Bố',
    group: 'le',
    phone: SHARED_FAMILY_PHONE,
    roles: ['retail_customer'],
    babies: [],
  });

  // Cặp NGHI TRÙNG THẬT (dedup-candidates gợi ý): CÙNG tên + CÙNG số (canonical) + CÙNG facebook.
  // 🔴 KHÔNG phải family-phone-risk (tên giống nhau) => score 100 => gợi ý gộp.
  customerDefs.push({
    key: 'dup_a',
    kvName: 'Trần Thị Đúp',
    group: 'le',
    phone: '0921112223',
    roles: ['retail_customer'],
    babies: [],
    facebook: 'fb.com/tranthidup',
  });
  customerDefs.push({
    key: 'dup_b',
    kvName: 'Trần Thị Đúp',
    group: 'le',
    phone: '+84921112223',
    roles: ['retail_customer'],
    babies: [],
    facebook: 'fb.com/tranthidup',
  });

  // Khách VỪA LẺ VỪA SỈ (CUS-03 / UAT-15/23) — 2 vai
  customerDefs.push({
    key: 'both_1',
    kvName: 'Chị Vừa Lẻ Vừa Sỉ',
    group: 'le',
    phone: '0900112233',
    roles: ['retail_customer', 'wholesale_contact'],
    babies: [{ name: 'Con Chủ Sỉ', ageMonths: 14 }],
    extraKvCode: 'KVCUST_BOTH1_SI', // mã KV thứ 2 (mua sỉ)
  });

  // Khách sỉ (liên hệ đại lý) — có 1 người có bé (UAT-33)
  const wholesaleContacts: CustomerDef[] = [];
  for (let i = 0; i < 9; i++) {
    wholesaleContacts.push({
      key: `si_${i}`,
      kvName: `Đại lý Liên Hệ ${i + 1}`,
      group: 'si',
      phone: `09777000${String(i).padStart(2, '0')}`,
      roles: ['wholesale_contact'],
      babies: i === 0 ? [{ name: 'Con Đại Lý', ageMonths: 12 }] : [],
    });
  }
  customerDefs.push(...wholesaleContacts);

  // Tạo kv_customers + crm customers + identities + roles + phones + babies + consents
  interface CustomerRuntime {
    def: CustomerDef;
    customerId: string;
    kvCustomerId: string;
    extraKvCustomerId?: string;
    babyIds: { id: string; def: BabyDef }[];
  }
  const runtime: CustomerRuntime[] = [];

  let idx = 0;
  for (const def of customerDefs) {
    idx++;
    const kvCustomerId = `KVCUST_${idx}`;
    const customerId = `cust_${idx}`;
    await prisma.kvCustomer.create({
      data: {
        kvCustomerId,
        code: `KH${String(idx).padStart(4, '0')}`,
        name: def.kvName,
        phone: normalizePhone(def.phone),
        customerGroup: def.group === 'si' ? 'Đại lý sỉ' : 'Khách lẻ',
        kvModifiedAt: daysBefore(30),
      },
    });
    await prisma.customerCrm.create({
      data: {
        id: customerId,
        fullName: def.kvName,
        displayName: def.kvName,
        facebook: def.facebook ?? null,
        careAddress: `Số ${idx} Đường Demo, Phường ${idx}, Quận ${((idx % 12) + 1)}, TP.HCM`,
      },
    });
    await prisma.customerExternalIdentity.create({
      data: {
        customerId,
        sourceSystem: 'kiotviet',
        externalCustomerId: kvCustomerId,
        externalCode: `KH${String(idx).padStart(4, '0')}`,
        isPrimary: true,
        linkedMethod: 'auto',
        linkedAt: daysBefore(300),
      },
    });
    let extraKvCustomerId: string | undefined;
    if (def.extraKvCode) {
      extraKvCustomerId = def.extraKvCode;
      await prisma.kvCustomer.create({
        data: { kvCustomerId: extraKvCustomerId, code: def.extraKvCode, name: `${def.kvName} (sỉ)`, customerGroup: 'Đại lý sỉ', kvModifiedAt: daysBefore(30) },
      });
      await prisma.customerExternalIdentity.create({
        data: {
          customerId,
          sourceSystem: 'kiotviet',
          externalCustomerId: extraKvCustomerId,
          externalCode: def.extraKvCode,
          isPrimary: false,
          linkedMethod: 'manual',
          linkedAt: daysBefore(100),
        },
      });
    }
    // roles
    for (const r of def.roles) {
      await prisma.customerRole.create({
        data: { customerId, role: r as never, source: 'auto_from_kv' },
      });
    }
    // phones
    const phones = [def.phone, ...(def.phoneVariants ?? [])];
    for (let pi = 0; pi < phones.length; pi++) {
      await prisma.customerPhone.create({
        data: {
          customerId,
          phoneRaw: phones[pi]!,
          phoneNormalized: normalizePhone(phones[pi]!),
          type: pi === 0 ? 'primary' : 'zalo',
          isPrimary: pi === 0,
          source: 'KV',
        },
      });
    }
    // babies
    const babyIds: { id: string; def: BabyDef }[] = [];
    let bi = 0;
    for (const b of def.babies) {
      bi++;
      const babyId = `baby_${idx}_${bi}`;
      const est = monthsBefore(b.ageMonths);
      await prisma.babyProfile.create({
        data: {
          id: babyId,
          customerId,
          babyName: b.name,
          ageMonthsAtRecording: b.ageMonths,
          ageRecordedAt: ANCHOR,
          estimatedBirthMonth: est,
          datePrecision: 'month_estimated',
          allergies: b.allergy ?? null,
          allergiesSource: b.allergy ? 'me_ke' : null,
          allergiesRecordedAt: b.allergy ? ANCHOR : null,
        },
      });
      babyIds.push({ id: babyId, def: b });
      // consent hồ sơ bé
      await prisma.customerConsent.create({
        data: {
          customerId,
          consentTypeId: consentIdByKey.get('ho_so_tu_van_be')!,
          subjectType: 'baby',
          babyId,
          status: 'granted',
          grantedAt: daysBefore(200),
        },
      });
    }
    // consent chăm sóc & nhắc tái mua
    const careGranted = def.consentCare !== false;
    await prisma.customerConsent.create({
      data: {
        customerId,
        consentTypeId: consentIdByKey.get('cham_soc_nhac_tai_mua')!,
        status: careGranted ? 'granted' : 'revoked',
        grantedAt: careGranted ? daysBefore(200) : null,
        revokedAt: careGranted ? null : daysBefore(10),
      },
    });
    await prisma.consentEvent.create({
      data: {
        customerId,
        consentTypeId: consentIdByKey.get('cham_soc_nhac_tai_mua')!,
        status: careGranted ? 'granted' : 'revoked',
      },
    });

    runtime.push({ def, customerId, kvCustomerId, extraKvCustomerId, babyIds });
  }

  // ============================================================
  // 4) Hóa đơn bán lẻ + phân bổ bé
  // ============================================================
  let invoiceSeq = 0;
  let lineSeq = 0;
  let allocCounts = { auto_assigned: 0, suggested: 0, customer_level: 0, not_applicable: 0, confirmed: 0 };

  // chọn SP phù hợp theo tuổi bé cho khách lẻ
  function pickRetailProducts(rt: CustomerRuntime): ProductDef[] {
    const picks: ProductDef[] = [];
    const babyAges = rt.babyIds.map((b) =>
      computeCurrentAgeMonths({ estimatedBirthMonth: monthsBefore(b.def.ageMonths) }, ANCHOR),
    );
    if (rt.def.key.startsWith('leme')) {
      // khách mẹ: mua SP mẹ (not_applicable) + đôi khi 1 SP bé
      picks.push(productByCode.get('CANXIME')!.def);
      picks.push(productByCode.get('APT2')!.def);
      return picks;
    }
    if (babyAges.length === 0) {
      // 0 bé: mua multi_audience => customer_level
      picks.push(productByCode.get('BIOGAIA')!.def);
      picks.push(productByCode.get('DHANOR')!.def);
      return picks;
    }
    // có bé: chọn sữa/bỉm khớp tuổi bé đầu tiên + 1 multi_audience
    const age = babyAges[0] ?? 6;
    for (const p of PRODUCTS) {
      if (p.mode === 'baby_specific' && p.cycle && babyMatchesProductAge(age, p.ageFrom, p.ageTo)) {
        picks.push(p);
        if (picks.length >= 2) break;
      }
    }
    if (picks.length === 0) picks.push(productByCode.get('APT2')!.def);
    picks.push(productByCode.get('BIOGAIA')!.def); // multi_audience
    return picks;
  }

  for (const rt of runtime) {
    if (!rt.def.roles.includes('retail_customer')) continue;
    const isRetail = true;
    const products = pickRetailProducts(rt);
    // 2-5 hóa đơn rải trong 6 tháng gần đây
    const invoiceCount = 2 + (parseInt(rt.customerId.replace(/\D/g, ''), 10) % 4);
    for (let k = 0; k < invoiceCount; k++) {
      invoiceSeq++;
      const kvInvoiceId = `KVINV_${invoiceSeq}`;
      // hóa đơn gần nhất cách ANCHOR sao cho nhắc rơi quanh hôm nay
      const daysAgo = 12 + k * 30;
      const purchaseDate = daysBefore(daysAgo);
      const lineDatas: Prisma.KvInvoiceLineCreateManyInput[] = [];
      const lineForAlloc: { kvInvoiceLineId: string; product: ProductDef; qty: number }[] = [];
      let total = 0;
      // hóa đơn gần nhất (k=0) chứa TẤT CẢ sp để tạo nhắc; hóa đơn cũ ít dòng hơn
      const useProducts = k === 0 ? products : products.slice(0, 1);
      for (const p of useProducts) {
        lineSeq++;
        const kvInvoiceLineId = `KVLINE_${lineSeq}`;
        const qty = 1;
        lineDatas.push({
          kvInvoiceLineId,
          kvInvoiceId,
          kvProductId: productByCode.get(p.code)!.kvProductId,
          quantity: qty,
          price: p.price,
        });
        lineForAlloc.push({ kvInvoiceLineId, product: p, qty });
        total += p.price * qty;
      }
      await prisma.kvInvoice.create({
        data: {
          kvInvoiceId,
          code: `HD${String(invoiceSeq).padStart(5, '0')}`,
          kvCustomerId: rt.kvCustomerId,
          purchaseDate,
          total,
          status: 'completed',
          kvModifiedAt: purchaseDate,
        },
      });
      await prisma.kvInvoiceLine.createMany({ data: lineDatas });

      // phân bổ bé cho từng dòng (chỉ hóa đơn gần nhất k===0 để SCR-07 gọn & SCR-02 có nhắc)
      if (k === 0) {
        for (const lf of lineForAlloc) {
          const babyCount = rt.babyIds.length;
          const ageMatch: string[] = [];
          if (babyCount > 1 && lf.product.mode === 'baby_specific') {
            for (const b of rt.babyIds) {
              const age = computeCurrentAgeMonths({ estimatedBirthMonth: monthsBefore(b.def.ageMonths) }, ANCHOR);
              if (babyMatchesProductAge(age, lf.product.ageFrom, lf.product.ageTo)) ageMatch.push(b.id);
            }
          }
          const result = classifyAllocation({
            babyCount,
            babyAssignmentMode: lf.product.mode,
            isRetailInvoice: isRetail,
            isGiftOrProxy: false,
            singleBabyId: babyCount === 1 ? rt.babyIds[0]!.id : null,
            ageMatchBabyIds: ageMatch,
          });
          allocCounts[result.assignmentStatus] = (allocCounts[result.assignmentStatus] ?? 0) + 1;
          await prisma.invoiceItemBabyAllocation.create({
            data: {
              kvInvoiceLineId: lf.kvInvoiceLineId,
              babyId: result.babyId,
              suggestedBabyId: result.suggestedBabyId,
              assignmentStatus: result.assignmentStatus as never,
              assignmentConfidence: result.confidence as never,
              assignmentSource: result.source as never,
              assignedQuantity: lf.qty,
              consumptionStartDate: purchaseDate,
            },
          });
        }
      }
    }
  }

  // Xác nhận 1 vài dòng suggested -> confirmed (để tab "Đã xong" + nhắc nêu tên bé có dữ liệu)
  const someSuggested = await prisma.invoiceItemBabyAllocation.findMany({
    where: { assignmentStatus: 'suggested' },
    take: 3,
  });
  for (const a of someSuggested) {
    if (!a.suggestedBabyId) continue;
    await prisma.invoiceItemBabyAllocation.update({
      where: { id: a.id },
      data: {
        babyId: a.suggestedBabyId,
        suggestedBabyId: null,
        assignmentStatus: 'confirmed',
        assignmentConfidence: 'high',
        assignmentSource: 'manual',
        confirmedBy: crmId,
        confirmedAt: daysBefore(2),
      },
    });
    allocCounts.suggested--;
    allocCounts.confirmed++;
  }

  // ============================================================
  // 5) Tổ chức / đại lý + hóa đơn sỉ (thiết lập nhịp)
  // ============================================================
  interface OrgDef {
    key: string;
    name: string;
    contactKey: string; // wholesale customer key làm nguoi_dat_hang
    pattern: 'active_due' | 'slow' | 'at_risk' | 'collecting' | 'paused' | 'shrinking';
  }
  const orgDefs: OrgDef[] = [
    { key: 'org_1', name: 'Đại lý Mẹ Bé Minh Anh', contactKey: 'si_0', pattern: 'active_due' },
    { key: 'org_2', name: 'Đại lý Bé Khỏe Quận 7', contactKey: 'si_1', pattern: 'slow' },
    { key: 'org_3', name: 'Đại lý Yêu Con Thủ Đức', contactKey: 'si_2', pattern: 'at_risk' },
    { key: 'org_4', name: 'Đại lý Mới Gò Vấp', contactKey: 'si_3', pattern: 'collecting' },
    { key: 'org_5', name: 'Đại lý Nghỉ Tết Bình Thạnh', contactKey: 'si_4', pattern: 'paused' },
    { key: 'org_6', name: 'Đại lý Đang Teo Tân Bình', contactKey: 'si_5', pattern: 'shrinking' },
    { key: 'org_7', name: 'Đại lý At-Risk VIP Quận 1', contactKey: 'si_6', pattern: 'at_risk' },
  ];

  const rtByKey = new Map(runtime.map((r) => [r.def.key, r]));

  for (const od of orgDefs) {
    const contactRt = rtByKey.get(od.contactKey)!;
    const org = await prisma.organization.create({
      data: {
        id: od.key,
        orgName: od.name,
        province: 'TP.HCM',
        district: 'Quận Demo',
        paused: od.pattern === 'paused',
        pausedReason: od.pattern === 'paused' ? 'Nghỉ Tết' : null,
        pausedUntil: od.pattern === 'paused' ? daysBefore(-20) : null,
      },
    });
    // Liên hệ: CHỦ SHOP (khác người) + NGƯỜI ĐẶT HÀNG (là contactRt) — ORG-01/03
    await prisma.organizationContact.create({
      data: { organizationId: org.id, name: `Chủ ${od.name}`, role: 'chu_shop', phone: `0966${od.key.slice(-1)}00001`, isPrimary: true },
    });
    await prisma.organizationContact.create({
      data: {
        organizationId: org.id,
        name: `Người đặt hàng ${od.name}`,
        role: 'nguoi_dat_hang',
        phone: normalizePhone(contactRt.def.phone),
        isPrimary: false,
      },
    });
    await prisma.customerOrganizationRole.create({
      data: { customerId: contactRt.customerId, organizationId: org.id, role: 'nguoi_dat_hang' },
    });

    // Sinh hóa đơn sỉ theo pattern (dùng kvCustomerId của contact)
    const kvId = contactRt.kvCustomerId;
    const patterns: Record<OrgDef['pattern'], { n: number; cadence: number; lastGap: number; shrink: boolean }> = {
      active_due: { n: 6, cadence: 30, lastGap: 33, shrink: false },
      slow: { n: 6, cadence: 30, lastGap: 45, shrink: false },
      at_risk: { n: 6, cadence: 30, lastGap: 75, shrink: false },
      collecting: { n: 2, cadence: 30, lastGap: 20, shrink: false },
      paused: { n: 6, cadence: 30, lastGap: 75, shrink: false },
      shrinking: { n: 8, cadence: 25, lastGap: 20, shrink: true },
    };
    const cfgP = patterns[od.pattern];
    const bulkProduct = productByCode.get('APT2')!;
    for (let j = 0; j < cfgP.n; j++) {
      invoiceSeq++;
      const kvInvoiceId = `KVINV_${invoiceSeq}`;
      // hóa đơn j: gần nhất (j=0) cách lastGap; cũ hơn cộng cadence
      const dAgo = cfgP.lastGap + j * cfgP.cadence;
      const purchaseDate = daysBefore(dAgo);
      // shrink: hóa đơn gần đây số lượng ít hơn
      const qty = cfgP.shrink ? (j < cfgP.n / 2 ? 3 : 12) : 10;
      lineSeq++;
      const kvInvoiceLineId = `KVLINE_${lineSeq}`;
      const total = bulkProduct.def.price * qty;
      await prisma.kvInvoice.create({
        data: {
          kvInvoiceId,
          code: `HDS${String(invoiceSeq).padStart(5, '0')}`,
          kvCustomerId: kvId,
          purchaseDate,
          total,
          status: 'completed',
          kvModifiedAt: purchaseDate,
        },
      });
      await prisma.kvInvoiceLine.create({
        data: {
          kvInvoiceLineId,
          kvInvoiceId,
          kvProductId: bulkProduct.kvProductId,
          quantity: qty,
          price: bulkProduct.def.price,
        },
      });
    }
    // stockout exception cho org paused? Không — paused riêng. Thêm 1 org stockout demo:
  }

  // ============================================================
  // 6) Consultations (mức MUST)
  // ============================================================
  const consultCust = runtime.find((r) => r.babyIds.length > 0)!;
  const consult = await prisma.consultation.create({
    data: {
      customerId: consultCust.customerId,
      babyId: consultCust.babyIds[0]!.id,
      issue: 'Bé bị táo bón, hỏi men vi sinh',
      temperature: 'am',
      result: 'chua_chot',
      nextContactDate: daysBefore(-3),
      note: 'Hẹn gọi lại tư vấn thêm',
      createdBy: cskhId,
    },
  });
  await prisma.consultationAdvisedProduct.create({
    data: { consultationId: consult.id, kvProductId: productByCode.get('BIOGAIA')!.kvProductId },
  });
  // nextContactDate => follow_up service_contact (không bị trần)
  await prisma.followUp.create({
    data: {
      targetType: 'customer',
      customerId: consultCust.customerId,
      reminderType: 'consultation_followup',
      dueDate: daysBefore(-3),
      assigneeId: cskhId,
      status: 'den_han',
      priority: 3,
      frequencyCapScope: 'service_contact',
      content: 'Gọi lại tư vấn táo bón cho bé (đã hẹn).',
    },
  });

  // ============================================================
  // 7) Experiment holdout (một số khách vào nhóm holdout)
  // ============================================================
  const experiment = await prisma.experiment.create({
    data: {
      name: 'Thí nghiệm nhắc tái mua Q3',
      startAt: daysBefore(60),
      holdoutRatio: 0.1,
      status: 'running',
      createdBy: ownerId,
      minSampleTreatment: 20,
      minSampleHoldout: 5,
    },
  });
  // 🔴 EXP-01: gán nhóm theo hash(customerId+experimentId) — ~10% holdout, ổn định.
  // 🔴 6 LUẬT LOẠI TRỪ KHÓA CỨNG: áp qua predicate engine `isExcludedFromExperiment` (KHÔNG ad-hoc) —
  // khách bị loại KHÔNG vào thí nghiệm (không treatment, không holdout). Signals lấy từ dữ liệu seed:
  //   - VIP: 'both_1' (khách vừa lẻ vừa sỉ).
  //   - service_contact/khiếu nại: khách có việc frequencyCapScope='service_contact' (consultCust).
  const holdoutCustomerIds = new Set<string>();
  const treatmentCustomerIds = new Set<string>();
  const vipKeys = new Set<string>(['both_1']);
  const serviceContactKeys = new Set<string>([consultCust.def.key]);
  for (const r of runtime) {
    if (!r.def.roles.includes('retail_customer')) continue;
    // 🔴 loại trừ theo hợp đồng engine — đảm bảo VIP/service_contact… KHÔNG bao giờ vào nhóm holdout.
    const excluded = isExcludedFromExperiment({
      isVip: vipKeys.has(r.def.key),
      agencyAtRisk: false,
      callbackRequested: false,
      hasComplaint: serviceContactKeys.has(r.def.key),
      hasOpenOrderDeliveryDebt: false,
      isServiceContact: serviceContactKeys.has(r.def.key),
    }).excluded;
    if (excluded) continue;
    const group = assignExperimentGroup(r.customerId, experiment.id, Number(experiment.holdoutRatio));
    await prisma.experimentAssignment.create({
      data: { experimentId: experiment.id, customerId: r.customerId, group: group as never },
    });
    if (group === 'holdout') holdoutCustomerIds.add(r.customerId);
    else treatmentCustomerIds.add(r.customerId);
  }

  // ============================================================
  // 8) Chạy engine sinh follow_ups
  // ============================================================
  const consumptionCreated = await generateConsumptionFollowUps({
    now: ANCHOR,
    consumptionAssigneeIds: [crmId, cskhId],
    ownerId,
    agencyAssigneeIds: [crmId],
    holdoutCustomerIds,
  });
  const replenishmentCreated = await generateReplenishmentFollowUps({
    now: ANCHOR,
    consumptionAssigneeIds: [crmId, cskhId],
    ownerId,
    agencyAssigneeIds: [crmId],
  });

  // ============================================================
  // 8b) follow_up_conversions minh họa (RPT-03/04) — để báo cáo có số.
  //   - treatment: verified + ATTRIBUTED (sau nhắc) — mốc mua SAU ngày nhắc.
  //   - holdout: verified nhưng KHÔNG attributed (mua tự nhiên).
  // ============================================================
  let conversionCount = 0;
  const treatmentFollowUps = await prisma.followUp.findMany({
    where: {
      reminderType: 'consumption',
      customerId: { in: [...treatmentCustomerIds] },
    },
    orderBy: { dueDate: 'asc' },
    take: 8,
  });
  for (const fu of treatmentFollowUps) {
    await prisma.followUpConversion.create({
      data: {
        followUpId: fu.id,
        verificationStatus: 'verified',
        attributionStatus: 'attributed', // 🔴 chỉ Attributed mới vào báo cáo tác động
        customerReport: 'already_purchased',
        // 🔴 FIX-6: mua lại gần đây, TRONG cửa sổ thí nghiệm [startAt, now). daysBefore(2..4) = quá khứ so với now.
        matchedAt: daysBefore(2 + (conversionCount % 3)),
        matchMethod: 'auto',
      },
    });
    conversionCount++;
  }
  // 🔴 FIX-6: minh họa khách có NHIỀU lần mua lại — tử số uplift phải đếm DISTINCT khách (KHÔNG phồng).
  //   Thêm 1 conversion attributed nữa cho CÙNG khách của follow-up đầu ⇒ 2 dòng nhưng chỉ 1 khách distinct.
  const firstTreatmentFu = treatmentFollowUps[0];
  if (firstTreatmentFu) {
    const secondFu =
      (await prisma.followUp.findFirst({
        where: {
          reminderType: 'consumption',
          customerId: firstTreatmentFu.customerId,
          id: { not: firstTreatmentFu.id },
          conversions: { none: {} },
        },
      })) ?? firstTreatmentFu; // fallback: cùng follow-up (vẫn cùng khách ⇒ vẫn minh họa distinct)
    await prisma.followUpConversion.create({
      data: {
        followUpId: secondFu.id,
        verificationStatus: 'verified',
        attributionStatus: 'attributed',
        customerReport: 'already_purchased',
        matchedAt: daysBefore(5),
        matchMethod: 'auto',
      },
    });
    conversionCount++;
  }
  const holdoutFollowUps = await prisma.followUp.findMany({
    where: {
      reminderType: 'consumption',
      customerId: { in: [...holdoutCustomerIds] },
    },
    take: 3,
  });
  for (const fu of holdoutFollowUps) {
    await prisma.followUpConversion.create({
      data: {
        followUpId: fu.id,
        verificationStatus: 'verified',
        attributionStatus: 'not_attributed', // mua tự nhiên (holdout không nhận nhắc)
        customerReport: 'already_purchased',
        matchedAt: daysBefore(20),
        matchMethod: 'auto',
      },
    });
    conversionCount++;
  }

  // ============================================================
  // 9) Hạ tầng ĐỒNG BỘ KiotViet (§11.4) — dữ liệu minh họa cho SCR-12.
  // ============================================================
  const SYNC_OBJECT_TYPES = ['customer', 'product', 'invoice', 'invoice_line', 'return'] as const;
  for (const objectType of SYNC_OBJECT_TYPES) {
    await prisma.syncState.create({
      data: {
        objectType,
        lastCursor: `cursor_${objectType}_${daysBefore(0).toISOString().slice(0, 10)}`,
        lastSyncAt: daysBefore(0), // đồng bộ gần đây
      },
    });
  }
  // sync_events: đủ các trạng thái (pending/processing/done/error/dead_letter).
  const eventPlan: { status: 'pending' | 'processing' | 'done' | 'error' | 'dead_letter'; count: number }[] = [
    { status: 'done', count: 18 },
    { status: 'pending', count: 5 },
    { status: 'processing', count: 2 },
    { status: 'error', count: 3 },
    { status: 'dead_letter', count: 2 },
  ];
  let evSeq = 0;
  for (const plan of eventPlan) {
    for (let k = 0; k < plan.count; k++) {
      evSeq++;
      const objectType = SYNC_OBJECT_TYPES[evSeq % SYNC_OBJECT_TYPES.length]!;
      const createdAt = daysBefore(0);
      // done: mô phỏng độ trễ xử lý (updatedAt sau createdAt vài giây) để tính p95.
      const updatedAt =
        plan.status === 'done' ? new Date(createdAt.getTime() + (1500 + k * 200)) : createdAt;
      await prisma.syncEvent.create({
        data: {
          objectType,
          objectId: `${objectType}_evt_${evSeq}`,
          kvModifiedAt: createdAt,
          eventId: `WH_${evSeq}`,
          payload: { demo: true, objectType } as never,
          status: plan.status as never,
          attempts: plan.status === 'dead_letter' ? 5 : plan.status === 'error' ? 2 : plan.status === 'done' ? 1 : 0,
          // 🔴 FIX-7 (SEC-10): lỗi thô CÓ THỂ chứa URL/token/header — seed cố tình nhét secret giả để
          //   kiểm chứng response /queue ĐÃ scrub (không lộ). Không dùng secret thật.
          error:
            plan.status === 'error'
              ? 'ETIMEDOUT khi gọi https://public.kiotapi.com/webhooks?access_token=kv_live_9f8e7d6c5b4a3210 (mô phỏng)'
              : plan.status === 'dead_letter'
                ? 'HTTP 401 Unauthorized: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE\n    at KiotClient.request (kv.ts:42)'
                : null,
          createdAt,
          updatedAt,
        },
      });
    }
  }
  // sync_reconciliation: T-1 KHỚP TUYỆT ĐỐI (mismatch=0), hôm nay cho phép lệch nhẹ do timing.
  const reconObjects: { objectType: string; kv: number; crm: number }[] = [
    { objectType: 'invoice', kv: await prisma.kvInvoice.count(), crm: await prisma.kvInvoice.count() },
    { objectType: 'invoice_line', kv: await prisma.kvInvoiceLine.count(), crm: await prisma.kvInvoiceLine.count() },
    { objectType: 'return', kv: await prisma.kvReturn.count(), crm: await prisma.kvReturn.count() },
  ];
  for (const r of reconObjects) {
    await prisma.syncReconciliation.create({
      data: { periodLabel: 'T-1', objectType: r.objectType, kvCount: r.kv, crmCount: r.crm, mismatch: 0 },
    });
    await prisma.syncReconciliation.create({
      data: {
        periodLabel: 'today',
        objectType: r.objectType,
        kvCount: r.kv + 2,
        crmCount: r.crm,
        mismatch: 2, // lệch do timing đồng bộ (chấp nhận trong kỳ hôm nay)
        detail: { note: 'Lệch do sự kiện đang trên đường đồng bộ' } as never,
      },
    });
  }
  // api_credentials: đăng ký webhook (KHÔNG lưu secret thật — MVP để trống secretCipher).
  await prisma.apiCredential.create({
    data: {
      provider: 'kiotviet',
      meta: {
        webhooks: [
          { objectType: 'customer', status: 'active', registeredAt: daysBefore(30).toISOString() },
          { objectType: 'product', status: 'active', registeredAt: daysBefore(30).toISOString() },
          { objectType: 'invoice', status: 'active', registeredAt: daysBefore(30).toISOString() },
          { objectType: 'return', status: 'inactive', registeredAt: null },
        ],
      } as never,
    },
  });

  // ============================================================
  // Tổng kết
  // ============================================================
  const counts = {
    users: await prisma.user.count(),
    kvCustomers: await prisma.kvCustomer.count(),
    crmCustomers: await prisma.customerCrm.count(),
    babies: await prisma.babyProfile.count(),
    products: await prisma.kvProduct.count(),
    kvInvoices: await prisma.kvInvoice.count(),
    kvLines: await prisma.kvInvoiceLine.count(),
    allocations: await prisma.invoiceItemBabyAllocation.count(),
    organizations: await prisma.organization.count(),
    followUps: await prisma.followUp.count(),
    holdout: holdoutCustomerIds.size,
    treatment: treatmentCustomerIds.size,
    conversions: conversionCount,
    syncEvents: await prisma.syncEvent.count(),
    syncReconciliation: await prisma.syncReconciliation.count(),
  };

  console.log('\n================ SEED HOÀN TẤT (⚠️ Dữ liệu minh họa) ================');
  console.log('Số liệu:', JSON.stringify(counts, null, 2));
  console.log('Phân bổ bé:', JSON.stringify(allocCounts, null, 2));
  console.log(`Follow-ups tiêu dùng: ${consumptionCreated}, đại lý: ${replenishmentCreated}`);
  console.log('\n---------------- TÀI KHOẢN ĐĂNG NHẬP (mật khẩu: ' + DEMO_PASSWORD + ') ----------------');
  for (const u of USERS) {
    console.log(`  ${u.username.padEnd(14)} | ${u.role.padEnd(16)} | ${u.fullName}`);
  }
  console.log('=====================================================================\n');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed lỗi:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
