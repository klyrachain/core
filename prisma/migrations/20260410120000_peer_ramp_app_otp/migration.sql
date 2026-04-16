-- Peer-ramp web app: OTP + stable user session id for order history
CREATE TABLE "PeerRampAppOtp" (
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeerRampAppOtp_pkey" PRIMARY KEY ("email")
);

CREATE TABLE "PeerRampAppUser" (
    "email" TEXT NOT NULL,
    "cliSessionId" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeerRampAppUser_pkey" PRIMARY KEY ("email")
);

CREATE INDEX "PeerRampAppUser_cliSessionId_idx" ON "PeerRampAppUser"("cliSessionId");
