-- Add chainId, address, walletId to InventoryAsset; one-to-many Wallet -> InventoryAsset.
-- Uniqueness: (chainId, tokenAddress, address) so tokens from all chains on all accounts can be stored.

-- Add new columns (nullable first for backfill)
ALTER TABLE "InventoryAsset" ADD COLUMN "chainId" INTEGER;
ALTER TABLE "InventoryAsset" ADD COLUMN "address" TEXT;
ALTER TABLE "InventoryAsset" ADD COLUMN "walletId" TEXT;

-- Backfill: chainId from chain (ETHEREUM=1, BASE=8453)
UPDATE "InventoryAsset" SET "chainId" = CASE WHEN "chain" = 'BASE' THEN 8453 ELSE 1 END;
UPDATE "InventoryAsset" SET "address" = 'default' WHERE "address" IS NULL;

-- Set NOT NULL
ALTER TABLE "InventoryAsset" ALTER COLUMN "chainId" SET NOT NULL;
ALTER TABLE "InventoryAsset" ALTER COLUMN "address" SET NOT NULL;

-- Drop old unique constraint
DROP INDEX IF EXISTS "InventoryAsset_chain_tokenAddress_key";

-- Add FK for walletId
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New unique: one row per (chainId, tokenAddress, address)
CREATE UNIQUE INDEX "InventoryAsset_chainId_tokenAddress_address_key" ON "InventoryAsset"("chainId", "tokenAddress", "address");

-- Indexes for filtering by address and walletId
CREATE INDEX "InventoryAsset_address_idx" ON "InventoryAsset"("address");
CREATE INDEX "InventoryAsset_walletId_idx" ON "InventoryAsset"("walletId");
