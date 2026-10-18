-- Outlook / Microsoft 365 calendar sync (Lead Eagle audit row M8-09, 18 Oct).
-- Microsoft Graph chooses event ids, so the event a follow-up, task or site
-- visit is on is kept here (Google's id is derived from the record and needs no
-- row). Additive: one new table; nothing existing changes shape and no row is
-- written.

CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "recordKind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarEventLink_tenantId_provider_recordKind_recordId_key" ON "CalendarEventLink"("tenantId", "provider", "recordKind", "recordId");

ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "CalendarEventLink" TO master_saas_app;
ALTER TABLE "CalendarEventLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEventLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CalendarEventLink";
CREATE POLICY tenant_isolation ON "CalendarEventLink" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
