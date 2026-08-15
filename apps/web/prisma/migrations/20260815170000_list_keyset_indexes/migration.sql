-- The list view of every cursor-paginated module orders by
-- (updatedAt DESC, id DESC) within a tenant. None of the six models carried a
-- matching index, so the first page of each list — the most-hit query in the
-- product — was a per-tenant sequential scan plus a top-N sort, growing
-- linearly with tenant size. EXPLAIN before: Seq Scan + top-N heapsort; after:
-- Index Scan, LIMIT-bounded.
--
-- Deploy note: on a live table of hundreds of thousands of rows, plain
-- CREATE INDEX takes a write lock for the duration of the build. Prisma runs
-- migrations inside a transaction, which forbids CONCURRENTLY — so for a large
-- production dataset, build these out-of-band first
-- (CREATE INDEX CONCURRENTLY IF NOT EXISTS, same names); this migration's
-- IF NOT EXISTS then makes it a no-op ledger entry.

CREATE INDEX IF NOT EXISTS "Lead_tenantId_updatedAt_id_idx"        ON "Lead" ("tenantId", "updatedAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Contact_tenantId_updatedAt_id_idx"     ON "Contact" ("tenantId", "updatedAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Account_tenantId_updatedAt_id_idx"     ON "Account" ("tenantId", "updatedAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Opportunity_tenantId_updatedAt_id_idx" ON "Opportunity" ("tenantId", "updatedAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Listing_tenantId_updatedAt_id_idx"     ON "Listing" ("tenantId", "updatedAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Project_tenantId_updatedAt_id_idx"     ON "Project" ("tenantId", "updatedAt" DESC, "id" DESC);
