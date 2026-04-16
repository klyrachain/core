-- Align Ethereum WXRP with current Wrapped XRP contract used by Squid checkout.
UPDATE "SupportedToken"
SET
  "tokenAddress" = '0x39fBBABf11738317a448031930706cd3e612e1B9',
  "updatedAt" = NOW()
WHERE
  "chainId" = 1
  AND LOWER("tokenAddress") = LOWER('0xccdF8c00c05e978Ec096f3Fe06dcbb19fC3b77Ea');
