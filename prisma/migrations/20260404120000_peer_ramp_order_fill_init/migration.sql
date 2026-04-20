-- Base peer-ramp tables. Later migrations only ALTER these; shadow DB replay needs explicit CREATE.
DO $$
BEGIN
  CREATE TYPE "PeerRampOrderSide" AS ENUM ('ONRAMP', 'OFFRAMP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PeerRampOrderStatus" AS ENUM (
    'OPEN',
    'PARTIALLY_FILLED',
    'AWAITING_SETTLEMENT',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PeerRampOrder" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "side" "PeerRampOrderSide" NOT NULL,
  "chainId" INTEGER NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL,
  "cryptoAmountTotal" DECIMAL(28, 8) NOT NULL,
  "cryptoAmountRemaining" DECIMAL(28, 8) NOT NULL,
  "status" "PeerRampOrderStatus" NOT NULL DEFAULT 'OPEN',
  "quoteSnapshot" JSONB,
  "settlementCurrency" TEXT,
  "payerEmail" TEXT,
  "recipientAddress" TEXT,
  "payoutHint" JSONB,
  "cliSessionId" TEXT,
  "linkedTransactionId" TEXT,

  CONSTRAINT "PeerRampOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PeerRampFill" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "onrampOrderId" TEXT NOT NULL,
  "offrampOrderId" TEXT NOT NULL,
  "cryptoAmount" DECIMAL(28, 8) NOT NULL,

  CONSTRAINT "PeerRampFill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PeerRampOrder_linkedTransactionId_key" ON "PeerRampOrder"("linkedTransactionId");

CREATE INDEX IF NOT EXISTS "PeerRampOrder_chainId_tokenAddress_side_status_idx" ON "PeerRampOrder"("chainId", "tokenAddress", "side", "status");

CREATE INDEX IF NOT EXISTS "PeerRampOrder_cliSessionId_idx" ON "PeerRampOrder"("cliSessionId");

CREATE INDEX IF NOT EXISTS "PeerRampOrder_status_idx" ON "PeerRampOrder"("status");

CREATE INDEX IF NOT EXISTS "PeerRampFill_onrampOrderId_idx" ON "PeerRampFill"("onrampOrderId");

CREATE INDEX IF NOT EXISTS "PeerRampFill_offrampOrderId_idx" ON "PeerRampFill"("offrampOrderId");

-- FK only when Transaction exists (normal migrate replay). Partial restores may omit core tables.
DO $$
BEGIN
  IF to_regclass('public."Transaction"') IS NOT NULL THEN
    BEGIN
      ALTER TABLE "PeerRampOrder"
        ADD CONSTRAINT "PeerRampOrder_linkedTransactionId_fkey"
        FOREIGN KEY ("linkedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE "PeerRampFill"
    ADD CONSTRAINT "PeerRampFill_onrampOrderId_fkey"
    FOREIGN KEY ("onrampOrderId") REFERENCES "PeerRampOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PeerRampFill"
    ADD CONSTRAINT "PeerRampFill_offrampOrderId_fkey"
    FOREIGN KEY ("offrampOrderId") REFERENCES "PeerRampOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
