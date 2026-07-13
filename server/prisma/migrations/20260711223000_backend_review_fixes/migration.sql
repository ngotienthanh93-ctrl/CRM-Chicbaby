-- ============================================================
-- Backend review fixes (FIX-3, FIX-6, FIX-7)
-- ============================================================

-- FIX-6 (§8.5/§2.5): 1 dòng hóa đơn -> NHIỀU allocation (chia SL cho nhiều bé).
-- Bỏ unique trên kvInvoiceLineId, thay bằng index thường.
DROP INDEX "invoice_item_baby_allocations_kvInvoiceLineId_key";

CREATE INDEX "invoice_item_baby_allocations_kvInvoiceLineId_idx" ON "invoice_item_baby_allocations"("kvInvoiceLineId");

-- FIX-3 (REM-R-04/SYNC-03): khóa nguồn xác định để generate idempotent.
-- Nullable-unique (Postgres cho nhiều NULL) — generate luôn set giá trị.
ALTER TABLE "reminder_sources" ADD COLUMN     "sourceKey" TEXT;

CREATE UNIQUE INDEX "reminder_sources_sourceKey_key" ON "reminder_sources"("sourceKey");

-- ============================================================
-- 🔴 FIX-7 (BABY-01/02): hồ sơ bé PHẢI luôn tính được tuổi.
-- Bất biến: birthDate HOẶC estimatedBirthMonth HOẶC (ageMonthsAtRecording + ageRecordedAt).
-- Prisma không hỗ trợ CHECK trong schema => append thủ công vào migration.
-- ============================================================
ALTER TABLE "baby_profiles"
  ADD CONSTRAINT "chk_baby_age_identity"
  CHECK (
    "birthDate" IS NOT NULL
    OR "estimatedBirthMonth" IS NOT NULL
    OR ("ageMonthsAtRecording" IS NOT NULL AND "ageRecordedAt" IS NOT NULL)
  );
