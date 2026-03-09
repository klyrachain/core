-- AlterTable
ALTER TABLE "Chain" ADD COLUMN IF NOT EXISTS "rpcUrl" TEXT;

-- AlterTable
ALTER TABLE "SupportedToken" ADD COLUMN IF NOT EXISTS "displaySymbol" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportedToken_displaySymbol_idx" ON "SupportedToken"("displaySymbol");
