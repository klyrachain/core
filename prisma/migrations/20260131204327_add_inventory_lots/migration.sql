-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT NOT NULL,
    "quantity" DECIMAL(28,8) NOT NULL,
    "costPerToken" DECIMAL(18,8) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT,
    "sourceTransactionId" TEXT,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLot_assetId_acquiredAt_idx" ON "InventoryLot"("assetId", "acquiredAt");

-- CreateIndex
CREATE INDEX "InventoryLot_sourceTransactionId_idx" ON "InventoryLot"("sourceTransactionId");

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
