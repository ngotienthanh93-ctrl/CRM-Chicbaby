-- Tìm khách không dấu + chịu lỗi gõ (unaccent + pg_trgm) và tìm SĐT một phần.
-- Migration THUẦN ADDITIVE (không destructive): chỉ thêm extension, hàm helper, index.
-- Lưu ý cột: bảng snake_case (@@map) nhưng CỘT giữ camelCase của Prisma ⇒ raw SQL phải quote "camelCase".

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() mặc định là STABLE ⇒ KHÔNG dùng được trong functional index.
-- Bọc IMMUTABLE (an toàn: từ điển unaccent không đổi) để index + so khớp không dấu ổn định.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Index trigram trên tên đã bỏ dấu + lowercase để LIKE/similarity nhanh.
CREATE INDEX IF NOT EXISTS customers_crm_fullname_unaccent_trgm_idx
  ON customers_crm USING gin (immutable_unaccent(lower("fullName")) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_crm_dispname_unaccent_trgm_idx
  ON customers_crm USING gin (immutable_unaccent(lower(coalesce("displayName", ''))) gin_trgm_ops);
