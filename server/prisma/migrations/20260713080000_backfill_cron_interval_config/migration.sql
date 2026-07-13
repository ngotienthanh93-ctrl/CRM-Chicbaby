-- 🔴 §7.1 — Backfill khóa cấu hình chu kỳ cron worker holdout cho DB ĐÃ TỒN TẠI.
-- `db:seed` chỉ nạp catalogue cho DB mới; DB production đã seed từ trước sẽ THIẾU key này,
-- khiến admin không đổi/tắt được cron qua SCR-14 (PUT /api/config/:key trả 404 khi key chưa có row).
-- Idempotent: CHỈ chèn khi CHƯA có bất kỳ version nào của key (không đụng nếu admin đã tạo/đổi).
-- value = 60 (phút) khớp DEFAULT_ENGINE_CONFIG.experiment.cronIntervalMinutes; 0 = tắt cron.
INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_experiment_cron_interval', 'experiment.cron_interval_minutes', '60'::jsonb, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM "configuration_versions" WHERE "key" = 'experiment.cron_interval_minutes'
);
