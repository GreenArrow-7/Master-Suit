-- Self-service RSVP: when the invitee opened their link.
--
-- A column rather than an RsvpStatus value. Viewing and answering are
-- orthogonal — someone who opens the link and then declines has done both, and
-- a single enum cannot record that. Adding 'VIEWED' to RsvpStatus would also
-- have made the dashboard counts wrong the moment somebody answered, because
-- the view would have been overwritten by the reply.
--
-- The RSVP link itself needs no column: the token is an HMAC over the invitee
-- id under WEBHOOK_SIGNING_PEPPER, so it is derivable, verifiable in constant
-- time, and revoked for every invitee at once by rotating the pepper. A stored
-- token would need a migration to revoke and a second index to look up.
ALTER TABLE "EventInvitee" ADD COLUMN "viewedAt" TIMESTAMP(3);

-- No RLS block: EventInvitee already carries a tenant_isolation policy from
-- 20260803230000_rls_full_coverage, and a policy covers columns added later.
