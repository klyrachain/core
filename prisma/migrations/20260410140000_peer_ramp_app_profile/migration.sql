-- Peer-ramp app user: payout profile for offramp settlement
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "paystackCountrySlug" TEXT;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "payoutMethod" TEXT;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "payoutDetails" JSONB;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "profileCompletedAt" TIMESTAMP(3);
