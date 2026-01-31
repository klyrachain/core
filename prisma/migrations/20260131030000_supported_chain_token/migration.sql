-- CreateTable
CREATE TABLE "SupportedChain" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "iconUri" TEXT,

    CONSTRAINT "SupportedChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportedToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "name" TEXT,
    "logoUri" TEXT,
    "fonbnkCode" TEXT,

    CONSTRAINT "SupportedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportedChain_chainId_key" ON "SupportedChain"("chainId");

-- CreateIndex
CREATE INDEX "SupportedChain_chainId_idx" ON "SupportedChain"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportedToken_chainId_tokenAddress_key" ON "SupportedToken"("chainId", "tokenAddress");

-- CreateIndex
CREATE INDEX "SupportedToken_chainId_idx" ON "SupportedToken"("chainId");

-- CreateIndex
CREATE INDEX "SupportedToken_symbol_idx" ON "SupportedToken"("symbol");
