# Offline follow-ups and cold calls on the phone; the call log estimates the call; every write is audited or says why not; an Arabic workspace reads right to left; the lead lists measured at 1,000,000 leads

**18 Oct 2026** · feature, fix, measurement · Mobile, offline, audit, RTL, performance
(audit rows M20-01, M20-02, M20-04, M20-05, M20-06, M20-10, NFR-03, NFR-05,
NFR-07, NFR-09, NFR-10, NFR-11, NFR-13, PROD-13, PROD-14; PR #215, branch
`feat/le-mobile-nfr`)

**What**

- **Offline beyond the lead page** (PROD-14, M20). The outbox (`lib/offline.ts`)
  now sends every change with its own `Idempotency-Key`, the same on each
  attempt, so `route()` replays a change whose answer was lost instead of
  running it twice; a write that adds a row is now as safe to send late as one
  that sets a value. The Follow-ups list (complete, reschedule, cancel, reopen,
  New follow-up) and Cold Data's call outcome go through it, as the lead page
  and the call log already did. The offline notice names what is kept.
  Review fixes: a new follow-up names no record, so the server would file it
  under whichever session replayed it; each change now carries its owner
  (workspace and person, from the frame's `data-outbox-owner`) and is only sent
  from a screen with the same owner, and signing out sends what it can and
  forgets the rest. Sends run one at a time (queued in the page, a Web Lock
  across tabs): reconnecting and coming back to the app used to start two that
  both sent the first change, and the request key replays a retry, not a twin
  arriving alongside it.
- **The call log after the dialler** (M20-06). Back from a `tel:` call, the
  call log opens with the minutes estimated from the time away (rounded, at
  least one, at most 600) and a note that it is an estimate; back within 8
  seconds, No answer is picked. The call is logged at the time the dialler
  opened. Both are the agent's to change (`afterDial`, `lib/leads/callLog.ts`).
- **Audit gate** (NFR-05). `tests/unit/mutation-audit.spec.ts` reads every
  route file: each POST, PATCH, PUT and DELETE declares `auditEvent`, audits in
  its handler, or is listed with the file that audits it (checked to write an
  audit row) or why nothing is recorded. Walking the 62 that did neither found
  nine record changes with no trail, now audited: campaign members,
  qualifications and talking points; event invitees and an RSVP taken by an
  agent; a listing's portals; the portal feeds; the Sales manual target tally;
  and the platform's retention sweep (a `RETENTION_CLEANUP_RUN` platform audit
  row when it is not a dry run). Review fixes: "audited by" is now checked
  against what the handler calls from the named file (one of those functions
  audits, and none writes without auditing), which found four more: a client's
  testimonial (now audited as the link, System), a receipt's evidence upload
  (`auditEvent`), an HR checklist task added by hand, and platform staff leaving
  a workspace (`WORKSPACE_LEFT`); seeding the competency library audits too.
  Two entries named the wrong file (sign-up confirm, user delete) and the two
  lead webhooks only store and queue (their worker audits), now listed so.
- **Right to left** (NFR-09). Company profile has a Language (English, or
  Arabic, right to left); it is `OrganizationSetting.defaultLocale` and sets
  the workspace frame's `dir`. Every left/right in the workspace stylesheets
  (134 declarations in `globals.css`, `workspace-surface.css` and
  `styles/*-mobile.css`, `pages-copy.css`, `daily-board.css`) is now logical
  (`margin-inline-start`, `inset-inline-end`, `text-align: start`), identical
  in English; centring and the check-in compass stay physical. On a phone the
  closed menu waits past the right edge in Arabic.
- **Measured, and two fixes** (NFR-10, NFR-11). `tests/perf/lead-list-100k.spec.ts`
  takes `PERF_LEADS` (it ran at 100,000 and 1,000,000), seeds in SQL as the app
  role (a follow-up on every fifth lead), and gains a `more` case: the
  Follow-ups API and the Source to Booking report. At 1M the workspace-wide
  Follow-ups list missed 300 ms (307): a new index,
  `FollowUpTask(tenantId, dueAt)` (migration
  `20261018120000_follow_up_due_index`), brings it to 118. Source to Booking
  failed outright past 65,535 leads in its period; it now counts in the
  database. Numbers below.
- `apps/mobile/README.md` said push was absent and location and microphone
  undeclared; both were wrong after #190 and #201. Corrected, with the outbox.

**Why.** The owner's approved requirement rows of 11 Oct, lane mobile-nfr, on
current `main`.

**Decisions taken** (owner-approved defaults of 18 Oct)

- Arabic RTL: logical properties where layout is touched, `dir` from the
  workspace's language, English text only; translation is out of scope. No
  `lang` is set on the frame while the words are English (a screen reader would
  read them in an Arabic voice).
- Performance: measured on the rig with seeded data; fixed where a target was
  missed (the Follow-ups list) and where the report failed; the report's own
  time is recorded, not a target (it is not a list).
