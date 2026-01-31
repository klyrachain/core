-- CreateEnum
CREATE TYPE "ProviderRoutingStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "ProviderRouting" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "status" "ProviderRoutingStatus" NOT NULL DEFAULT 'ACTIVE',
    "operational" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "keyHash" TEXT,
    "keyPrefix" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "fee" DECIMAL(5,4),

    CONSTRAINT "ProviderRouting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRouting_code_key" ON "ProviderRouting"("code");

-- CreateIndex
CREATE INDEX "ProviderRouting_code_idx" ON "ProviderRouting"("code");

-- CreateIndex
CREATE INDEX "ProviderRouting_enabled_priority_idx" ON "ProviderRouting"("enabled", "priority");
