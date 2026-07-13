-- 🔴 SYNC-03: thêm khóa idempotency KHÔNG-NULL cho sync_events (Postgres unique không chặn NULL trùng).
-- Backfill hàng cũ = id (đã unique ⇒ không đụng nhau, không cần dedup). Hàng mới dùng khóa dẫn xuất canonical.
ALTER TABLE "sync_events" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "sync_events" SET "idempotencyKey" = "id" WHERE "idempotencyKey" IS NULL;
ALTER TABLE "sync_events" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "sync_events_idempotencyKey_key" ON "sync_events"("idempotencyKey");
