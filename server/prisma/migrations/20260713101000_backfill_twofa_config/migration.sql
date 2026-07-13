-- 🔴 Backfill khóa cấu hình 2FA cho DB đã tồn tại (seed chỉ nạp DB mới). Idempotent (WHERE NOT EXISTS).
-- Giá trị khớp DEFAULT_ENGINE_CONFIG.twofa.
INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_twofa_trusted_device_days', 'twofa.trusted_device_days', '30'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'twofa.trusted_device_days');

INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_twofa_backup_code_count', 'twofa.backup_code_count', '10'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'twofa.backup_code_count');
