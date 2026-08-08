-- Invitations join the documented bootstrap set.
--
-- 20260807010000 put WorkspaceInvitation under row-level security along with
-- every other tenant-owned table. That is wrong for this one, for the same
-- reason PasswordResetToken and Session are already excluded: the row is looked
-- up *before* any tenant is known, by someone who is not signed in, using a
-- 256-bit token they hold. The token IS the authorisation, and the tenant is
-- derived from the row it resolves to — so a policy keyed on `app.tenant_id`
-- can only ever refuse the one legitimate read.
--
-- What protects the table instead:
--   * the token is stored as a SHA-256 hash, so a leaked row is not redeemable;
--   * every administrative read goes through the tenant-scoped API, where the
--     Prisma guard still requires an explicit tenantId;
--   * acceptance writes inside withTx(tenantId), which is RLS-enforced.
--
-- Mirrors the `bootstrap` array in 20260803230000 and GLOBAL_UNIQUE_FIELDS in
-- src/lib/db.ts. Keep the three in step.
DROP POLICY IF EXISTS tenant_isolation ON "WorkspaceInvitation";
ALTER TABLE "WorkspaceInvitation" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceInvitation" DISABLE ROW LEVEL SECURITY;
