-- Row Level Security for Supabase-hosted Postgres.
--
-- Core connects via Prisma using the database owner / superuser (or any role with BYPASSRLS).
-- Those roles bypass RLS unless FORCE ROW LEVEL SECURITY is set (we do not use FORCE here).
--
-- Supabase PostgREST uses roles `anon` and `authenticated` by default; explicit deny policies
-- prevent accidental data exposure if the Data API is enabled. `service_role` continues to
-- bypass RLS per Supabase behavior.
--
-- Apply with: pnpm db:migrate:deploy (from core/) against the target DATABASE_URL.

DO $$
DECLARE
  r RECORD;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_authenticated;

  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('_prisma_migrations')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tbl);

    IF has_anon THEN
      EXECUTE format('DROP POLICY IF EXISTS "klyra_block_anon" ON public.%I;', r.tbl);
      EXECUTE format(
        'CREATE POLICY "klyra_block_anon" ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false);',
        r.tbl
      );
    END IF;

    IF has_authenticated THEN
      EXECUTE format('DROP POLICY IF EXISTS "klyra_block_authenticated" ON public.%I;', r.tbl);
      EXECUTE format(
        'CREATE POLICY "klyra_block_authenticated" ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false);',
        r.tbl
      );
    END IF;
  END LOOP;
END $$;
