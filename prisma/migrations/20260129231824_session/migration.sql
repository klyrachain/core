-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "f_chain" DROP DEFAULT,
ALTER COLUMN "t_chain" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Wallet" ALTER COLUMN "supportedChains" DROP DEFAULT;
