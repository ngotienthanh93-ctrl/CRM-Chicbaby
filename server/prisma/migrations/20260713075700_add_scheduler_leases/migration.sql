-- CreateTable
CREATE TABLE "scheduler_leases" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "holder" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("name")
);
