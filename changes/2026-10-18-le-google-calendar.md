# Meetings, follow-ups and site visits on the workspace's Google Calendar

**What.** A workspace connects its Google Calendar from Admin → Integrations →
Google Workspace → Connect with Google, and from then on its meetings go onto
that calendar and follow every change: a follow-up of kind Meeting or Site
visit, a task of an appointment type (Meeting, Site visit, Demo, or booked as
an appointment, as a stage's meeting booking is) and a site visit. Booked, it
is written; moved, it moves; done, it reads "Done: …"; cancelled, refused or
deleted, it comes off. PR #221.

**Why.** Audit row M8-08 ("Google Calendar sync of meetings/follow-ups"); the
Google helper was wired only to Events' Meet links. Built on the owner's
approval of 18 Oct to build the pending features with the recommended defaults.

**Where.**

- `src/services/integrations/googleCalendar.ts` — the connect flow's state, the refreshing access token, `queueCalendarSync` (after the write commits) and the `calendar-sync` job.
- `src/lib/integrations/calendar.ts` — Calendar API writes under our own event id (PUT, else insert; DELETE), and the token endpoint.
- `src/app/api/v1/integrations/google/connect/route.ts`, `…/callback/route.ts` — the consent screen and the return from it (a plain handler, as Facebook's: it spends the state and redirects even with no session).
- `src/workers/jobs.ts`, `src/lib/queue.ts` — `calendar: calendar-sync`, a queue of its own; `src/workers/maintenance.ts` — `calendar-sync-retry`, quarter-hourly.
- `src/services/leads/assign.ts` — a leaver's hand-over returns the records whose event names them; `syncHandedOver` re-syncs them after the commit (Admin → Users deactivate and remove, HR's exit).
- `src/lib/security/redirect.ts` — `safeReturnTo` refuses control characters (the review's open redirect).
- Hooks after the commit: follow-ups (create, edit, the one-step call log), tasks (create, edit with the next repeat, delete, the automation's Create task), site visits (book, edit, transition, cancel), a stage's bookings (`updateLead`), Move to Data's cancellations.
- `src/lib/integrations/registry.ts` — the Google card's switch "Every follow-up on the calendar"; `src/services/leads/intake.ts` reads any switch but the two capture ones as off until saved.
- `src/components/workspace/IntegrationBoard.tsx`, `admin/integrations/page.tsx` — Connect with Google, "not configured on this deployment", the message on return.
- `src/lib/env.ts`, `.env.example` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional.

**Behaviour.** The event carries the record's title and the lead's name, the
lead's page link (never its numbers), its time on the workspace's clock (a
follow-up 30 minutes, a task its type's length or 30, a visit its own) and the
owner as a guest, without an invitation email. A write never waits on Google:
the route commits and queues on the `calendar` queue (its own worker, so a
hanging Google never holds up reminder pushes or emails); if Google is down
the job fails, the queue retries (five times over about eight minutes), and a
record still not synced — or changed while the connection was in error —
stays pending until the quarter-hourly sweep gets it through. The Google card
shows "Calendar sync failed: …" until nothing is pending. A leaver's open
follow-ups, tasks and site visits are re-synced after the hand-over: the new
owner is the guest, and a suspended or removed owner is never invited again.
A changed Calendar setting moves an event on its next sync (taken off the
calendar it was written to), and a cancel removes it from every calendar the
workspace wrote to. In the iOS and Android apps the card says to connect from
a browser (Google's sign-in leaves the app). A connection made through Google is
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
- The queue is `calendar`, its own (review: on `notifications` one worker at a time, 30 s per Google call, held up reminder pushes and HR emails behind a hanging Google); five attempts from 30 s apart.
- What is pending and which calendars were written to live in Redis sets per workspace (`google:calendar:pending:{tenant}`, `google:calendar:written:{tenant}`), not the database: no migration, and a lost set only costs the next retry.
- A guest is an ACTIVE account only; the leaver's open site visits, which are not handed over, are re-synced so they drop off.
- A return path from another workspace's state lands on `/`; a signed-out return says to sign in and connect again.

**Verified.** `tests/integration/google-calendar-sync.spec.ts` (15 cases, fake
Google behind `fetch`, no network): a meeting follow-up is written, moved and
removed through the real routes; a call follow-up stays off unless the switch
is on; a meeting task's length and Done; a site visit's place and length, and
cancelling it; Google down leaves the write and fails the job with the reason
on the card, then heals; an expired token is refreshed with the client and
stored encrypted; no connection queues nothing; the consent flow (state single
use and bound to the workspace, tokens encrypted). On `main` the spec does not
load (no connect routes); with the route hooks and the job taken back out, the
six sync cases fail and the two that pass are the empty queue and the consent
flow, which is new throughout. Review round, each failing on the code before
it: its own queue; a sync out of retries re-driven by the sweep while a later
success elsewhere leaves the card's error; a meeting cancelled while the
connection was in error comes off once connected; a leaver's meeting goes to
its new owner and their visit drops them as guest (fails with either the
re-sync or the active-owner check taken out); a changed calendar leaves no copy
at the old time and a cancel finds the old calendar; signed out, the callback
spends the state and lands on this site even with `returnTo` `/\t/evil.example`
(401 before); the app's card; `tests/security/redirect.spec.ts` refuses tab,
CR, LF and NUL. The existing specs of every touched area pass; `tsc` clean.

**Left open.**

- Activation needs the owner: a Google Cloud OAuth client (Web application, Calendar API on, redirect URI `{APP_URL}/api/v1/integrations/google/callback`) in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and Google's verification of the app for the `calendar.events` scope before customers outside the owner's own Google Workspace connect (unverified, Google shows a warning and caps users).
- Bulk reassignment of leads does not move their follow-ups, so nothing to re-sync there; a lead's owner change through `updateLead` re-syncs only what its stage booked.
- Reconnecting with a different Google account leaves events on the old account's calendars, which the new token cannot reach.
- A record Google refuses for good (a 400) is retried by every sweep, its reason on the card.
- Turning "Every follow-up" off leaves the call follow-ups already written.
- One way only: an event moved in Google does not move the follow-up. Outlook (M8-09) would be a second writer beside `putGoogleCalendarEvent`.
