# CRM Chicbaby

Phần mềm CRM cho Chicbabyshop (sữa & TPCN cho mẹ và bé). Monorepo npm workspaces:

- `server/` — Express 5 + Prisma + PostgreSQL (cổng **4000**). Đã có sẵn, chạy được.
- `client/` — React 18 + Vite + TypeScript (dev cổng **5173**, proxy `/api` → 4000).

> Mục tiêu, một câu: **"Hôm nay tôi gọi ai, nói gì?"** — biến lịch sử giao dịch thành danh sách việc cần gọi.

## Yêu cầu
- Node.js >= 20 (khuyến nghị 24)
- Docker (chạy PostgreSQL dev)

## Cài đặt
```bash
docker compose up -d              # bật PostgreSQL (container chicbaby-crm-pg, cổng 5433)
npm install                       # cài root + workspaces (server + client)
cp .env.example .env              # rồi chỉnh biến môi trường nếu cần
npm run db:migrate -w server      # tạo schema
npm run db:seed -w server         # nạp dữ liệu minh họa (in ra tài khoản test ở cuối)
```

## Chạy (dev)
```bash
npm run dev
```
Chạy **song song** server (4000) + client (5173) bằng `concurrently`.
Mở **http://localhost:5173** — Vite proxy `/api` sang backend 4000, giữ cookie phiên (httpOnly).

Chạy riêng lẻ:
```bash
npm run dev:server    # chỉ backend (4000)
npm run dev:client    # chỉ frontend (5173)
```

## Build & production
```bash
npm run build          # build client (tsc typecheck + vite build) -> client/dist
npm run build:server   # build backend (prisma generate + tsc)
npm start              # chạy backend đã build (cổng 4000)
```
> Ghi chú: `npm start` hiện chỉ chạy **API server**. Backend chưa cấu hình phục vụ file tĩnh
> của client (không được phép sửa `server/` trong đợt này). Để chạy production bản dựng client,
> phục vụ thư mục `client/dist` bằng một static server bất kỳ (vd `npx serve client/dist`) và
> để nó gọi API ở cổng 4000, hoặc thêm middleware static vào server ở đợt sau.

## Tài khoản test (từ seed)
Mật khẩu chung: `chicbaby@123`

| username | vai | thấy gì |
|---|---|---|
| `chushop` | Chủ shop | toàn quyền; duyệt chu kỳ SP; xử lý at_risk |
| `crm` | CRM Officer | khách, bé, phân bổ, việc; đề xuất chu kỳ |
| `cskh` | CSKH | khách, bé, phân bổ, việc; xem đại lý |
| `marketing` | Marketing | 🔒 KHÔNG thấy bé/tư vấn/phân bổ/đại lý; SĐT bị mask |
| `trolydulieu` | Trợ lý dữ liệu | theo dõi cấu hình; KHÔNG xem dữ liệu nhạy cảm |

## Màn hình (client/src/screens)
- **SCR-01** Đăng nhập
- **SCR-02** Việc hôm nay (màn chính, gộp cả 2 động cơ nhắc)
- **SCR-03** Danh sách khách · **SCR-04** Khách 360 · **SCR-05** Hồ sơ bé (tab trong SCR-04)
- **SCR-07** Phân bổ hóa đơn cho bé (phím tắt Enter/↑↓/Tab/S/C/Esc)
- **SCR-08** Cấu hình chu kỳ SP · **SCR-09** Hồ sơ đại lý

## Cấu trúc client
```
client/src/
├── api/          client REST (fetch + credentials) + kiểu dữ liệu khớp backend
├── app/          AuthContext, Shell (topbar/sidebar/bottom-nav), nav theo quyền
├── components/   Badge, Modal/BottomSheet, Toast, trạng thái loading/empty/error
├── hooks/        useApi (4 trạng thái màn)
├── lib/          nhãn tiếng Việt cho enum + helper
├── screens/      SCR-01..09
└── styles/       design-system.css (tokens Phụ lục A) + shell.css + screens.css
```
