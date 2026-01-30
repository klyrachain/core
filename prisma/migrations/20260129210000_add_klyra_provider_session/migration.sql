-- Add KLYRA to PaymentProvider enum (on-chain same-chain; we have balance and send to user)
ALTER TYPE "PaymentProvider" ADD VALUE 'KLYRA';

-- Link external provider session to transaction (e.g. PayStack session for session-based providers)
ALTER TABLE "Transaction" ADD COLUMN "providerSessionId" TEXT;