- M20-02: the standalone Expo app is superseded by the 5 Oct plan, which made
  the YOUHAN ONE app Lead Eagle's phone app
  (`changes/2026-10-05-lead-eagle-plan.md`, the Phone app row).
- `server.errorPath` (an offline page in the native shell) deliberately not
  added: on Android it also replaces every HTTP error page, so a deleted
  record's 404 would read as "cannot connect".

**Where** (under `apps/web/` unless named)

- `src/lib/offline.ts` — the per-change `Idempotency-Key`, the owner, one send at a time, `forget`; `src/lib/auth/signOut.ts`; the frame's `data-outbox-owner` in `layout.tsx`.
- `src/app/(workspace)/[workspaceSlug]/sales/follow-ups/FollowUpRowActions.tsx`, `FollowUpComposer.tsx`; `sales/cold-data/ColdDataActions.tsx` — through the outbox.
- `src/components/workspace/OfflineBanner.tsx` — the notice's wording.
- `src/lib/leads/callLog.ts` (`afterDial`), `sales/leads/CallLogDialog.tsx`, `sales/leads/[id]/LeadDetail.tsx` — the estimate.
- `tests/unit/mutation-audit.spec.ts` — the gate; the nine routes under `src/app/api/v1/`; `services/clients/testimonials.ts`, `api/v1/collections/receipts/evidence`, `services/hr/lifecycle.ts` (`addTask`), `services/hr/performance.ts` (`seedCompetencies`), `api/v1/platform/workspaces/[workspaceId]/enter` (DELETE).
- `src/lib/locale.ts`, `src/lib/workspace.ts` (the language on the workspace read), `src/app/(workspace)/[workspaceSlug]/layout.tsx`, `admin/[section]/page.tsx` and `SettingsForm.tsx` (a select), `api/v1/workspaces/[workspaceSlug]/settings/[section]/route.ts` (`locale`).
- `tests/perf/lead-list-100k.spec.ts` — `PERF_LEADS`, the SQL seed, `more`.
- `src/services/leadership/reports.ts` — Source to Booking counted by `groupBy`, visits and bookings by the lead relation.
- `prisma/schema.prisma`, `prisma/migrations/20261018120000_follow_up_due_index/` — the index.

**Behaviour**

- With no signal, completing, rescheduling or booking a follow-up and picking a
  cold call's outcome are kept on the phone ("Call kept on this phone; sent
  when online.") and counted by the notice; they are sent once when it is back.
- Back from dialling, the call log shows the minutes and, after a ring of a few
  seconds, No answer.
- An administrator picks Arabic under Company profile and the workspace reads
  right to left for everyone in it.

**Verified**

- New specs, each failing on the old code: `tests/unit/offline-outbox.spec.ts`
  (the key case; review: another session's change held, two sends at once
  send each change once, sign-out forgets), `tests/unit/after-dial.spec.ts`,
  `tests/unit/mutation-audit.spec.ts` (nine routes named; review: the four
  above), `tests/permission/admin-editors.spec.ts` (the language case);
  review: the audit row asserted in `tests/sales/client-profiling.spec.ts`
  (testimonial) and `tests/sales/collections.spec.ts` (evidence).
- Browser specs for CI: `tests/e2e/offline-outbox.spec.ts` (390 px, offline:
  a follow-up completed, one booked, a cold call; each sent once),
  `tests/e2e/rtl-workspace.spec.ts` (an Arabic Lead Eagle workspace's leads at
  390 px: `dir` rtl, no sideways scroll measured with the root both ways
  round, since a left-to-right root cannot see a spill past the left edge; the
  closed menu off the right edge),
  `tests/e2e/lead-call-log.spec.ts` (the estimate and No answer).
- Source to Booking: the existing report specs pass on the new code
  (`tests/sales/lead-eagle-reports.spec.ts`, `lead-record-fields.spec.ts`,
  `referral-source.spec.ts`); the failure on the old code is the perf case at
  1M (`-t more`, log `mobile-nfr-perf1m-more.log`), not a CI test (seeding
  65,536 leads would cost every CI run half a minute).
- `npx tsc --noEmit` clean; the spec counts are in the PR.

Measurements (rig: Windows laptop, Postgres in Docker shared with other rigs;
5 warm-ups then 50 runs, p95 in ms; ORG = an ORGANIZATION administrator, OWN =
an agent owning a fifth of the leads):

