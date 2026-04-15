-- Peer-ramp: counterparty USDC → escrow tx hash (admin / audit). User-facing delivery remains cryptoSendTxHash (escrow → user).
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "peerRampEscrowFundingTxHash" TEXT;
