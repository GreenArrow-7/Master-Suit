-- A phone's sign-in (M20-10, 19 Oct): a bearer device session in the same
-- PlatformSession table, so every existing revocation ends it too. Additive:
-- every existing row is a browser session. PlatformSession stays outside
-- row-level security, as before (it is how a tenant is resolved).

ALTER TABLE "PlatformSession" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'WEB';
ALTER TABLE "PlatformSession" ADD COLUMN "platform" TEXT;
