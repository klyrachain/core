-- Create the platform receiving wallet for offramp (BASE + BASE SEPOLIA) and make it the liquidity pool.
-- Run with: psql $DATABASE_URL -f scripts/sql/create-platform-receiving-wallet.sql

-- 1. Stop using the placeholder as liquidity pool
UPDATE "Wallet"
SET "isLiquidityPool" = false
WHERE "address" = '0xEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1';

-- 2. Create the platform receiving wallet (if it doesn't exist)
INSERT INTO "Wallet" (
  "id",
  "createdAt",
  "updatedAt",
  "address",
  "encryptedKey",
  "supportedChains",
  "supportedTokens",
  "isLiquidityPool",
  "collectFees"
)
VALUES (
  gen_random_uuid(),
  NOW(),
  NOW(),
  '0x9f08eFb0767Bf180B8b8094FaaEF9DAB5a0755e1',
  'placeholder-receive-only-no-private-key',
  ARRAY['BASE', 'BASE SEPOLIA'],
  ARRAY['USDC', 'ETH'],
  true,
  false
)
ON CONFLICT ("address") DO UPDATE SET
  "isLiquidityPool" = true,
  "supportedChains" = ARRAY['BASE', 'BASE SEPOLIA'],
  "supportedTokens" = ARRAY['USDC', 'ETH'],
  "updatedAt" = NOW();
