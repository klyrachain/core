-- Inventory USD cost basis: InventoryLot uses costPerTokenUsd/totalCostUsd and original/remaining quantity; InventoryHistory -> InventoryLedger with USD fields; TransactionPnL USD-only.

-- 1. Enums
CREATE TYPE "LotStatus" AS ENUM ('OPEN', 'DEPLETED');
CREATE TYPE "LedgerType" AS ENUM ('ACQUIRED', 'DISPOSED', 'REBALANCE');

-- 2. InventoryLot: add new columns (nullable), backfill, set NOT NULL, drop old
ALTER TABLE "InventoryLot" ADD COLUMN "originalQuantity" DECIMAL(28,8);
ALTER TABLE "InventoryLot" ADD COLUMN "remainingQuantity" DECIMAL(28,8);
ALTER TABLE "InventoryLot" ADD COLUMN "costPerTokenUsd" DECIMAL(28,8);
ALTER TABLE "InventoryLot" ADD COLUMN "totalCostUsd" DECIMAL(28,8);
ALTER TABLE "InventoryLot" ADD COLUMN "status" "LotStatus";

UPDATE "InventoryLot"
SET
  "originalQuantity" = "quantity",
  "remainingQuantity" = "quantity",
  "costPerTokenUsd" = "costPerToken",
  "totalCostUsd" = "quantity" * "costPerToken",
  "status" = CASE WHEN "quantity" > 0 THEN 'OPEN'::"LotStatus" ELSE 'DEPLETED'::"LotStatus" END;

ALTER TABLE "InventoryLot" ALTER COLUMN "originalQuantity" SET NOT NULL;
ALTER TABLE "InventoryLot" ALTER COLUMN "remainingQuantity" SET NOT NULL;
ALTER TABLE "InventoryLot" ALTER COLUMN "costPerTokenUsd" SET NOT NULL;
ALTER TABLE "InventoryLot" ALTER COLUMN "totalCostUsd" SET NOT NULL;
ALTER TABLE "InventoryLot" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "InventoryLot" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "InventoryLot" DROP COLUMN "quantity";
ALTER TABLE "InventoryLot" DROP COLUMN "costPerToken";

-- 3. InventoryLedger (replaces InventoryHistory)
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "quantity" DECIMAL(28,8) NOT NULL,
    "pricePerTokenUsd" DECIMAL(28,8) NOT NULL,
    "totalValueUsd" DECIMAL(28,8) NOT NULL,
    "referenceId" TEXT NOT NULL DEFAULT '',
    "counterparty" TEXT,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryLedger_assetId_idx" ON "InventoryLedger"("assetId");
CREATE INDEX "InventoryLedger_createdAt_idx" ON "InventoryLedger"("createdAt");

INSERT INTO "InventoryLedger" ("id", "createdAt", "assetId", "type", "quantity", "pricePerTokenUsd", "totalValueUsd", "referenceId", "counterparty")
SELECT
    "id",
    "createdAt",
    "assetId",
    CASE
        WHEN "type" = 'PURCHASE' THEN 'ACQUIRED'::"LedgerType"
        WHEN "type" = 'SALE' THEN 'DISPOSED'::"LedgerType"
        ELSE 'REBALANCE'::"LedgerType"
    END,
    "quantity",
    "initialPurchasePrice",
    "quantity" * "initialPurchasePrice",
    '',
    NULL
FROM "InventoryHistory";

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "InventoryHistory";

-- 4. TransactionPnL: add USD columns, backfill, drop old
ALTER TABLE "TransactionPnL" ADD COLUMN "costPerTokenUsd" DECIMAL(28,8);
ALTER TABLE "TransactionPnL" ADD COLUMN "feeAmountUsd" DECIMAL(28,8);
ALTER TABLE "TransactionPnL" ADD COLUMN "profitLossUsd" DECIMAL(28,8);

UPDATE "TransactionPnL"
SET
  "costPerTokenUsd" = "costPerToken",
  "feeAmountUsd" = "feeAmount",
  "profitLossUsd" = "profitLoss";

ALTER TABLE "TransactionPnL" ALTER COLUMN "costPerTokenUsd" SET NOT NULL;
ALTER TABLE "TransactionPnL" ALTER COLUMN "feeAmountUsd" SET NOT NULL;
ALTER TABLE "TransactionPnL" ALTER COLUMN "profitLossUsd" SET NOT NULL;

ALTER TABLE "TransactionPnL" DROP COLUMN "costPerToken";
ALTER TABLE "TransactionPnL" DROP COLUMN "providerPrice";
ALTER TABLE "TransactionPnL" DROP COLUMN "sellingPrice";
ALTER TABLE "TransactionPnL" DROP COLUMN "feeAmount";
ALTER TABLE "TransactionPnL" DROP COLUMN "profitLoss";

-- 5. InventoryLot index for status (FIFO open lots)
CREATE INDEX "InventoryLot_assetId_status_idx" ON "InventoryLot"("assetId", "status");
