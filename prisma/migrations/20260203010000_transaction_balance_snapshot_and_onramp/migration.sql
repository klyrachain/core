-- Transaction: optional fields for settlement quote tracking and onramp send tx hash
ALTER TABLE "Transaction" ADD COLUMN "settlementQuoteSnapshot" JSONB;
ALTER TABLE "Transaction" ADD COLUMN "cryptoSendTxHash" TEXT;

-- Claim: OTP verification timestamp (claim allowed only after OTP verified)
ALTER TABLE "Claim" ADD COLUMN "otpVerifiedAt" TIMESTAMP(3);

-- TransactionBalanceSnapshot: balance before/after per asset per transaction (audit trail)
CREATE TABLE "TransactionBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balanceBefore" DECIMAL(28,8) NOT NULL,
    "balanceAfter" DECIMAL(28,8) NOT NULL,

    CONSTRAINT "TransactionBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransactionBalanceSnapshot_transactionId_idx" ON "TransactionBalanceSnapshot"("transactionId");
CREATE INDEX "TransactionBalanceSnapshot_assetId_idx" ON "TransactionBalanceSnapshot"("assetId");

ALTER TABLE "TransactionBalanceSnapshot" ADD CONSTRAINT "TransactionBalanceSnapshot_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionBalanceSnapshot" ADD CONSTRAINT "TransactionBalanceSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
