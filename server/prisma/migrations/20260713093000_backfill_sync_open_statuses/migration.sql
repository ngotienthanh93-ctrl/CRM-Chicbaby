-- 🔴 Backfill khóa cấu hình danh sách trạng thái đơn KiotViet "đang mở" cho DB đã tồn tại.
-- Idempotent: chỉ chèn khi CHƯA có version nào của key. Giá trị khớp DEFAULT_ENGINE_CONFIG.sync.openOrderStatuses.
INSERT INTO "configuration_versions" ("id", "key", "value", "version", "isActive")
SELECT 'seed_sync_open_order_statuses', 'sync.open_order_statuses',
       '"1,2,draft,processing,pending,delivering,phieu_tam,dang_giao,dang_giao_hang"'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "configuration_versions" WHERE "key" = 'sync.open_order_statuses');
