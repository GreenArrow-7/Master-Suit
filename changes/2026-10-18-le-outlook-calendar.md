# Meetings, follow-ups and site visits on the workspace's Microsoft 365 (Outlook) calendar

**What.** A workspace connects its Outlook calendar from Admin → Integrations →
Microsoft 365 → Connect with Microsoft, and from then on the same meetings
Google Calendar takes go onto it and follow every change: follow-ups of kind
Meeting or Site visit (every follow-up with the card's switch), appointment
tasks and site visits. Booked, created; moved, a PATCH; done, "Done: …";
cancelled, refused or deleted, removed. A workspace with both calendars
connected gets each meeting on both. PR #228.

**Why.** Audit row M8-09 (High), "Outlook / Microsoft 365 calendar sync",
mirroring Google's (M8-08, PR #221). Built on the owner's approval of 18 Oct to
build every pending item that needs no owner account, switched off until the
owner adds the keys.

**Where.**

- `src/services/integrations/calendarSync.ts` — new, provider-neutral: `CALENDARS` (each provider's connect, token and writer), `queueCalendarSync` (one job per connected provider), the `calendar-sync` job, the `calendar-sync-retry` sweep, `calendarAccessToken`, what each record wants on a calendar. Moved out of `googleCalendar.ts`.
- `src/services/integrations/microsoftCalendar.ts` — the consent flow (state in Redis, single use, plus a PKCE verifier) and `writeMicrosoftEvent`.
- `src/services/integrations/googleCalendar.ts` — now only Google's consent flow and `writeGoogleEvent`.
- `src/lib/integrations/calendar.ts` — Graph `POST /me/events` (with `transactionId`), `PATCH` and `DELETE /me/events/{id}`; Microsoft's token endpoint; one token request shared with Google.
- `src/app/api/v1/integrations/[provider]/connect`, `…/callback` — the Google routes, now serving `google` and `microsoft` (`/api/v1/integrations/microsoft/connect`, `…/microsoft/callback`).
- `prisma/migrations/20261018161700_calendar_event_links` — `CalendarEventLink` (record → Graph event id, `transactionId`), tenant-scoped, RLS forced.
- `src/lib/integrations/registry.ts`, `verify.ts` — the Microsoft 365 card (the "every follow-up" switch) and its Test connection (one Graph events read).
- `admin/integrations/page.tsx`, `IntegrationBoard.tsx` — Connect with Microsoft, "not configured on this deployment" naming the provider's own variables.
- `src/lib/env.ts`, `.env.example` — `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optional; the app registration steps beside Google's.
- Hooks (follow-ups, the call log, tasks, the automation's task, site visits, a stage's bookings, Move to Data, a leaver's hand-over) import `queueCalendarSync` from `calendarSync.ts`; none changed otherwise.

**Behaviour.** As Google's, with these differences: the event goes on the
connected account's default calendar (no calendar setting); times are sent in
UTC and Outlook shows them in each reader's zone; the owner is a required
attendee and Exchange sends them the invitation and each update (Graph has no
"send no email"). Graph chooses event ids, so the record's is kept in
`CalendarEventLink`; its `transactionId` is stored before the create, so a
retried create whose first answer was lost returns the same event, which is
then patched to the record as it now stands (Graph hands back the first
attempt's body unchanged; the same covers two syncs of one record racing). An event
deleted in Outlook is created again on the record's next change. Each token
refresh stores Microsoft's new refresh token, encrypted. Jobs ride the existing
`calendar` queue (payload now names `provider`; one queued before this reads as
Google) and the quarter-hourly sweep re-drives each provider's pending set.
Without the two variables the card reads not configured and connect answers 409.

**Decisions taken** (the recommended defaults):

- `common` authority, so a work, school or personal Microsoft account can connect; scopes `offline_access Calendars.ReadWrite User.Read`; `prompt=select_account`.
- State as Google's (random handle in Redis, ten minutes, spent first on every path) plus PKCE S256, the verifier only in Redis.
- One provider-neutral connect and callback route under `[provider]` rather than a copy per provider; Google's URLs are unchanged.
- No immutable ids: an event moved to Deleted Items gets a new id, so the next change re-creates it, as Google's PUT restores a deleted event.

**Verified.** `tests/integration/microsoft-calendar-sync.spec.ts` (11 cases,
fake Graph and token endpoint behind `fetch`, real routes and database): a
meeting follow-up is queued for Microsoft and created, moved with a PATCH of the
same id and cancelled with a DELETE that drops the link; a create whose answer
is lost is retried under the same `transactionId` and leaves one event (fails
with a new id per attempt), at the time the record was moved to in between
(fails, still at the old time, without the patch after a reused create); an event deleted in Outlook is re-created under a
new `transactionId`; appointment task and site visit, and a cancelled visit;
Graph down fails the job with the reason on the card and the sweep heals it;
token refresh stores the rotated refresh token encrypted; Google and Microsoft
both connected queue both; the consent flow (PKCE verifier answers the
challenge, state single use, tokens encrypted, audit without them); refused
when not configured (409, and a return connects nothing); refused for a member
without `integrations:MANAGE_CONFIGURATION`, start and finish; an unknown
provider is 422/404. `tests/unit/microsoft-graph.spec.ts` (9 cases): every Graph
request's method, URL and body, the token endpoint's form, Microsoft's error
text without trace ids or the secret. `google-calendar-sync.spec.ts` (15)
passes on the refactor with only its imports and the job payload's `provider`
changed. On `main` both new specs fail: the integration spec does not load
(no `[provider]` routes) and the Graph functions the unit spec calls do not
exist. Mutation audit, OpenAPI (regenerated), env example,
guarded prologue, the unit folder, schema drift and `check-rls` pass; `tsc`
clean.

**Left open.**

- Activation needs the owner: a Microsoft Entra app registration (steps in `.env.example`) in `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`; a tenant whose admin requires consent for `Calendars.ReadWrite` must have its admin approve the app once. The secret expires (24 months at most).
- No calendar choice (always the default calendar), no Teams link on events, one way only (a move in Outlook does not move the follow-up).
- A create whose answer never came back and whose record is cancelled before the retry leaves that event in Outlook (`ponytail:` in `microsoftCalendar.ts`).
- Disconnecting leaves the `CalendarEventLink` rows; reconnecting the same account keeps them in use, another account's 404s re-create.
