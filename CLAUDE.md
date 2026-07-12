# CLAUDE.md — CRM Chicbaby

Phần mềm CRM cho **Chicbabyshop** (sữa & TPCN cho mẹ và bé). CRM **chỉ đọc** dữ liệu giao dịch từ KiotViet
(mirror), và **sở hữu** dữ liệu quan hệ khách hàng (hồ sơ bé, tư vấn, nhắc tái mua, hồ sơ đại lý, consent).
Nguồn spec đầy đủ: **`docs/SPEC-DIGEST.md`** (bản cô đọng của FDS v1.1 + PRD v1.1 + UI Spec v1.3). Đọc nó
trước khi code bất kỳ tính năng nghiệp vụ nào.

> Mục tiêu sản phẩm, một câu: **"Hôm nay tôi gọi AI, nói GÌ?"** — biến lịch sử giao dịch thành danh sách việc cần gọi.

## Tech stack (đã chốt)
- **Backend**: Node.js 24 + Express 5 + TypeScript (chạy dev bằng `tsx`). ORM: **Prisma**. DB: **PostgreSQL 16**.
- **Frontend**: React 18 + Vite + TypeScript. Không dùng CSS framework nặng — design system CSS thuần theo Phụ lục A UI Spec.
- **DB dev**: container Docker `chicbaby-crm-pg` (host port **5433**), xem `docker-compose.yml`. `DATABASE_URL` trong `.env`.
- **Cổng server: 4000** (KHÔNG dùng 3000 — bị dự án ERP chiếm). Vite dev: 5173, proxy `/api` → 4000.
- Không phụ thuộc dịch vụ ngoài để chạy được (OTP/webhook KiotViet được mock ở MVP).

## Cấu trúc thư mục
```
/                      workspace gốc (npm workspaces: server, client)
├── docker-compose.yml PostgreSQL dev
├── docs/SPEC-DIGEST.md  ← HỢP ĐỒNG nghiệp vụ + mô hình dữ liệu + màn hình
├── server/            Express API + Prisma
│   ├── prisma/schema.prisma   mô hình dữ liệu (CRM-owned + kv_* mirror)
│   ├── prisma/seed.ts         dữ liệu minh họa (LUÔN gắn nhãn "Dữ liệu minh họa")
│   └── src/
│       ├── index.ts           bootstrap (listen 4000)
│       ├── app.ts             khai báo Express app, mount routes
│       ├── lib/               prisma client, chuẩn hóa SĐT, ngày giờ (UTC↔VN), crypto
│       ├── middleware/        auth (session), rbac, error handler
│       ├── security/          masking dữ liệu nhạy cảm (SERVER-SIDE), audit
│       ├── engines/           reminderEngine (consumption), replenishmentEngine (wholesale)
│       └── modules/           auth, customers, babies, allocations, followups,
│                              organizations, products, sync, config, reports
└── client/            React + Vite
    └── src/
        ├── styles/design-system.css   tokens Phụ lục A (màu, type scale, spacing)
        ├── app/       shell (sidebar desktop / bottom-nav mobile), router, auth context
        ├── api/       client gọi REST
        └── screens/   SCR-01..SCR-09 (ưu tiên SCR-02, 04, 05, 07, 09)
```

## Chạy dự án
```bash
docker compose up -d                 # bật PostgreSQL (nếu chưa chạy)
npm install                          # cài root + workspaces
npm run db:migrate -w server         # prisma migrate dev
npm run db:seed -w server            # nạp dữ liệu minh họa
npm run dev                          # chạy server (4000) + client (5173) song song
```
Mở http://localhost:5173 . Đăng nhập bằng tài khoản seed (in ra ở cuối `db:seed`).
Production: `npm run build` (build client) rồi `npm start` — Express phục vụ client tĩnh trên cổng 4000.

## Quy ước code
- TypeScript strict. Tên biến/hàm/bảng bằng **tiếng Anh**; chuỗi hiển thị & comment giải thích nghiệp vụ bằng **tiếng Việt**.
- Múi giờ: **lưu UTC** trong DB; **hiển thị & tính `due_date`/ngày kinh doanh theo `Asia/Ho_Chi_Minh`** (DT-01..06).
- Tiền/giao dịch: **nguồn luôn là KiotViet** — CRM không tự tính lại tài chính. Bảng `kv_*` là mirror **chỉ đọc**,
  chỉ worker sync được ghi (DM-04). UI không có nút Lưu cho trường nguồn KV; badge "KV · chỉ đọc" (UI-01).
- Mọi quan hệ 1-nhiều là **bảng riêng**, KHÔNG lưu mảng trong một cột (DM-01).
- **Audit log append-only** (không sửa/xóa). Soft-delete cho dữ liệu CRM (DM-02). Mọi thực thể có trạng thái ⇒ bảng `*_state_history` (DM-03).
- Idempotency cho thao tác ghi; optimistic locking (`version`) cho bản ghi sửa đồng thời (CONC-02/03).

## Nguyên tắc BẤT BIẾN (vi phạm = sai nghiệp vụ nghiêm trọng)
1. **ĐƯỢC PHÉP NHẮC KHI CHƯA BIẾT BÉ. TUYỆT ĐỐI KHÔNG ĐOÁN BÉ.** Hồ sơ bé SAI tệ hơn hồ sơ bé TRỐNG.
2. Chỉ **tự gắn bé** (auto_assigned) khi: khách có **đúng 1 bé** + SP `baby_specific` + giao dịch **bán lẻ** + không cờ quà/mua hộ. Ngược lại: `suggested` (baby_id NULL) hoặc `customer_level` (baby_id + suggested_baby_id đều NULL).
3. Chỉ **`approved_cycle_days`** được dùng để tính nhắc. Hệ thống **không bao giờ tự ghi đè** `approved_cycle_days`.
4. Nhịp nhập đại lý = **TRUNG VỊ (median)**, không phải trung bình. Chưa đủ **≥3 lần nhập** ⇒ "đang thu thập", KHÔNG cảnh báo.
5. **Trần chống làm phiền theo loại việc** (`frequency_cap_scope`): `service_contact` **KHÔNG BAO GIỜ bị trần** (khiếu nại/hẹn gọi lại vẫn gọi được).
6. Bảo mật dữ liệu nhạy cảm **SERVER-SIDE**: backend KHÔNG gửi SĐT/tên bé/tư vấn xuống client nếu không đủ quyền (mask ở server). Marketing gọi API dữ liệu bé ⇒ **403**, không phải ẩn ở UI.
7. **KHÔNG tự động gộp khách**; chỉ Chủ shop duyệt. KHÔNG gợi ý gộp chỉ vì tên giống nhau.
8. Consent rút lại "chăm sóc & nhắc tái mua" ⇒ **ngừng NGAY** mọi nhắc chủ động (`service_contact` vẫn được).
9. Cấu hình có version + audit; mọi ngưỡng/tham số **cấu hình được**, không hard-code (Phụ lục B).
10. Tuổi bé **trôi theo thời gian**: lưu `estimated_birth_month`/`birth_date`, LUÔN tính tuổi hiện tại, KHÔNG đọc thẳng `age_months_at_recording`.

## Tài liệu tham chiếu
- `docs/SPEC-DIGEST.md` — luật nghiệp vụ đã khóa, mô hình dữ liệu, màn hình, RBAC, catalogue cấu hình, UAT chính.
- Mã quy tắc (VD `BABY-08`, `REM-R-05`, `SEC-04`) tra trong SPEC-DIGEST; nếu cần chi tiết hơn hỏi người dùng (FDS/PRD/UI Spec gốc nằm ngoài repo).
