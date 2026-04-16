-- AlterTable
ALTER TABLE "PeerRampOrder" ADD COLUMN "escrowTxHash" TEXT,
ADD COLUMN "escrowVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PeerRampFill" ADD COLUMN "onrampAcceptedAt" TIMESTAMP(3),
ADD COLUMN "offrampAcceptedAt" TIMESTAMP(3);
