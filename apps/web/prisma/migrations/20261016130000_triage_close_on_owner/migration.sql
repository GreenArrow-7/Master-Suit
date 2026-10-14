-- A lead that gains an owner never commits with a WAITING triage episode,
-- whatever path wrote the owner. App-side checks cannot cover a write that
-- queued behind importBacklog's row lock and landed after the episode
-- committed. Deferred to commit so the app's own resolveTriageEntry (actor,
-- resolution, escalation answer) runs first; this only closes what is left.
-- Runs as the invoking role, so tenant RLS still applies.
CREATE OR REPLACE FUNCTION lead_close_triage_on_owner() RETURNS trigger AS $$
BEGIN
  UPDATE "LeadTriageEntry" e
     SET "status" = 'ASSIGNED', "resolvedAt" = now(),
         "resolution" = 'Lead was assigned outside the queue'
    FROM "Lead" l
   WHERE l."tenantId" = NEW."tenantId" AND l."id" = NEW."id" AND l."ownerId" IS NOT NULL
     AND e."tenantId" = l."tenantId" AND e."leadId" = l."id" AND e."status" = 'WAITING';
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER lead_close_triage_on_owner
  AFTER UPDATE OF "ownerId" ON "Lead"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."ownerId" IS NOT NULL AND OLD."ownerId" IS DISTINCT FROM NEW."ownerId")
  EXECUTE FUNCTION lead_close_triage_on_owner();
