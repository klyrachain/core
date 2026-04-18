-- CreateEnum
CREATE TYPE "ClearingLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ClearingLedgerReason" AS ENUM ('SETTLEMENT_IN', 'PAYOUT_OUT', 'GAS_TOPUP_TRANSFER', 'ADJUSTMENT', 'OPENING_BALANCE');

-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN "metadata" JSONB;

-- CreateTable
CREATE TABLE "BusinessClearingAccount" (
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "balanceUsd" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "BusinessClearingAccount_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "ClearingLedgerEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT NOT NULL,
    "direction" "ClearingLedgerDirection" NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "reason" "ClearingLedgerReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "ClearingLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClearingLedgerEntry_idempotencyKey_key" ON "ClearingLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ClearingLedgerEntry_businessId_createdAt_idx" ON "ClearingLedgerEntry"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessClearingAccount" ADD CONSTRAINT "BusinessClearingAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingLedgerEntry" ADD CONSTRAINT "ClearingLedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one clearing row per business at 0
INSERT INTO "BusinessClearingAccount" ("businessId", "createdAt", "updatedAt", "balanceUsd")
SELECT "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0 FROM "Business"
ON CONFLICT ("businessId") DO NOTHING;

-- Opening balance from historical completed commerce Paystack BUY (payment link, USD fiat leg) minus platform fee
INSERT INTO "ClearingLedgerEntry" ("id", "createdAt", "businessId", "direction", "amountUsd", "reason", "idempotencyKey", "metadata")
SELECT
  gen_random_uuid()::text,
  CURRENT_TIMESTAMP,
  t."businessId",
  'CREDIT'::"ClearingLedgerDirection",
  GREATEST(
    0,
    (t."f_amount"::numeric - COALESCE(t."platformFee"::numeric, 0))
  )::decimal(18,2),
  'OPENING_BALANCE'::"ClearingLedgerReason",
  'opening-clearing:' || t."id",
  jsonb_build_object('sourceTransactionId', t."id")
FROM "Transaction" t
WHERE t."businessId" IS NOT NULL
  AND t."paymentLinkId" IS NOT NULL
  AND t."status" = 'COMPLETED'
  AND t."type" = 'BUY'
  AND UPPER(COALESCE(t."f_token", '')) = 'USD'
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Subtract PAID payouts in USD (approximate: same currency only)
INSERT INTO "ClearingLedgerEntry" ("id", "createdAt", "businessId", "direction", "amountUsd", "reason", "idempotencyKey", "metadata")
SELECT
  gen_random_uuid()::text,
  CURRENT_TIMESTAMP,
  p."businessId",
  'DEBIT'::"ClearingLedgerDirection",
  (p."amount" + p."fee")::decimal(18,2),
  'PAYOUT_OUT'::"ClearingLedgerReason",
  'opening-payout:' || p."id",
  jsonb_build_object('payoutId', p."id")
FROM "Payout" p
WHERE p."status" = 'PAID'
  AND UPPER(p."currency") = 'USD'
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Recompute balance from ledger (credits - debits)
UPDATE "BusinessClearingAccount" bca
SET
  "balanceUsd" = COALESCE(agg.net, 0),
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT
    "businessId",
    SUM(
      CASE WHEN "direction" = 'CREDIT' THEN "amountUsd"::numeric
           ELSE -"amountUsd"::numeric END
    ) AS net
  FROM "ClearingLedgerEntry"
  GROUP BY "businessId"
) agg
WHERE bca."businessId" = agg."businessId";
