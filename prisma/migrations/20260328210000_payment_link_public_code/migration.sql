-- Opaque public checkout code (URL path), separate from human slug.
ALTER TABLE "PaymentLink" ADD COLUMN IF NOT EXISTS "publicCode" TEXT;

UPDATE "PaymentLink"
SET "publicCode" = encode(gen_random_bytes(6), 'hex')
WHERE "publicCode" IS NULL;

DO $$
DECLARE
  r RECORD;
  newcode TEXT;
  tries INT;
BEGIN
  FOR r IN SELECT id, "publicCode" FROM "PaymentLink" LOOP
    IF EXISTS (
      SELECT 1 FROM "PaymentLink" p2
      WHERE p2."publicCode" = r."publicCode" AND p2.id <> r.id
    ) THEN
      tries := 0;
      LOOP
        newcode := encode(gen_random_bytes(6), 'hex');
        tries := tries + 1;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM "PaymentLink" WHERE "publicCode" = newcode);
        EXIT WHEN tries > 50;
      END LOOP;
      UPDATE "PaymentLink" SET "publicCode" = newcode WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentLink_publicCode_key" ON "PaymentLink"("publicCode");

ALTER TABLE "PaymentLink" ALTER COLUMN "publicCode" SET NOT NULL;
