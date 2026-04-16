-- CreateEnum
CREATE TYPE "GasLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "GasLedgerReason" AS ENUM ('TOPUP', 'SPONSORSHIP', 'ADJUSTMENT', 'REFUND');

-- CreateTable
CREATE TABLE "PlatformGasSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sponsorshipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxUsdPerTx" DECIMAL(18,2),
    "notes" TEXT,

    CONSTRAINT "PlatformGasSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessGasAccount" (
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "prepaidBalanceUsd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sponsorshipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lowBalanceWarnUsd" DECIMAL(18,2),

    CONSTRAINT "BusinessGasAccount_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "GasLedgerEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,
    "direction" "GasLedgerDirection" NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "reason" "GasLedgerReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "GasLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GasReservation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "GasReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GasLedgerEntry_idempotencyKey_key" ON "GasLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GasLedgerEntry_businessId_createdAt_idx" ON "GasLedgerEntry"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GasReservation_idempotencyKey_key" ON "GasReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GasReservation_businessId_idx" ON "GasReservation"("businessId");

-- CreateIndex
CREATE INDEX "GasReservation_expiresAt_idx" ON "GasReservation"("expiresAt");

-- AddForeignKey
ALTER TABLE "BusinessGasAccount" ADD CONSTRAINT "BusinessGasAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GasLedgerEntry" ADD CONSTRAINT "GasLedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GasReservation" ADD CONSTRAINT "GasReservation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessGasAccount"("businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Insert default platform gas settings row
INSERT INTO "PlatformGasSettings" ("id", "updatedAt", "sponsorshipEnabled" ) VALUES ('default', CURRENT_TIMESTAMP, false);
