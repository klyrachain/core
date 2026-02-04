-- Replace relative f_price/t_price with absolute USD price fields and exchange rate.
-- exchangeRate = t_amount / f_amount; f_tokenPriceUsd/t_tokenPriceUsd = USD per 1 unit; feeInUsd = fee value in USD at completion.

ALTER TABLE "Transaction" ADD COLUMN "exchangeRate" DECIMAL(18,8);
ALTER TABLE "Transaction" ADD COLUMN "f_tokenPriceUsd" DECIMAL(18,8);
ALTER TABLE "Transaction" ADD COLUMN "t_tokenPriceUsd" DECIMAL(18,8);
ALTER TABLE "Transaction" ADD COLUMN "feeInUsd" DECIMAL(18,8);

ALTER TABLE "Transaction" DROP COLUMN "f_price";
ALTER TABLE "Transaction" DROP COLUMN "t_price";
