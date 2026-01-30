-- AlterTable Transaction: add f_chain, t_chain for cross-chain (e.g. USDC on BASE → USDT on ETHEREUM)
ALTER TABLE "Transaction" ADD COLUMN "f_chain" TEXT NOT NULL DEFAULT 'ETHEREUM';
ALTER TABLE "Transaction" ADD COLUMN "t_chain" TEXT NOT NULL DEFAULT 'ETHEREUM';

-- AlterTable Wallet: add supportedChains (e.g. ["ETHEREUM", "BASE"])
ALTER TABLE "Wallet" ADD COLUMN "supportedChains" TEXT[] NOT NULL DEFAULT '{}';
