-- CreateTable
CREATE TABLE "PaymentLinkDispatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "amount" TEXT,
    "tokenSymbol" TEXT,
    "chainId" TEXT,
    "receiveMode" TEXT NOT NULL DEFAULT 'CRYPTO',

    CONSTRAINT "PaymentLinkDispatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentLinkDispatch_createdAt_idx" ON "PaymentLinkDispatch"("createdAt");
