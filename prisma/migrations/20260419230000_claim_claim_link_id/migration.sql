-- Claim public link id + optional claim-code verification timestamp
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "claimLinkId" TEXT;
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "claimCodeVerifiedAt" TIMESTAMP(3);

UPDATE "Claim"
SET "claimLinkId" = encode(gen_random_bytes(8), 'hex')
WHERE "claimLinkId" IS NULL;

ALTER TABLE "Claim" ALTER COLUMN "claimLinkId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Claim_claimLinkId_key" ON "Claim"("claimLinkId");
