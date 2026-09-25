-- Portal syndication: the feed a portal fetches, and why a listing is not in it.
--
-- Hand-written rather than generated. `migrate diff` against this database also
-- emits DROP TABLE "PlatformCoverageGrant" and drops two PlatformAccessGrant
-- columns, because two applied migrations are absent from the repository — so
-- the generated script would have taken live platform-monitoring data with it.
-- Only the statements for this change are below.

CREATE TYPE "PortalKey" AS ENUM ('PROPERTY_FINDER', 'BAYUT', 'DUBIZZLE', 'WEBSITE');

-- Trakheesi, or the equivalent advertising permit. Per listing, unlike the
-- project's RERA number: the portals check for this one.
ALTER TABLE "Listing" ADD COLUMN "permitNumber" TEXT,
                      ADD COLUMN "permitExpiry" TIMESTAMP(3);

CREATE TABLE "PortalFeed" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "portal" "PortalKey" NOT NULL,
    "feedKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastBuiltAt" TIMESTAMP(3),
    "lastItemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortalFeed_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingPublication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "portal" "PortalKey" NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingPublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalFeed_feedKey_key" ON "PortalFeed"("feedKey");
CREATE UNIQUE INDEX "PortalFeed_tenantId_portal_key" ON "PortalFeed"("tenantId", "portal");
CREATE INDEX "ListingPublication_tenantId_portal_isPublished_idx" ON "ListingPublication"("tenantId", "portal", "isPublished");
CREATE UNIQUE INDEX "ListingPublication_tenantId_listingId_portal_key" ON "ListingPublication"("tenantId", "listingId", "portal");

ALTER TABLE "PortalFeed" ADD CONSTRAINT "PortalFeed_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A feed key short enough to guess exposes every listing the brokerage holds,
-- with the owner's asking price attached.
ALTER TABLE "PortalFeed"
  ADD CONSTRAINT "PortalFeed_key_is_long_enough" CHECK (length("feedKey") >= 24);

-- Published means published. A row claiming to be live with no date is a
-- listing nobody can prove was ever advertised, which is the question a
-- landlord asks when the mandate ends.
ALTER TABLE "ListingPublication"
  ADD CONSTRAINT "ListingPublication_published_has_a_date"
  CHECK ("isPublished" = false OR ("isPublished" = true AND "publishedAt" IS NOT NULL));

-- Tenant isolation, same policy as every tenant-scoped table.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['PortalFeed', 'ListingPublication'];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ') '
      'WITH CHECK ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ')',
      target
    );
  END LOOP;
END $$;
