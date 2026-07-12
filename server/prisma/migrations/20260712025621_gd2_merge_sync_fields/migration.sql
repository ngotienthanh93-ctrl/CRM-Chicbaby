-- AlterTable
ALTER TABLE "baby_profiles" ADD COLUMN     "suspectedDuplicateBaby" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "merge_unmerge_tickets" (
    "id" TEXT NOT NULL,
    "mergeHistoryId" TEXT,
    "masterId" TEXT NOT NULL,
    "mergedId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requestedBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_unmerge_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merge_unmerge_tickets_status_idx" ON "merge_unmerge_tickets"("status");

-- CreateIndex
CREATE INDEX "merge_history_masterId_idx" ON "merge_history"("masterId");
