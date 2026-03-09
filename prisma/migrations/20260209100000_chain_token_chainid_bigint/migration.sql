-- AlterTable: Chain.chainId and SupportedToken.chainId to bigint so we can store large chain IDs from upstream (e.g. 2716446429837000).
ALTER TABLE "Chain" ALTER COLUMN "chainId" TYPE BIGINT USING "chainId"::BIGINT;
ALTER TABLE "SupportedToken" ALTER COLUMN "chainId" TYPE BIGINT USING "chainId"::BIGINT;
