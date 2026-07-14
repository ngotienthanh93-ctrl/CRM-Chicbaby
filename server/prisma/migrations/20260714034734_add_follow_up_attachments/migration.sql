-- CreateTable
CREATE TABLE "follow_up_attachments" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "follow_up_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_up_attachments_followUpId_idx" ON "follow_up_attachments"("followUpId");

-- AddForeignKey
ALTER TABLE "follow_up_attachments" ADD CONSTRAINT "follow_up_attachments_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
