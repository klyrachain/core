-- Add rpcUrls (JSONB array) for multiple RPCs per chain (from chain list + tokens, deduped).
ALTER TABLE "Chain" ADD COLUMN IF NOT EXISTS "rpcUrls" JSONB;
