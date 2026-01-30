-- AlterTable
ALTER TABLE "PayoutRequest" ADD COLUMN "recipientName" TEXT;
ALTER TABLE "PayoutRequest" ADD COLUMN "recipientType" TEXT;

-- CreateTable
CREATE TABLE "PaystackTransferRecord" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "transferCode" TEXT NOT NULL,
    "payoutRequestId" TEXT,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipientName" TEXT,
    "reason" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaystackTransferRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaystackTransferRecord_reference_key" ON "PaystackTransferRecord"("reference");
CREATE INDEX "PaystackTransferRecord_payoutRequestId_idx" ON "PaystackTransferRecord"("payoutRequestId");
CREATE INDEX "PaystackTransferRecord_status_idx" ON "PaystackTransferRecord"("status");
CREATE INDEX "PaystackTransferRecord_transferCode_idx" ON "PaystackTransferRecord"("transferCode");

-- AddForeignKey
ALTER TABLE "PaystackTransferRecord" ADD CONSTRAINT "PaystackTransferRecord_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
