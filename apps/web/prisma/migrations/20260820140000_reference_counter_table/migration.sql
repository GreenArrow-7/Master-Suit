-- Replace the per-tenant reference sequences with one counter table, then take
-- away the schema-level CREATE privilege they needed.
--
-- ── What was here ───────────────────────────────────────────────────────────
--
-- services/shared/reference.ts allocated LD-000142 and its nine siblings from a
-- Postgres sequence *per tenant per object type*, created lazily on first use:
--
--   CREATE SEQUENCE "ref_lead_cmt1h6guw0000b47d5oshrg8b"
--
-- Ten object types. At ten thousand tenants that is up to a hundred thousand
-- relations in pg_class — a file each on disk, a slower pg_dump and autovacuum
-- pass for every one, and a catalog that every planner lookup reads past.
--
-- It also required `GRANT CREATE ON SCHEMA public` on the runtime role, which is
-- a large privilege to hold permanently for one feature: a role that can CREATE
-- in a schema can also shadow a table name, and nothing else in this application
-- issues DDL at runtime (this is the only $executeRawUnsafe in src/ that does).
--
-- ── And a live concurrency fault ────────────────────────────────────────────
--
-- The lazy creation was check-then-create across two statements. Two concurrent
-- first-creates for the same tenant both saw the sequence absent, both issued
-- CREATE SEQUENCE, and the loser failed the whole transaction with
-- "relation already exists". Rare — it is one instant per tenant per object
-- type, at onboarding — but exactly the moment a new customer is watching.
--
-- ── What replaces it ────────────────────────────────────────────────────────
--
-- One row per (tenant, object type) holding the last number issued, allocated
-- with a single statement:
--
--   UPDATE "TenantReferenceCounter" SET counter = counter + 1 ... RETURNING counter
--
-- Atomic, row-locked, no catalog growth, no DDL. The trade is real and worth
-- stating: concurrent creates of the same object type within one tenant now
-- serialise on that row until the transaction commits, where distinct sequence
-- values did not. A sequence hands out numbers outside transaction control,
-- which is why it never blocks — and also why a rolled-back create burns one.
-- The row lock is held for the remainder of a single create transaction, which
-- is one INSERT and its audit row; a tenant would need sustained concurrent
-- creates of one type for it to be measurable, and catalog bloat at ten thousand
-- tenants is not conditional.

CREATE TABLE "TenantReferenceCounter" (
    "tenantId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantReferenceCounter_pkey" PRIMARY KEY ("tenantId","objectType")
);

ALTER TABLE "TenantReferenceCounter" ADD CONSTRAINT "TenantReferenceCounter_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill from the sequences, then drop them ─────────────────────────────
--
-- Seeded from each sequence's own last_value rather than from MAX(reference) in
-- the data. The two differ, and the difference is the property this feature
-- promises: a number is burned when a create rolls back, and burned again when
-- a record is deleted, so a reference is never reissued. MAX(reference) would
-- rewind to the highest *surviving* row and hand out a number a deleted record
-- already carried — which is exactly what a customer's paper trail must not do.
--
-- `is_called` distinguishes a sequence that has issued last_value from one
-- freshly created that will issue it next.
--
-- Tenant ids are cuid — lowercase alphanumeric — so the name that
-- reference.ts built by stripping non-alphanumerics is the id unchanged, and
-- reverses cleanly. The EXISTS guard drops sequences belonging to tenants that
-- have since been deleted rather than failing the migration on the foreign key.
DO $$
DECLARE
  seq        record;
  last_val   bigint;
  was_called boolean;
BEGIN
  FOR seq IN
    SELECT c.relname AS name,
           upper(split_part(c.relname, '_', 2))          AS object_type,
           substring(c.relname from '^ref_[a-z]+_(.*)$') AS tenant_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relname ~ '^ref_[a-z]+_.+$'
  LOOP
    EXECUTE format('SELECT last_value, is_called FROM %I', seq.name) INTO last_val, was_called;

    INSERT INTO "TenantReferenceCounter" ("tenantId", "objectType", "counter", "updatedAt")
    SELECT seq.tenant_id,
           seq.object_type,
           GREATEST(CASE WHEN was_called THEN last_val ELSE last_val - 1 END, 0)::int,
           now()
     WHERE EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = seq.tenant_id)
    ON CONFLICT ("tenantId", "objectType") DO NOTHING;

    EXECUTE format('DROP SEQUENCE %I', seq.name);
  END LOOP;
END $$;

-- ── Row-level security ──────────────────────────────────────────────────────
--
-- Same shape as every other tenant-owned table, and it matters more here than
-- it looks: allocation is raw SQL, which the Prisma tenant guard in lib/db.ts
-- does not see. RLS is the only layer standing between a mistake in this query
-- and one tenant's counter being advanced by another's create — the same gap
-- that made the retention sweep silently read nothing before it was fixed.
ALTER TABLE "TenantReferenceCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantReferenceCounter" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "TenantReferenceCounter" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantReferenceCounter" TO master_saas_app;

-- ── The privilege that is no longer needed ──────────────────────────────────
--
-- 20260806000000 granted this so reference.ts could CREATE SEQUENCE at runtime.
-- Nothing else in the application issues DDL, so with the sequences gone the
-- runtime role has no reason to be able to create objects in the schema it
-- serves from. Revoked from PUBLIC as well: Postgres 15 dropped that default,
-- but a database initialised on 14 or restored from one still carries it.
REVOKE CREATE ON SCHEMA public FROM master_saas_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
