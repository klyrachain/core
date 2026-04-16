-- Peer ramp: persist last escrow verification snapshot (audit / debugging)

ALTER TABLE "PeerRampOrder" ADD COLUMN "escrowVerifyLastAttempt" JSONB;
