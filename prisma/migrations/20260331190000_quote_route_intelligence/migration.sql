-- CreateEnum
CREATE TYPE "QuoteRouteStrategy" AS ENUM (
  'DIRECT',
  'SAME_CHAIN_USDC',
  'SAME_CHAIN_NATIVE',
  'BASE_CROSS_CHAIN'
);

-- CreateTable
CREATE TABLE "FonbnkSupportedAsset" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "network" TEXT,
    "asset" TEXT,
    "chainId" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "metadata" JSONB,

    CONSTRAINT "FonbnkSupportedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRouteAttempt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "countryCode" TEXT,
    "tokenKey" TEXT NOT NULL,
    "strategy" "QuoteRouteStrategy" NOT NULL,
    "provider" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorReason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "QuoteRouteAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FonbnkSupportedAsset_code_key" ON "FonbnkSupportedAsset"("code");

-- CreateIndex
CREATE INDEX "FonbnkSupportedAsset_network_asset_idx" ON "FonbnkSupportedAsset"("network", "asset");

-- CreateIndex
CREATE INDEX "FonbnkSupportedAsset_chainId_idx" ON "FonbnkSupportedAsset"("chainId");

-- CreateIndex
CREATE INDEX "FonbnkSupportedAsset_isActive_idx" ON "FonbnkSupportedAsset"("isActive");

-- CreateIndex
CREATE INDEX "QuoteRouteAttempt_chainId_tokenKey_strategy_success_createdAt_idx" ON "QuoteRouteAttempt"("chainId", "tokenKey", "strategy", "success", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "QuoteRouteAttempt_action_createdAt_idx" ON "QuoteRouteAttempt"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "QuoteRouteAttempt_countryCode_createdAt_idx" ON "QuoteRouteAttempt"("countryCode", "createdAt" DESC);

