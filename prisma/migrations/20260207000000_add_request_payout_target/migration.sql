-- Add payoutTarget to Request for auto-settle (crypto address or fiat phone/bank). When set, requester does not claim.
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "payoutTarget" TEXT;
