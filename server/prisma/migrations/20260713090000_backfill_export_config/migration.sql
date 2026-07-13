-- 🔴 Backfill khóa cấu hình Export CÓ DUYỆT cho DB đã tồn tại (seed chỉ nạp DB mới).
-- Idempotent: chỉ chèn khi CHƯA có version nào của key. Giá trị khớp DEFAULT_ENGINE_CONFIG.export.
INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_export_approval_ttl_hours', 'export.approval_ttl_hours', '72'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'export.approval_ttl_hours');

INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_export_max_rows', 'export.max_rows', '5000'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'export.max_rows');