| Request                                                               | 100k ORG | 100k OWN | 1M ORG | 1M OWN |
| --------------------------------------------------------------------- | -------- | -------- | ------ | ------ |
| `GET /api/v1/leads` page 1                                            | 83.5     | 58.3     | 43.6   | 69.1   |
| `GET /api/v1/leads` page 200 (cursor)                                 | 160.1    | 50.9     | 61.9   | 63.4   |
| Grid page 1                                                           | 71.1     | 92.4     | 88.5   | 83.2   |
| Grid page 200 (`after=`)                                              | 108.5    | 102.6    | 74.8   | 90.6   |
| Grid page 200 (old `?page=200`, OFFSET; no screen links it)           | 85.5     | 360.2    | 150.7  | 169.1  |
| `GET /api/v1/follow-ups` (open), before the index                     | 113.1    | 87.7     | 307.1  | 149.3  |
| `GET /api/v1/follow-ups?due=overdue`, before the index                | 69.7     | 77.0     | 219.7  | 165.6  |
| `GET /api/v1/follow-ups` (open), with `FollowUpTask(tenantId, dueAt)` | —        | —        | 117.5  | 88.1   |
| `GET /api/v1/follow-ups?due=overdue`, with the index                  | —        | —        | 76.1   | 79.2   |
| Source to Booking, default period, before                             | 771.3    | 401.2    | fails  | fails  |
| Source to Booking, default period, after                              | —        | —        | 575.3  | 461.9  |

In Postgres (the list's own SELECT, app role, RLS on), p95: page 1 3.7 / 4.8
(100k ORG / OWN) and 3.3 / 3.7 (1M); page 200 by keyset 3.8 / 4.3 and 3.1 /
3.6; by OFFSET 23.4 / 140.3 and 21.4 / 126.2.

- Seeds: 100,000 leads in 73 s, 1,000,000 in 318 s, each with a follow-up on
  every fifth lead (a third done), five OWN agents, dates over a year. At 100k
  the follow-ups all fell to one agent (the seed picked by reference, which
  followed the owner); fixed before the 1M follow-up figures, which are spread.
- Load: other rigs ran tests throughout. CPU sampled before each run: 54%
  (100k), 27% (1M lists), 22% (follow-ups before the index), 100% at the start
  of the run with it. A first 100k run under heavier load gave the agent's grid
  page 1 513 ms; the repeat above gave 92.
- Reading: the lists measured here (the leads API, the leads grid and the
  Follow-ups API) are under 300 ms at p95 at 1M leads; Cold Data, Calls, Tasks,
  Site visits and the activity timeline were not timed. The one miss, the workspace-wide Follow-ups list at 307 ms, sorted all
  131,000 open follow-ups per page; the new index reads them in due order
  (EXPLAIN: an index scan, 26 ms, from a sort of the table, 58 ms in SQL).
- Source to Booking failed outright once a period held more than 65,535 leads
  (the IN list of their ids passed Postgres's bind-parameter limit: "The query
  parameter limit supported by your database is exceeded"); at 1M the default
  period holds 211,172. It now counts in the database and reaches visits and
  bookings through the lead. It is a report, not a list, and stays over 300 ms
  at that size: the period's aggregate reads 211,172 leads by
  `(tenantId, createdAt)`, 530 ms in SQL with the seed's dates scattered over
  the table's pages. 1,155 ms at p95 with the machine at 100%.
- Logs: `C:/ymw/r34/mobile-nfr-perf100k-*.log`, `mobile-nfr-perf1m-*.log`.

**Left open**

- M20-01 / PROD-14 (owner): WebView-as-shipped or a native shell over the API
  (Apple 4.2), the device pass of `apps/mobile/IOS-FEATURE-CHECKLIST.md` (rows
  23–30 at least) on one Android phone and one iPhone, and the Firebase file and
  APNs key for push (#201). Until then the "must not be submitted" note stays.
- M20-10: bearer device sessions only matter for a native client (M20-01).
- NFR-03: the OpenAPI document is the settings-api lane's (M19-01), built in
  the same round.
- NFR-13 (owner): `systemctl status master-suite-backup.timer` and
  `scripts/backup-status.sh` from production into a changes/ entry, and the RPO
  wanted (WAL archiving only if under 24 h).
- PROD-13 (owner): what "an application, not a feature" adds — its own sign-in
  page, branding on sign-in, a store listing, a domain.
- Right to left, not done: gradients and chevrons are not mirrored, inline
  `marginLeft` styles in components stay physical, the sign-in pages are not in
  the workspace frame; translation is its own project.
- ponytail: a cold call kept offline across midnight counts toward the day it
  is sent, as a lead's offline call does (the daily board reads `createdAt`).
- Source to Booking at a 200,000-lead period takes about half a second; a
  covering index or a nightly rollup if that matters. Open PRs #204 and #210
  change the same report case: whichever lands second keeps the database count
  and adds its own filter and money gate to it.
- Found while cleaning up: a lead's hard delete cascades to `FollowUpTask`
  through `leadId`, which no index leads with (both start `tenantId`), so each
  deleted lead scans the follow-ups. The 1M workspace deleted 110,000 leads in
  27 minutes this way; deleting its follow-ups first, then the leads, took a few
  minutes. It matters to the retention sweep's purge of soft-deleted leads and to
  deleting a workspace; a `FollowUpTask(leadId)` index, as 20261016120100 gave
  calls and site visits, if either grows slow.
