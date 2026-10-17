# A morning summary email; lead hand-overs tell the new owner; an untouched lead escalates after any hand-over

**18 Oct 2026** · feature · Notifications, Lead Eagle (audit M8-04, M17-04, M17-05, M17-07, M17-08)

- **What.** A daily summary email for those who choose it, assignment notices on the paths that were silent, and a recurring first-contact sweep. PR #211.
- **Why.** Owner-approved requirements M8-04 / M17-04 (email digest of due follow-ups and new leads), M17-05 (a new lead's agent is told at once, QR capture links included), M17-07 (bulk and automatic re-assignments tell the new and previous owner), M17-08 (a lead untouched past N minutes is escalated to the manager).

**Where**

- `src/services/notifications/digest.ts` — the sweep; `src/workers/maintenance.ts` — job `digest`, schedule `morning-digest-hourly` (`5 * * * *`).
- `prisma/migrations/20261018120000_user_digest_sent_at` — `User.digestSentAt` (additive).
- `prisma/migrations/20261018130000_lead_sla_escalated_at` — `Lead.slaEscalatedAt` (additive; leads already breached are stamped as escalated for their current owner).
- `src/lib/notificationPrefs.ts`, `api/v1/notification-preferences`, Profile → Notifications — the `digest` choice; `src/workers/notifications.ts` — no per-notice email for a summary reader.
- `src/services/crm/notify.ts` — `notifyLeadMoves` (bell rows inside a bulk move's transaction), `ringNewOwner` (one push to whoever received leads in a bulk move).
- `src/services/leads/assign.ts` (bulk assign and the leaver hand-over), `src/services/distribution/allocation.ts` (Allocate, Approve request, cross-team routing), `src/services/leads/intake.ts` (QR capture links, cold-data convert), `api/v1/social-leads/[id]/convert` (a social enquiry made a lead for its owner), `src/services/leads/createLead.ts`.
- `src/services/sla/checkLeadFirstContact.ts` — `sweepFirstContact`; `src/workers/maintenance.ts` — job `first-contact`, schedule `first-contact-five-minutely` (`*/5 * * * *`).

**Behaviour**

- Profile → Notifications: under "Email copies", "One summary each morning instead". From 08:00 on the workspace's clock, once a day, one email: follow-ups overdue and due today (title, lead, time), and leads handed to you by someone else (or a rule) since the last summary; 20 lines a list, the heading has the full count; nothing to say, no email. Per-notice emails stop for that person; the bell and the phone are unchanged.
- The summary names a follow-up's lead only when the reader may still open it (`leadsInScope`, as the Follow-ups page does): a lead handed on or deleted since leaves its follow-up listed without a name. Leads the reader made, imported or converted for themselves are not "given to" them. A workspace without Sales, Real Estate or Lead Eagle gets no summary. Anything failing after the day's claim hands it back, so the next hour tries again.
- A lead created for a colleague is now `lead.assigned` (bell and phone), not a bell-only `lead.created`.
- A lead made straight for an agent by intake (QR capture link, cold-data convert) or by converting a social enquiry for its owner tells that agent in the bell and on the phone, and is dated as a hand-over (`assignedAt`, a history row); the person who converted it is not told of their own click.
- Bulk assign (lead grid), Allocate (and Approve request) and cross-team routing write a bell row per lead for the new owner (urgent) and the previous owner, in the move's transaction; then the person who received leads gets one push ("3 leads were assigned to you"). Bulk assign leaves a lead already with the chosen owner as it is (no history row, no notice, no push). A leaver's hand-over tells the receiving member in the bell.
- First contact (M17-08): every five minutes, a lead its owner has left uncontacted past its stage's "Respond within" minutes, counted from when they got it, is escalated once per hand-over: the owner's manager is told, and the lead is re-assigned when the rule's re-assign switch is on. This covers leads handed out after the delayed check at arrival (from the queue, by Allocate, by bulk assign).
- When a breach takes a lead back for re-assignment, the agent it was taken from is told after the re-assignment: "went to the next person in turn", or "is waiting to be handed out again" when nobody could take it; nothing when the rotation gave it straight back to them.

**Decisions taken**

- Summary hour fixed at 08:00 workspace time for every workspace (`ponytail:` in digest.ts); a setting when a workspace asks.
- The summary is a choice under email (email must be on), off by default like email copies.
- Bulk moves: bell per lead, one push per receiving person for bulk assign, Allocate and routing to a person; the leaver hand-over is bell only.
- A merge tells nobody: the other lead's customer joins the kept lead's owner, and its previous owner may not be able to open the kept lead.
- The first-contact sweep looks back one day past each deadline (`ponytail:`), so a long worker outage does not escalate old leads on restart; re-assignment stays "on breach" (`reassignAfterMins` as a switch), not a second timer.
- Notices are written directly (bell rows in the move's transaction, or `notifyCrm` after the commit), not through the outbox: same atomicity, delivered at once rather than on the next 5-minute sweep.

**M17-08 (SLA breach) — built**: #200 sent the manager notice and re-assigned at the one delayed check when the lead arrived; a lead handed out later had nothing to catch it. The recurring sweep above closes that; N minutes is the stage's "Respond within (minutes)" in Lead Stages (`StageEditor.tsx`).

**Verified**

- New: `tests/integration/notification-digest.spec.ts` (fixed clock: nothing at 07:30, one mail at 08:05, none at 09:05, next morning only newer leads; a lead handed on or deleted unnamed; own leads not "given"; no lead product, no mail; a failure after the claim retried the next hour; 08:00 local on both 2026/27 London clock changes; per-notice email suppressed; schedule armed).
- Extended (each fails on the old code): `tests/permission/lead-bulk-assign-scope.spec.ts` (new + previous owner rows; one push counting only leads that moved; lead created for a colleague; social enquiry converted for its owner), `tests/sales/capture-links.spec.ts`, `tests/sales/allocation.spec.ts` (one push for an allocation and for routing to a person), `tests/sales/sla-escalation.spec.ts` (take-back wording after re-assignment; the sweep escalates a lead handed out after the first check, once; schedule armed), `tests/sales/cold-data.spec.ts` (own conversion recorded as theirs); `tests/sales/assignment-working-hours.spec.ts` gains the unread urgent notice assertion (already true).
- No browser check: the screen change is one checkbox in the existing form's markup.

**Left open**

- The re-assign switch (`reassignAfterMins`) is set through the API only; the Allocation panel does not show it (M7-09's).
- The `follow_up.due` reminder sweep still runs for workspaces without a lead product (pre-existing; the summary now skips them).
- Phone delivery still needs the Firebase and APNs keys (2026-10-17-native-push-plugin.md).
