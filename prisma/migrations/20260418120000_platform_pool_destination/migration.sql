-- CreateTable
CREATE TABLE "PlatformPoolDestination" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "networkKey" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "receiveAddress" TEXT,
    "infisicalSecretName" TEXT,
    "infisicalSecretPath" TEXT NOT NULL DEFAULT '/',
    "tokenContractAddress" TEXT,
    "stellarAssetCode" TEXT,
    "stellarAssetIssuer" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PlatformPoolDestination_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformPoolDestination_ecosystem_networkKey_tokenSymbol_enabled_idx" ON "PlatformPoolDestination"("ecosystem", "networkKey", "tokenSymbol", "enabled");
