-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "providerPrice" DECIMAL(18,8);

-- CreateTable
CREATE TABLE "TransactionPnL" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(28,8) NOT NULL,
    "costPerToken" DECIMAL(18,8) NOT NULL,
    "providerPrice" DECIMAL(18,8) NOT NULL,
    "sellingPrice" DECIMAL(18,8) NOT NULL,
    "feeAmount" DECIMAL(18,8) NOT NULL,
    "profitLoss" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "TransactionPnL_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionPnL_transactionId_idx" ON "TransactionPnL"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionPnL_lotId_idx" ON "TransactionPnL"("lotId");

-- AddForeignKey
ALTER TABLE "TransactionPnL" ADD CONSTRAINT "TransactionPnL_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionPnL" ADD CONSTRAINT "TransactionPnL_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
