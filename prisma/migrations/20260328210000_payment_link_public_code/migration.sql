-- Opaque public checkout code (URL path), separate from human slug.
-- Uses md5/random only (no gen_random_bytes — that requires pgcrypto, which Prisma's
-- shadow DB and some hosts do not enable).
ALTER TABLE "PaymentLink" ADD COLUMN IF NOT EXISTS "publicCode" TEXT;

UPDATE "PaymentLink"
SET "publicCode" = substring(md5(random()::text || clock_timestamp()::text || id::text) from 1 for 12)
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
        newcode := substring(
          md5(random()::text || clock_timestamp()::text || r.id::text || tries::text)
          from 1 for 12
        );
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
