-- Peer-ramp KYC: Didit/Persona outcome on PeerRampAppUser + one session row per user per provider.
-- Previously only in schema / db push; this migration aligns migrate-deploy databases.

ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "kycStatus" TEXT;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "kycProvider" TEXT;
ALTER TABLE "PeerRampAppUser" ADD COLUMN IF NOT EXISTS "kycVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PeerRampKycSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawPayload" JSONB,

    CONSTRAINT "PeerRampKycSession_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PeerRampKycSession_email_fkey'
  ) THEN
    ALTER TABLE "PeerRampKycSession"
      ADD CONSTRAINT "PeerRampKycSession_email_fkey"
      FOREIGN KEY ("email") REFERENCES "PeerRampAppUser"("email")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PeerRampKycSession_email_provider_key"
  ON "PeerRampKycSession"("email", "provider");

CREATE INDEX IF NOT EXISTS "PeerRampKycSession_email_idx"
  ON "PeerRampKycSession"("email");

CREATE INDEX IF NOT EXISTS "PeerRampKycSession_externalId_idx"
  ON "PeerRampKycSession"("externalId");
