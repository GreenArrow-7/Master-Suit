# Data migration plan

1. Back up and checksum the original Sales PostgreSQL database, HRMS SQLite file
   and document/face stores. Never run migration against the only copy.
2. Create canonical platform users and tenants. Match users by normalized verified
   work email; send ambiguous or duplicate matches to a review queue.
3. Create memberships and map Sales roles and HRMS employees to the shared user ID.
4. Import HRMS reference data, then employees, lifecycle, leave and attendance.
5. Import Sales records using the canonical tenant and user mappings.
6. Copy files to tenant-prefixed object-storage keys and validate hashes.
7. Reconcile row counts, ownership, orphan counts and cross-tenant probes.
8. Invalidate all legacy sessions. Preserve password hashes only when the shared
   verifier supports their algorithm; otherwise require reset.
9. Run a rehearsal, measure downtime, then perform a staged cutover with a defined
   rollback point before any source system becomes writable again.

The first additive identity backfill is
`apps/web/prisma/migrations/20260803120000_unified_platform_foundation`. It creates
one platform user per normalized Sales email, links every surviving Sales user to
a workspace membership and creates an employee profile. The exact pre-change
schema is retained as `apps/web/prisma/schema.pre-unified.prisma` for review.

Before applying it to customer data, run these read-only gates and resolve every
returned row:

```sql
SELECT lower(trim("email")) AS email, count(*), count(DISTINCT "passwordHash")
FROM "User" WHERE "deletedAt" IS NULL
GROUP BY 1 HAVING count(DISTINCT "passwordHash") > 1;

SELECT "tenantId", "employeeCode", count(*)
FROM "User" WHERE "deletedAt" IS NULL AND "employeeCode" IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;
```

After migration, compare active source users to memberships and ensure no orphan
links exist. Roll back before enabling new logins by dropping only the five new
tables/enums and added Tenant columns; after new PlatformSession rows are issued,
rollback requires a maintenance window and session invalidation.
