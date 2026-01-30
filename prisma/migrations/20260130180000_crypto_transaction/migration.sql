-- CreateEnum
CREATE TYPE "CryptoTransactionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "CryptoTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "CryptoTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "fromChainId" INTEGER NOT NULL,
    "toChainId" INTEGER NOT NULL,
    "fromToken" TEXT NOT NULL,
    "toToken" TEXT NOT NULL,
    "fromAmount" TEXT NOT NULL,
    "toAmount" TEXT NOT NULL,
    "txHash" TEXT,
    "txUrl" TEXT,
    "transactionId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "CryptoTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CryptoTransaction_transactionId_idx" ON "CryptoTransaction"("transactionId");
CREATE INDEX "CryptoTransaction_txHash_idx" ON "CryptoTransaction"("txHash");
CREATE INDEX "CryptoTransaction_provider_status_idx" ON "CryptoTransaction"("provider", "status");
CREATE INDEX "CryptoTransaction_createdAt_idx" ON "CryptoTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "CryptoTransaction" ADD CONSTRAINT "CryptoTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
