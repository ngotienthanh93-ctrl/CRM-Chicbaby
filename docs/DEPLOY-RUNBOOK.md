# DEPLOY RUNBOOK — CRM Chicbaby

Quy trình deploy an toàn cho nhánh `feature/customer-social-links` (PR #6) và các lần deploy có migration Prisma nói chung.

Production (theo CLAUDE.md): `npm run build` (build client) → `npm start` — Express phục vụ client tĩnh trên **cổng 4000**. Migration chạy bằng `prisma migrate deploy`.

---

## 0. Trước khi deploy (chuẩn bị 1 lần)

- [ ] **Backup / bật PITR** DB production về mốc trước deploy. (Migration lần này thuần cộng thêm, rủi ro mất data ~0, nhưng backup là bắt buộc.)
- [ ] Chuẩn bị `.env` production: `DATABASE_URL`, secrets. KHÔNG commit `.env`.
- [ ] Đã test migration trên **bản COPY dữ liệu prod** (staging), không chỉ local.

### 0.1 🔴 Pre-create Postgres extensions (QUAN TRỌNG)

Migration `20260714130000_customer_search_unaccent_trgm` chạy `CREATE EXTENSION unaccent; CREATE EXTENSION pg_trgm;`. Nếu role trong `DATABASE_URL` **không** có quyền tạo extension, `migrate deploy` sẽ FAIL.

**An toàn nhất — admin tạo trước, rồi migration `IF NOT EXISTS` thành no-op:**

```sql
-- chạy bằng superuser / rds_superuser / cloudsqlsuperuser
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- **AWS RDS**: đăng nhập bằng `rds_superuser`; cả 2 extension nằm trong danh sách hỗ trợ.
- **GCP Cloud SQL**: `cloudsqlsuperuser` (hoặc bật qua flags); cả 2 được hỗ trợ.
- **Azure Database for PostgreSQL**: thêm `unaccent`,`pg_trgm` vào `azure.extensions` rồi tạo.
- **Self-hosted**: chạy bằng user `postgres` (superuser).

---

## 1. Deploy

```bash
# 1) Lấy code (đã merge PR #6 vào main)
git checkout main && git pull

# 2) Cài dependencies
npm install

# 3) 🔴 Áp migration (KHÔNG dùng db push / migrate reset trên prod)
npm run db:deploy -w server        # = prisma migrate deploy

# 4) Build client
npm run build

# 5) Khởi động (cổng 4000)
npm start
```

> ⚠️ **Lock khi tạo index**: migration tạo 2 index GIN trên `customers_crm` + 1 index trên `audit_logs` bằng `CREATE INDEX` (không `CONCURRENTLY`) → khóa GHI bảng đó trong lúc build. Với dữ liệu hiện tại (nhỏ) chỉ vài ms. Nếu prod các bảng này lớn, cân nhắc:
> - Deploy vào **giờ thấp tải**, hoặc
> - Tạo index thủ công **`CONCURRENTLY`** trước, rồi mới `migrate deploy` (migration dùng `IF NOT EXISTS` nên sẽ bỏ qua index đã có).

---

## 2. Sau deploy — kiểm tra sống (smoke test)

```bash
# App phục vụ trên cổng 4000
curl -s -o /dev/null -w "root:%{http_code}\n" http://localhost:4000/

# Đăng nhập + kiểm tra search khách không dấu hoạt động (thay cookie/host thật)
# Gõ "nguyen" phải ra "Nguyễn..."; "0977" (SĐT một phần) phải ra kết quả.
```

- [ ] Đăng nhập được.
- [ ] Màn Khách hàng: gõ tên **không dấu** ra kết quả (live, không cần bấm Tìm).
- [ ] Card "Việc hôm nay" hiện nút Zalo/Facebook khi khách/đại lý có link.
- [ ] Marketing (không `viewSensitive`) tìm SĐT → rỗng (SEC-07 còn nguyên).

---

## 3. Đường lùi (rollback)

Migration lần này **thuần cộng thêm** — không mất dữ liệu, nên hiếm khi cần lùi schema. Nếu buộc phải:

- Prisma **không có down-migration**. Lùi = phục hồi từ backup/PITR ở bước 0, hoặc thủ công:
  ```sql
  DROP INDEX IF EXISTS customers_crm_fullname_unaccent_trgm_idx;
  DROP INDEX IF EXISTS customers_crm_dispname_unaccent_trgm_idx;
  DROP FUNCTION IF EXISTS immutable_unaccent(text);
  -- cột/bảng mới: DROP COLUMN / DROP TABLE tương ứng nếu thực sự cần
  ```
- **Không** `git revert` migration đã applied rồi deploy lại — sẽ lệch checksum. Tạo migration mới nếu cần đảo ngược.

---

## 4. Checklist tóm tắt

- [ ] Backup/PITR xong.
- [ ] Đã pre-create `unaccent` + `pg_trgm` (hoặc chắc chắn role có quyền `CREATE EXTENSION`).
- [ ] `npm run db:deploy -w server` chạy sạch (không `db push`/`reset`).
- [ ] `npm run build` sạch, `npm start` lên cổng 4000.
- [ ] Smoke test mục 2 pass.
