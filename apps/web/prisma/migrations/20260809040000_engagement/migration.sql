-- M11 — Engagement, the last module.
--
-- Less new machinery than any module before it. RSVP to an offsite already
-- works: EventInvitee carries a userId, so an event can invite staff and they
-- answer through the same signed link a client does. Contest standings are the
-- ranking M10 already computes. What is new is somewhere to post, a contest
-- whose result is frozen when it closes, and nominations with one vote each.
--
-- The constraints below are the part a datamodel cannot say: that hiding a post
-- records who and why, that a contest cannot end before it starts, that a
-- frozen standing has a rank, and that nobody votes for themselves.

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('UPDATE', 'ANNOUNCEMENT', 'CELEBRATION', 'QUESTION');

-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('LIKE', 'CELEBRATE', 'SUPPORT', 'INSIGHTFUL');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NominationStatus" AS ENUM ('OPEN', 'WITHDRAWN', 'WON');

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "PostKind" NOT NULL DEFAULT 'UPDATE',
    "body" TEXT NOT NULL,
    "videoKey" TEXT,
    "videoUrl" TEXT,
    "posterKey" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostReaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL DEFAULT 'LIKE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT,
    "prize" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestStanding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestStanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nomination" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nomineeId" TEXT NOT NULL,
    "nominatedById" TEXT NOT NULL,
    "reason" TEXT,
    "status" "NominationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Nomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NominationVote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nominationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NominationVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_tenantId_isPinned_createdAt_idx" ON "Post"("tenantId", "isPinned", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_tenantId_authorId_createdAt_idx" ON "Post"("tenantId", "authorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PostReaction_tenantId_postId_idx" ON "PostReaction"("tenantId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostReaction_postId_userId_key" ON "PostReaction"("postId", "userId");

-- CreateIndex
CREATE INDEX "Contest_tenantId_status_endAt_idx" ON "Contest"("tenantId", "status", "endAt");

-- CreateIndex
CREATE INDEX "Contest_tenantId_teamId_idx" ON "Contest"("tenantId", "teamId");

-- CreateIndex
CREATE INDEX "ContestStanding_tenantId_contestId_rank_idx" ON "ContestStanding"("tenantId", "contestId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ContestStanding_contestId_userId_key" ON "ContestStanding"("contestId", "userId");

-- CreateIndex
CREATE INDEX "Nomination_tenantId_eventId_category_idx" ON "Nomination"("tenantId", "eventId", "category");

-- CreateIndex
CREATE INDEX "Nomination_tenantId_nomineeId_idx" ON "Nomination"("tenantId", "nomineeId");

-- CreateIndex
CREATE UNIQUE INDEX "Nomination_eventId_category_nomineeId_key" ON "Nomination"("eventId", "category", "nomineeId");

-- CreateIndex
CREATE INDEX "NominationVote_tenantId_nominationId_idx" ON "NominationVote"("tenantId", "nominationId");

-- CreateIndex
CREATE UNIQUE INDEX "NominationVote_eventId_category_voterId_key" ON "NominationVote"("eventId", "category", "voterId");

-- AddForeignKey
ALTER TABLE "PostReaction" ADD CONSTRAINT "PostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestStanding" ADD CONSTRAINT "ContestStanding_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NominationVote" ADD CONSTRAINT "NominationVote_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "Nomination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Constraints the datamodel cannot express ───────────────────────────────

-- Media is ours or somebody else's, never both. The listings rule that videos
-- are always linked deliberately does not apply here: an internal clip is filmed
-- on a phone and belongs behind our own access control.
ALTER TABLE "Post"
    ADD CONSTRAINT "Post_video_source_check"
    CHECK (NOT ("videoKey" IS NOT NULL AND "videoUrl" IS NOT NULL));

-- A post with nothing in it is a misfire, not a message.
ALTER TABLE "Post"
    ADD CONSTRAINT "Post_body_check"
    CHECK (length(btrim("body")) > 0);

-- Moderation that leaves no trace is indistinguishable from a bug. Hiding a
-- post records who did it and why, or does not happen.
ALTER TABLE "Post"
    ADD CONSTRAINT "Post_hidden_check"
    CHECK (
      ("hiddenAt" IS NULL AND "hiddenById" IS NULL AND "hiddenReason" IS NULL)
      OR ("hiddenAt" IS NOT NULL AND "hiddenById" IS NOT NULL AND length(btrim("hiddenReason")) > 0)
    );

-- A contest that ends before it starts ranks nothing and reads as a typo
-- nobody catches until the prize is due.
ALTER TABLE "Contest"
    ADD CONSTRAINT "Contest_window_check"
    CHECK ("endAt" > "startAt");

ALTER TABLE "Contest"
    ADD CONSTRAINT "Contest_closed_check"
    CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));

-- Ranks start at one. A zeroth place is a bug in whatever wrote it.
ALTER TABLE "ContestStanding"
    ADD CONSTRAINT "ContestStanding_rank_check"
    CHECK ("rank" >= 1);

-- Categories are free text, so they need to actually contain something —
-- otherwise the one-vote-per-category index is keyed on an empty string and
-- silently becomes one vote per event.
ALTER TABLE "Nomination"
    ADD CONSTRAINT "Nomination_category_check"
    CHECK (length(btrim("category")) > 0);

ALTER TABLE "NominationVote"
    ADD CONSTRAINT "NominationVote_category_check"
    CHECK (length(btrim("category")) > 0);

-- Nobody nominates themselves, and nobody votes for their own nomination. The
-- second is checked in the service too, because it spans two tables; this
-- catches the direct write.
ALTER TABLE "Nomination"
    ADD CONSTRAINT "Nomination_not_self_check"
    CHECK ("nomineeId" <> "nominatedById");

-- ── Permissions ────────────────────────────────────────────────────────────
INSERT INTO "Permission" ("id", "module", "action", "description") VALUES
  (gen_random_uuid()::text, 'posts',     'VIEW',   'Read the internal feed'),
  (gen_random_uuid()::text, 'posts',     'CREATE', 'Post to the internal feed'),
  (gen_random_uuid()::text, 'posts',     'EDIT',   'Edit your own post'),
  (gen_random_uuid()::text, 'posts',     'DELETE', 'Hide somebody else''s post'),
  (gen_random_uuid()::text, 'contests',  'VIEW',   'See contests, standings and nominations'),
  (gen_random_uuid()::text, 'contests',  'CREATE', 'Run a contest or open nominations'),
  (gen_random_uuid()::text, 'contests',  'EDIT',   'Close a contest or a vote')
ON CONFLICT ("module", "action") DO NOTHING;

-- The feed is for everyone who works here, so reading and posting are derived
-- from simply having a seat: whoever may see their own tasks may see the feed.
-- DELETE is moderation and is not derived — taking somebody's words down is not
-- the same as being on the team.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", 'ORGANIZATION', NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target
  ON target."module" IN ('posts', 'contests') AND target."action" = 'VIEW'
WHERE source."module" = 'tasks' AND source."action" = 'VIEW'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", 'ORGANIZATION', NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'posts' AND target."action" IN ('CREATE', 'EDIT')
WHERE source."module" = 'tasks' AND source."action" = 'CREATE'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
-- Six tables, named explicitly. See the note in the M4 migration on why this
-- does not re-run the catalog-driven sweep.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['Post', 'PostReaction', 'Contest', 'ContestStanding', 'Nomination', 'NominationVote'];
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
