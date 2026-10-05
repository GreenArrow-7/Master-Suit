# PostgreSQL row-level security

RLS is on. The migrations create the application role `master_saas_app`
(`NOBYPASSRLS`, owning no tables; first in `20260803200000`),
`20260803230000_rls_full_coverage` puts a policy on every tenant-owned table, and
`20260806000000` adds `FORCE ROW LEVEL SECURITY`, so the owning role is held to
the policies too. The application connects as that role, and every
query carries a transaction-local `app.tenant_id` (`src/lib/db.ts`).

Two checks keep it that way:

- `node scripts/check-rls.mjs` reads the live catalog and fails if any tenant
  table lacks RLS or FORCE. CI runs it as the "Tenant isolation" gate.
- `tests/tenant/` holds the cross-tenant read, write and delete tests, run as
  the application role.

This file used to hold the rollout plan written before any of that existed,
with the role and policy SQL templates under `infrastructure/postgres/`. Both
are in git history; the migrations are what is applied.
