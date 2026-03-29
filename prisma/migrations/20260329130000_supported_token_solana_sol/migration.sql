-- Native SOL on Solana for Fonbnk (SOLANA_NATIVE) and checkout ONRAMP quotes.
INSERT INTO "SupportedToken" (
  "id",
  "chainId",
  "tokenAddress",
  "symbol",
  "decimals",
  "name",
  "logoUri",
  "fonbnkCode",
  "displaySymbol",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  101,
  'So11111111111111111111111111111111111111112',
  'SOL',
  9,
  'Solana',
  NULL,
  'SOLANA_NATIVE',
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT ("chainId", "tokenAddress") DO UPDATE SET
  "symbol" = EXCLUDED."symbol",
  "decimals" = EXCLUDED."decimals",
  "name" = EXCLUDED."name",
  "fonbnkCode" = EXCLUDED."fonbnkCode",
  "updatedAt" = NOW();
