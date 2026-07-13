-- CreateTable
CREATE TABLE "throttle_entries" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "firstFailAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "throttle_entries_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "throttle_entries_lockedUntil_idx" ON "throttle_entries"("lockedUntil");
