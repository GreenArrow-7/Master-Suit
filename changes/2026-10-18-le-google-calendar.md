# Meetings, follow-ups and site visits on the workspace's Google Calendar

**What.** A workspace connects its Google Calendar from Admin → Integrations →
Google Workspace → Connect with Google, and from then on its meetings go onto
that calendar and follow every change: a follow-up of kind Meeting or Site
visit, a task of an appointment type (Meeting, Site visit, Demo, or booked as
an appointment, as a stage's meeting booking is) and a site visit. Booked, it
is written; moved, it moves; done, it reads "Done: …"; cancelled, refused or
deleted, it comes off. PR: see the index.

**Why.** Audit row M8-08 ("Google Calendar sync of meetings/follow-ups"); the
Google helper was wired only to Events' Meet links. Built on the owner's
approval of 18 Oct to build the pending features with the recommended defaults.

**Where.**

- `src/services/integrations/googleCalendar.ts` — the connect flow's state, the refreshing access token, `queueCalendarSync` (after the write commits) and the `calendar-sync` job.
- `src/lib/integrations/calendar.ts` — Calendar API writes under our own event id (PUT, else insert; DELETE), and the token endpoint.
- `src/app/api/v1/integrations/google/connect/route.ts`, `…/callback/route.ts` — the consent screen and the return from it.
- `src/workers/jobs.ts` — `notifications: calendar-sync`.
- Hooks after the commit: follow-ups (create, edit, the one-step call log), tasks (create, edit with the next repeat, delete, the automation's Create task), site visits (book, edit, transition, cancel), a stage's bookings (`updateLead`), Move to Data's cancellations.
- `src/lib/integrations/registry.ts` — the Google card's switch "Every follow-up on the calendar"; `src/services/leads/intake.ts` reads any switch but the two capture ones as off until saved.
- `src/components/workspace/IntegrationBoard.tsx`, `admin/integrations/page.tsx` — Connect with Google, "not configured on this deployment", the message on return.
- `src/lib/env.ts`, `.env.example` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional.

**Behaviour.** The event carries the record's title and the lead's name, the
lead's page link (never its numbers), its time on the workspace's clock (a
follow-up 30 minutes, a task its type's length or 30, a visit its own) and the
owner as a guest, without an invitation email. A write never waits on Google:
the route commits and queues; if Google is down the job fails, the queue
retries (five times over a few minutes) and the Google card shows "Calendar
sync failed: …" until a sync succeeds. A connection made through Google is
refreshed with the deployment's client when its hour is up; Test connection
refreshes first and reads the events list (all the `calendar.events` scope
allows). Events' Meet links use the same refreshing token.

**Decisions taken** (the recommended defaults):

- One calendar per workspace, as the Google connection already was: the calendar the connection names (default the connected account's primary), the owner invited as a guest so it is on their own calendar too; no per-person connection.
- Follow-ups of kind Meeting and Site visit by default; calls and other follow-ups only with the card's switch on.
- A task is a meeting when it or its type is APPOINTMENT; it sits at its due time (where the app's calendar draws it and a reschedule moves it).
- Done stays on the calendar, marked "Done: "; cancelled, refused and deleted come off.
- The event id is derived (hex of tenant, kind and record id), so nothing new is stored and no migration is needed; a record deleted outright still takes its event with it.
- Scope `calendar.events` only; `access_type=offline` and `prompt=consent` so every connection holds a refresh token.
- The queue is `notifications` (its retry policy fits a vendor blip); a sync is queued only where a calendar is CONNECTED.

**Verified.** `tests/integration/google-calendar-sync.spec.ts` (8 cases, fake
Google behind `fetch`, no network): a meeting follow-up is written, moved and
removed through the real routes; a call follow-up stays off unless the switch
is on; a meeting task's length and Done; a site visit's place and length, and
cancelling it; Google down leaves the write and fails the job with the reason
on the card, then heals; an expired token is refreshed with the client and
stored encrypted; no connection queues nothing; the consent flow (state single
use and bound to the workspace, tokens encrypted). On `main` the spec does not
load (no connect routes); with the route hooks and the job taken back out, the
six sync cases fail and the two that pass are the empty queue and the consent
flow, which is new throughout. The existing specs of every touched area pass
(30 files, 732 tests, this one included); `tsc` clean.

**Left open.**

- Activation needs the owner: a Google Cloud OAuth client (Web application, Calendar API on, redirect URI `{APP_URL}/api/v1/integrations/google/callback`) in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and Google's verification of the app for the `calendar.events` scope before customers outside the owner's own Google Workspace connect (unverified, Google shows a warning and caps users).
- A leaver's hand-over and bulk reassignment move open follow-ups and tasks to a new owner without re-syncing: the event keeps the old guest until the record next changes.
- Turning "Every follow-up" off leaves the call follow-ups already written.
- One way only: an event moved in Google does not move the follow-up. Outlook (M8-09) would be a second writer beside `putGoogleCalendarEvent`.
