-- Interactive sign-in for the AI_SERVICE identity.
--
-- ── What this replaces ──────────────────────────────────────────────────────
--
-- `resolvePlatformCtx` refused any session belonging to an AI_SERVICE identity
-- outright. That was the right default while the identity had no password at
-- all, and it is not being removed — it is being narrowed to "refuse any session
-- that did not come through the dedicated path", enforced by the new
-- PlatformSession.purpose value below.
--
-- ── username ────────────────────────────────────────────────────────────────
--
-- Nullable and unique. Postgres permits many NULLs in a unique index, so every
-- human platform account leaves it unset and keeps signing in with its email.
-- The service identity gets one because its `email` is an internal name that is
-- never delivered to — a poor thing to type into a form and a worse thing to
-- rotate.
--
-- No value is seeded here, and none is seeded anywhere else. A username in a
-- migration is a published credential half, and a password in one is a
-- published credential. Both are set by scripts/platform-service-identity.mjs,
-- which generates the password and prints it once.
--
-- ── serviceScopes / serviceTenantAllowlist ──────────────────────────────────
--
-- What an *interactive* session may read, kept off PlatformServiceCredential on
-- purpose: a browser session holds no machine credential, and having it borrow
-- one would couple the two paths together, so revoking the machine token would
-- silently revoke the login too. They default to empty, meaning an identity
-- provisioned before anybody decided what it may see can read nothing.

ALTER TABLE "PlatformUser" ADD COLUMN "username" TEXT;
ALTER TABLE "PlatformUser" ADD COLUMN "serviceScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PlatformUser" ADD COLUMN "serviceTenantAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "PlatformUser_username_key" ON "PlatformUser"("username");
