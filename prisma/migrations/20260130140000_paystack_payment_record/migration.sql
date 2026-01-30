-- CreateTable
CREATE TABLE "PaystackPaymentRecord" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "paystackId" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(18,8),
    "currency" TEXT,
    "paidAt" TIMESTAMP(3),
    "channel" TEXT,
    "gatewayResponse" TEXT,
    "customerEmail" TEXT,
    "metadata" JSONB,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaystackPaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaystackPaymentRecord_reference_key" ON "PaystackPaymentRecord"("reference");

-- CreateIndex
CREATE INDEX "PaystackPaymentRecord_transactionId_idx" ON "PaystackPaymentRecord"("transactionId");

-- CreateIndex
CREATE INDEX "PaystackPaymentRecord_paystackId_idx" ON "PaystackPaymentRecord"("paystackId");

-- CreateIndex
CREATE INDEX "PaystackPaymentRecord_status_idx" ON "PaystackPaymentRecord"("status");

-- AddForeignKey
ALTER TABLE "PaystackPaymentRecord" ADD CONSTRAINT "PaystackPaymentRecord_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
