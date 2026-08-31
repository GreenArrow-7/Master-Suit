-- Device push registrations.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- None, and none is possible: this table carries no `tenantId`, so the
-- catalog-driven sweep in 20260803230000_rls_full_coverage does not select it
-- and there is nothing for a policy to compare against.
--
-- That is the design, not an exemption taken to save work. The token is minted
-- by the handset and is the same string for whoever signs in on it next. A
-- tenant-scoped row would let one phone accumulate a row per workspace, and the
-- person holding it would get the previous occupant's notification titles on the
-- lock screen — while row-level security hid the older row from the sign-in that
-- would have replaced it. `token` is UNIQUE across the whole table instead, so a
-- sign-in moves ownership of the device rather than adding a second claim on it.
--
-- Reads are pinned by `userId`, which is a tenant-scoped User; the tenant guard
-- exemption that allows that is argued in src/lib/db.ts.

CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- The constraint the whole design rests on: one row per physical device.
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
-- "Which devices does this person carry" — the only question the sender asks.
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- Cascade: deleting the account takes its devices with it. There is no soft
-- delete here on purpose — a revoked account must stop ringing immediately.
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "DeviceToken" TO master_saas_app;
