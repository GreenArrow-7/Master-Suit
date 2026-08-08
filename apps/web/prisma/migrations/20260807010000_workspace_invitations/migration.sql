-- Invitations: the only way to create a login.
--
-- `UserStatus.INVITED` existed and was counted against seat limits, but nothing
-- ever created one. The actual mechanism was an administrator typing a plaintext
-- password into a form and communicating it out of band — so every account began
-- life with a credential someone else knew, and there was no expiry, no audit of
-- who was invited when, and no way to withdraw an offer that had not been taken up.
CREATE TABLE "WorkspaceInvitation" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "fullName"       TEXT NOT NULL,
  "roleId"         TEXT NOT NULL,
  "employeeNumber" TEXT,
  "jobTitle"       TEXT,
  "departmentId"   TEXT,
  -- Hashed, never stored in the clear: a leaked backup must not be redeemable.
  "tokenHash"      TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "acceptedAt"     TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "revokedReason"  TEXT,
  "sendCount"      INTEGER NOT NULL DEFAULT 1,
  "lastSentAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invitedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  -- Holds the lower-cased email while the invitation is live, and NULL once it
  -- is accepted or revoked. Postgres does not compare NULLs in a unique index,
  -- so this permits any number of historical rows per address while allowing
  -- exactly one open invitation — which is what stops two administrators
  -- inviting the same person into two memberships.
  "pendingKey"     TEXT,
  CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE UNIQUE INDEX "WorkspaceInvitation_tenantId_pendingKey_key" ON "WorkspaceInvitation"("tenantId", "pendingKey");
CREATE INDEX "WorkspaceInvitation_tenantId_expiresAt_idx" ON "WorkspaceInvitation"("tenantId", "expiresAt");
CREATE INDEX "WorkspaceInvitation_email_idx" ON "WorkspaceInvitation"("email");

ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-owned, so it joins the row-level-security regime like every other
-- tenant table. Redeeming a token is a bootstrap read (the tenant is unknown
-- until the token resolves), which is why acceptance goes through the platform
-- context rather than a tenant one.
ALTER TABLE "WorkspaceInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceInvitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkspaceInvitation" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
