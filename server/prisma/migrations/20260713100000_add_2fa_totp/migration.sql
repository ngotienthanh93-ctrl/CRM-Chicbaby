-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "pendingTwoFactor" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "trusted_devices" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorSecret" TEXT;

-- CreateTable
CREATE TABLE "two_factor_backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_backup_codes_userId_idx" ON "two_factor_backup_codes"("userId");

-- 🔴 Dedup fingerprint TRƯỚC khi thêm unique index: dữ liệu trusted_devices pre-2FA (semantics cũ) có thể
-- trùng fingerprint và làm CREATE UNIQUE INDEX abort khi deploy. Giữ MỘT hàng mới nhất mỗi fingerprint.
DELETE FROM "trusted_devices"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (PARTITION BY "fingerprint" ORDER BY "createdAt" DESC, "id" DESC) AS rn
    FROM "trusted_devices"
  ) dup WHERE dup.rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_fingerprint_key" ON "trusted_devices"("fingerprint");

-- AddForeignKey
ALTER TABLE "two_factor_backup_codes" ADD CONSTRAINT "two_factor_backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

