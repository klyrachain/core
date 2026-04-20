-- Optional 1:1 between PaymentLink and Invoice (checkout for invoice payment).
ALTER TABLE "PaymentLink" ADD COLUMN "invoiceId" TEXT;

CREATE UNIQUE INDEX "PaymentLink_invoiceId_key" ON "PaymentLink"("invoiceId");

ALTER TABLE "PaymentLink"
ADD CONSTRAINT "PaymentLink_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
