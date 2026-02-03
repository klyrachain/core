-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "isLiquidityPool" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Wallet" ADD COLUMN "collectFees" BOOLEAN NOT NULL DEFAULT false;
