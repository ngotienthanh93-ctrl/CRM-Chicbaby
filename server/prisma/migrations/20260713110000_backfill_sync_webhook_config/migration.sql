-- 🔴 Backfill khóa cấu hình worker webhook KiotViet cho DB đã tồn tại. Idempotent (WHERE NOT EXISTS).
-- Giá trị khớp DEFAULT_ENGINE_CONFIG.sync.
INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_sync_max_attempts', 'sync.max_sync_attempts', '5'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'sync.max_sync_attempts');

INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_sync_batch_size', 'sync.processor_batch_size', '50'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'sync.processor_batch_size');

INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_sync_proc_interval', 'sync.processor_interval_minutes', '1'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'sync.processor_interval_minutes');

INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_sync_sig_header', 'sync.webhook_signature_header', '"x-kiotviet-signature"'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'sync.webhook_signature_header');
