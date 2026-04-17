-- Person KYC fields on User (business portal / invited members), distinct from PeerRampAppUser.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "portalKycStatus" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "portalKycProvider" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "portalKycVerifiedAt" TIMESTAMP(3);
