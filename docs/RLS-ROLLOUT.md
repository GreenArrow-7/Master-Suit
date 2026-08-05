# PostgreSQL RLS rollout

The role and policy templates live in `infrastructure/postgres`. They are not
automatically applied by the local launcher because the current Sales server
still has server-rendered and authentication bootstrap queries that do not all
run inside tenant-context transactions.

Required rollout sequence:

1. Refactor every HTTP request, page render and worker job to run inside one
   transaction with transaction-local `app.tenant_id`.
2. Implement narrowly scoped bootstrap functions for session, API-key and reset
   token lookup; never permit tenantless table scans.
3. Create migration and application roles with `roles.sql`; the application role
   must not own tables or possess `BYPASSRLS`.
4. Apply `rls.sql` in staging and run direct cross-tenant read/write/delete tests.
5. Verify connection-pool reuse cannot retain tenant context, then promote through
   a migration job with a tested backup and rollback plan.

Until this sequence passes, RLS remains a release blocker rather than a paper claim.
