# Findings

Evidence-supported gaps, divergences, duplicated logic, test gaps and
possibly-unused code. Paths relative to `apps/web/` unless they start with
`apps/`, `docs/`, `changes/` or `.github/`.

| | |
| --- | --- |
| Branch | `claude/ponytail-lite-0e416b` |
| Commit | `babbaa06db5620590e1308a6a1fa94054b304992` |
| Analysed | 12 Nov 2026 |

**Confidence** is stated per finding:

- **confirmed** — the code proving it was read directly during this analysis.
- **reported** — found by a review pass and cited precisely, but not
  independently re-read. Treat the citation as reliable and the conclusion as
  likely.
- **suspected** — reasoned from structure; needs checking before acting.

Nothing was executed. `node_modules` is absent, so there is no build, no
typecheck, no test run and no measurement anywhere in this document. Static
analysis does not prove runtime behaviour.

**On "unused code":** nothing below is called unused merely because a static
search found no callers. Each candidate was checked against dynamic routes,
queue job tables and configuration, and the one false positive that scan
produced is named so the method is visible.

---

## Severity summary

| Severity | Count | Theme |
| --- | --- | --- |
| Critical | 1 | An unreleased fix for a total feature outage |
| High | 9 | Live defects and one live data-exposure path |
| Medium | 14 | Divergences, gaps that become live when something else is fixed, scaling ceilings |
| Low | 6 | Latent risks, documentation defects |

---

## Critical

### F-01 · `main` is four commits ahead of production, including a total AI outage fix
**Confidence: confirmed.** `changes/PROJECT.md:3` records production at
`1f98183b`. `git rev-list 1f98183b..HEAD` is 4. One of those commits,
`4fd93175` (#248), fixes what its own change entry calls *"a total outage of the
feature"* — a tool declared with no parameters was sent to Google without a
`parameters` key, and Google validates the whole request before running any of
it, so **one malformed declaration out of sixteen failed every assistant
request, on every question, in every workspace on a `google` credential**.

It survived CI because Test connection called a model listing that sends no
tools, so it was green while the feature was dead.

**Next step:** release `main`. Commit `062b9877` (#247, a CI gate refusing a
tracked `.env`) is waiting behind it. Nothing else in this document matters as
much.

---

## High

### F-02 · Owner phone numbers are recoverable by enumeration
**Confidence: confirmed.** `maskTail` (`lib/inventory/listings.ts:142`) keeps
`value.slice(0, 4)` and the last two digits. Phone numbers are stored **as
typed**, so for the ordinary UAE form `0501234567` the mask is `0501••••67` —
that prefix is the operator code plus the first subscriber digit, leaving **four
unknown digits**. `GET /api/v1/owners?phone=` filters on `phoneNormalized`
(`app/api/v1/owners/route.ts:49`) and **declares no `rateLimit`**, so it falls
to `limits.sessionUser` = 1200/min: about nine minutes per landlord, repeatable
across the book, by a role holding `listings:VIEW` without
`VIEW_SENSITIVE_FIELDS`.

The same codebase gets this right twenty lines away:
`lib/security/fieldSecurity.ts:128` keeps a head **only** if it matches
`^\+\d{1,3}`, with the reason beside it — *"there it is the operator code, and a
lead can be found by its whole number, so each digit left showing is one fewer
to guess."* And `listings.ts:119-126` names this exact threat: *"an agent who
can export every landlord's mobile can take the business to a competitor in an
afternoon."*

**Next step:** mask owner numbers through `applyFieldSecurity`'s `MASK_PARTIAL`,
which is already correct, and gate the `?phone=` exact lookup on
`listings:VIEW_SENSITIVE_FIELDS`.

### F-03 · Rescheduling a follow-up permanently silences its reminder
**Confidence: confirmed.** The reminder sweep filters `WHERE t.status = 'OPEN'`
(`services/crm/reminders.ts:92`). `app/api/v1/follow-ups/[id]/route.ts:52` sets
`status = 'RESCHEDULED'` on any open follow-up whose `dueAt` changes. The shared
open set everywhere else is `['OPEN','IN_PROGRESS','RESCHEDULED']`
(`lib/leads/followUpDue.ts:12`, and the three sibling raw queries).

Rescheduling is the single most common follow-up action. After it, the T-15
sweep never selects that row again — no bell, no push, no email, ever.

**Next step:** replace the literal with the shared open set, as
`services/leads/nextFollowUp.ts:153` already does.

### F-04 · Two incompatible definitions of "overdue"
**Confidence: confirmed.** `followUpDueWhere` uses
`{ dueAt: { lt: today.from } }` — before the workspace day began, zone-aware
(`lib/leads/followUpDue.ts:48`). `obligationWhere` uses
`{ dueAt: { lt: now } }` — before this instant, with no zone consulted
(`services/leads/nextFollowUp.ts:281`).

So on a Dubai workspace at 14:00, a follow-up due today at 09:00 is excluded by
one and counted by the other. `sales/page.tsx:219` and `:397` print different
"Overdue" figures **from the same file**. The split runs through the grid chip,
the lead CSV export, the REST list, smart views and the assistant on one side,
and the Follow-ups list, the board tile and the morning digest on the other.

**Next step:** give `obligationWhere` the workspace zone and build its bound
from `dayBounds(todayKey(tz, now), tz).from`.

### F-05 · HR event emails re-send to everyone who already received them
**Confidence: confirmed.** `emailHrEvent` selects recipients by
`{ tenantId, id: { in: userIds }, status: 'ACTIVE' }`
(`workers/notifications.ts:123-126`) and loops over them. The `emailedAt: null`
filter applies only to the *stamping* `updateMany` (`:145`). One bad address
throws, BullMQ retries (`attempts: 5`), and everyone who succeeded is mailed
again — up to five copies of a leave approval. The comment at `:154-155` claims
the opposite.

Secondary, same function: the stamp keys on `{ tenantId, userId, kind }` with no
record id, so two approvals queued close together cross-stamp each other's
delivery state.

**Next step:** select recipients from their un-emailed `Notification` rows, by
notification id, and stamp by that id.

### F-06 · The lead board asks for one database connection per pipeline stage
**Confidence: confirmed.** `sales/leads/page.tsx:185` runs
`Promise.all([lead.groupBy, Promise.all(stages.map(… findMany))])` and the file
contains **no `withTx` at all**. Each element is its own transaction on its own
pooled connection, so the peak is `1 + stages.length`. A Lead Eagle workspace is
seeded exactly 12 stages (`services/platform/provisioning.ts:196-208`) and
stages are workspace-editable, so the count is unbounded by code.

Thirteen concurrent checkouts against a pool of **10**
(`lib/db.ts:536` constructs `PrismaPg` with no `max`, so pg's default stands) and
a documented budget of 5 per render. Three waiters queue, and with any other
request in flight one crosses `connectionTimeoutMillis: 5_000` and the render
throws.

**Next step:** wrap the groupBy and the per-stage reads in one
`withTx(ctx.tenantId, …)`, then **add this screen to
`tests/sales/screen-connections.spec.ts`** — the harness already asserts
`≤ size / 2` and would have caught it.

### F-07 · The lead grid's own prologue is about twice the pool budget
**Confidence: reported, mechanism confirmed.** A nine-element `Promise.all`
outside `withTx` (`sales/leads/page.tsx:115-159`), of which two are not single
queries: `assignableUsers` resolves owner ids first, and for a TEAM viewer
`resolveOwnerIdsUncached` walks the team tree one query per level. Four more
reads follow sequentially. Estimated 9 concurrent, ~11–12 for a TEAM viewer with
a nested tree, against a budget of 5.

**Next step:** move the eight reference reads into one `withTx` and leave only
the paged `lead.findMany` outside it.

### F-08 · The five-minutely SLA sweep scans `Lead` platform-wide on unindexed columns
**Confidence: reported.** `services/sla/checkLeadFirstContact.ts:64-82` runs
under `withPlatformTx` — all tenants at once — filtering on `firstContactedAt`,
`assignedAt` and a computed interval over a joined column. No index on
`firstContactedAt`, `assignedAt` or `slaEscalatedAt` exists in
`prisma/schema.prisma`, and the time predicate is an expression no plain B-tree
could serve. 288 times a day, then up to 600 sequential round trips per tick.

**Next step:** a partial index on `Lead (tenantId, assignedAt)` where
`firstContactedAt IS NULL AND ownerId IS NOT NULL AND deletedAt IS NULL`, and
one batched claiming `UPDATE … RETURNING` instead of the per-row loop.

### F-09 · The maintenance worker runs one job at a time, so report emails starve the SLA sweeps
**Confidence: reported.** `workers/jobs.ts:80` gives every queue but `ai`
`concurrency: 1`. The `maintenance` queue carries the three `*/5` sweeps
alongside `report-schedules`, `retention` and the hourly `digest`.
`runReportSchedules` loops up to 200 due schedules sequentially, and a
month-pivoted report is one serial round of 2–4 queries per month, up to 36.

So at the quarter hour that is 07:00 for a large cohort, SLA escalation — whose
unit of lateness is *minutes* — stops firing for as long as the batch runs, with
nothing logged as an error. The file already states the principle at `:192-201`,
which is why `reminders` has its own queue; `first-contact` was left behind.

**Next step:** give the three `*/5` sweeps their own queue.

### F-10 · The only end-to-end proof that the AI tool loop scopes data to the asker never runs in CI
**Confidence: reported.** `tests/e2e/ai-live-answer-acceptance.spec.ts:52` skips
unless `AI_GOOGLE_BASE_URL` is set, and nothing in `.github/workflows/` sets it
or starts the fake provider. Four cases — including "two agents each see their
own overdue follow-up and never the other's" — run **zero times per CI run**.
Compounding it, the skipped-test gate greps the unit step's log only
(`.github/workflows/ci.yml:374-382`), so neither the server nor the Playwright
suite reports a skip.

**Next step:** background the fake provider and export the base URL in one CI
step before the E2E job; extend the skip grep to both other suites.

---

## Medium

### F-11 · `accrueCommission` has no record-scope check on the booking
**Confidence: confirmed.** It loads the booking by
`{ id, tenantId, deletedAt: null }` (`services/money/commissions.ts:108-110`),
checks status and prior accrual, and the file contains **no**
`assertRecordVisible`, `assertBookingInScope` or `visibilityWhere`. So
`commissions:EDIT` at OWN scope can accrue against any confirmed booking in the
workspace — including another agent's sale. Every sibling money path does check:
`collections.ts:143-162` has `assertBookingInScope`.

**Next step:** call `assertBookingInScope` inside the accrual transaction.

### F-12 · Contact, account and opportunity `VIEW_SENSITIVE_FIELDS` masks nothing
**Confidence: confirmed.** `seesField` reaches the `VIEW_SENSITIVE_FIELDS`
branch only when the field is in the `sensitiveFields` argument
(`lib/security/fieldSecurity.ts:48-58`). The only such map in the repository is
`LEAD_SENSITIVE_FIELDS` (`services/leads/createLead.ts:31`), and every call for
those three types passes none. The other path, an explicit `FieldPermission`
row, has **no writer anywhere in `src/`** — `prisma.fieldPermission` is only
ever read (`:21`); the only writes are in tests.

An administrator who withholds `contacts:VIEW_SENSITIVE_FIELDS` sees the switch
in the role editor and reasonably believes contact numbers are masked. They are
returned in full by every list, detail, export and assistant path. **A control
that reads as working and is not.**

**Next step:** give those types their own sensitive-field constants and pass
them at every call, **together with F-13 and F-14** — see the warning below.

### F-13 · The shared CSV export route applies no field-security pass
**Confidence: confirmed.** `app/api/v1/exports/[resource]/route.ts` asserts
`EXPORT` (`:256`), scopes rows with `visibilityWhere` (`:258`) and audits
`EXPORT_REQUESTED` (`:269`) — but contains **no field-security reference at
all**, across six resources. `contacts` emits `Email` (`:121`) and `Phone`
(`:122`) raw; `commissions` emits per-user `Base`, `Rate %`, `Share %`, `Amount`
(`:211-214`). The matching list route masks at
`app/api/v1/contacts/route.ts:62` and `:87`.

**Inert today** for the same reason as F-12. The lead export is unaffected — it
applies `LEAD_SENSITIVE_FIELDS`.

### F-14 · The assistant offers a phone *suffix* filter on contacts and returns the number raw
**Confidence: confirmed.** `searchContacts` declares `phoneEndsWith` as a tool
parameter and compiles it to
`{ phone: { endsWith: … } }` (`lib/ai/assistant/tools.ts:532`), plus
`{ phone: { contains: args.q } }` (`:538`), and returns `email` and `phone`
unmodified (`:561-562`) with no `loadFieldRules` and no `applyFieldSecurity`.
`assertFilterableFields` — the guard that exists for exactly this — is called in
`app/api/v1/{contacts,accounts,leads}/route.ts` and **nowhere in the
assistant**. `lib/security/fieldSecurity.ts:94-96` states the rule it defeats:
*"Filtering or sorting on a hidden field would let a caller recover the masked
value by binary search."*

> **F-12, F-13 and F-14 are one change.** Fixing F-12 alone does not close the
> hole, it moves it — and into a *stronger* form. Enumerating through
> `?phone=` takes minutes; a suffix filter recovers a number by binary search in
> a handful of calls. Ship all three together or none.

For contrast the lead side is correct: its only substring filter is behind
`sees('phone')` (`services/leads/createLead.ts:65`) and the assistant's lead
tools do apply the mask.

### F-15 · The portal feed is the one public route with no rate limit
**Confidence: reported.** `app/api/v1/feeds/[workspaceSlug]/[feedKey]/route.ts:27-41`
is hand-rolled, calls no `consume(...)` and does not go through `route()`. It is
`force-dynamic` with `no-store`, and on a valid key `buildFeed` opens a `withTx`
reading the whole published inventory. Even an invalid request costs two pinned
transactions before the 404. Every sibling unauthenticated surface throttles
first, and `infra/Caddyfile` has no edge limit.

**Next step:** `consume(limits.webhook(feedKey))` as the route's first
statement.

### F-16 · A grant-holder can enter a SUSPENDED or ARCHIVED workspace
**Confidence: confirmed.** The enter route's `where` is
`{ id: workspaceId, deletedAt: null }` — `status` appears only in the `select`
(`app/api/v1/platform/workspaces/[workspaceId]/enter/route.ts:27-30`) — and
`mayEnterWorkspace` (`lib/auth/platform-access.ts:210-220`) checks nothing but
`activeGrant('READ')`, break-glass `WRITE` and `activeCoverage`. No tenant-status
check exists in that path. The directory will not list such a workspace, but
posting its id works. A comment at `app/(monitoring)/monitoring/page.tsx:74-78`
claims the two paths apply the same rule; they do not. The grant-issuing route
has the same gap.

**Next step:** filter on `status: 'ACTIVE'` in both, or check it in
`mayEnterWorkspace` so one change covers every caller.

### F-17 · `remember`'s catch swallows every failure, so an honest retry can double a write
**Confidence: reported, mechanism confirmed.** `lib/api/handler.ts:411-419`
wraps `recordOutcome` and logs any error at warn. The in-code note only excuses
the documented concurrent-first-send race, but the catch also swallows a
connection failure, a tenant-guard trip or a serialisation failure. The request
still answers 200 with the write committed and **no replay row**. It opens a
*second* transaction after the handler has finished with the pool, which under
load is exactly the call most likely to time out.

So an offline-outbox PATCH can commit, lose its answer, retry under the same key,
find nothing, and run again.

**Next step:** re-raise anything that is not the race conflict, or claim the key
before the handler as `services/leads/logCall.ts` does.

### F-18 · A replayed request skips its audit row
**Confidence: reported.** The kernel writes the idempotency record at
`handler.ts:279` and the audit row at `:283`, guarded by `!replay`. If the audit
write throws, the response is 500; the client retries, the replay hits, the
audit is skipped and the answer is 200. The write exists with no `AuditLog` row —
against the project's own rule that every write leaves one.
`tests/unit/mutation-audit.spec.ts` gates the *declaration*, not this path.

**Next step:** write the audit row inside the handler's transaction, or at least
before the replay record.

### F-19 · Route-level `auditEvent` fires on a service-level replay
**Confidence: reported.** `handler.ts:282` reasons that a replay did nothing —
but `replay` there is only the *kernel's* replay. `app/api/v1/activities/route.ts`
and `collections/receipts/route.ts` declare `auditEvent: 'RECORD_CREATED'` while
their services run their own `findReplay` on a body `requestKey` the kernel
cannot see, and neither declares `idempotent: false`. So a resend creates
nothing and still writes "a record was created" — for the collections route with
`recordId: undefined`, because the handler returns a wrapper.

**Next step:** let the handler report that it replayed, or have those routes
audit in-handler and drop `auditEvent`.

### F-20 · `dayBounds` assumes a 24-hour day and noon-UTC anchoring
**Confidence: reported.** `services/targets/dailyBoard.ts:89-90` computes `to`
as `from + 24h - 1ms`. On a 25-hour DST day that is an hour short, so a 23:30
follow-up is excluded from `due=today` *and* included in `due=upcoming`; on a
23-hour day the window reaches into tomorrow and double-counts. Separately, noon
UTC on day D is already D+1 at UTC+12 or beyond, so `dayBounds` for an Auckland
workspace returns the wrong day entirely.

This is the primitive behind `todayKey`, `followUpDueWhere`, `boardPeriod`,
`reportParams`, the lead date range, the 08:00 digest and the check-out gate.
Latent while every workspace is on a DST-free zone like Asia/Dubai —
`workspaceTimezone` accepts any IANA name.

**Next step:** compute `to` as an exclusive next-day bound and anchor on the
requested date, not noon UTC.

### F-21 · An unknown job name is acknowledged and discarded
**Confidence: reported.** `workers/jobs.ts:67-71` logs a warning and `return`s,
which marks the job completed, so BullMQ removes it — no failed-set entry, no
retry. During a rolling deploy where web updates before worker, a renamed or new
job is silently lost. The file already keeps `hr-event-push` as an alias "for
jobs mid-flight across a deploy", so the hazard is known.

**Next step:** throw instead of returning.

### F-22 · Lead search is a leading-wildcard `ILIKE` with no trigram index
**Confidence: reported.** `leadSearch` (`services/leads/createLead.ts:75-84`)
emits `ILIKE '%q%'` across three columns, consumed by `leadListQuery`, so by the
grid, the board, the list API, the mobile API and the export. `Lead` has no
trigram index — **while the repository already creates exactly that** for
`Project.name` and `Listing.title` in migrations. Separately `Lead.searchVector`
exists in the baseline migration and is never read or written anywhere in
`src/`.

**Next step:** add GIN trigram indexes on `Lead.fullName`, `company` and
`reference`, copying the existing Project/Listing statements.

### F-23 · Two of the lead grid's four keyset sorts have no index to seek on
**Confidence: reported.** `?sort=updated` is indexed column-for-column.
`?sort=created` is acceptable. `?sort=score` has no `id` in the index and
`score` defaults to 0, so in a workspace that never configured scoring the
keyset bound selects the whole table. `?sort=name` has **no index on
`Lead.fullName` at all**.

**Next step:** add `@@index([tenantId, fullName, id])` and widen the score index
to include `id`.

### F-24 · ~20 authorization refusals are asserted as `>= 400`
**Confidence: reported.** `tests/permission/module-entitlement.spec.ts:506`,
`tests/e2e/record-scope.spec.ts:138` and others assert
`expect(status).toBeGreaterThanOrEqual(400)`, which a 429, a 500 or a 404 from a
renamed route satisfies equally. `record-scope.spec.ts:138` loops a path list, so
a URL typo makes the check vacuous while the test stays green.

This compounds F-25: an exhausted login bucket returns 429, which passes.

**Next step:** assert the exact status — 403 for a denied permission, 404 for an
out-of-scope record.

---

## Low

### F-25 · Login rate-limit buckets are cleared once per run, not per spec
**Confidence: reported.** `tests/globalSetup.ts` clears `rl:*` once; the unit
config sets no `fileParallelism: false`, so files run concurrently; and
`tests/helpers/isolation.ts:1-21` documents that `TRUSTED_PROXY_CIDRS=none`
collapses every sign-in onto one bucket capped at 10 per 15 minutes. 34 spec
files touch the login path and only 12 clear defensively. The suite's own words:
*"A security assertion that never ran because the request was refused upstream
looks exactly like one that passed."*

### F-26 · A wall-clock wait of up to 60s sits in a suite with a 30s timeout
**Confidence: reported.** `tests/identity/account-deletion-http.spec.ts:230-233`
sleeps out a rate-limit window; `vitest.config.mts` sets `testTimeout: 30_000`.
`tests/security/ratelimit.spec.ts:39` already drives the limiter with fake
timers, so the tool exists.

### F-27 · Manual triage placement omits `assertAssignableUser`
**Confidence: confirmed; not a live hole.** `services/distribution/triageQueue.ts:206-212`
carries a comment admitting the omission. It is closed today by two independent
facts: `visibilityWhere(ctx,'leads','ASSIGN')` passes no `includeUnassigned`, and
a waiting lead has `ownerId: null`, so nothing below ORGANIZATION matches — and
at ORGANIZATION every active member is assignable. `lockAndVerify` also fails
closed on an out-of-tenant or inactive target.

**Next step:** add the check now, before the `includeUnassigned` change the
comment warns about.

### F-28 · A phone session never re-checks password expiry
**Confidence: confirmed.** The device Ctx returns only `tenantId`, `actor`,
`requestId`, `ip`, `userAgent`, `deviceSessionId`
(`lib/auth/session.ts:363-371`), omitting `mustChangePassword` and
`passwordChangedAt`, which the web branch sets at `:622-623`. The mobile door
refuses an expired password at sign-in, but a password crossing `maxAgeDays`
*after* the phone signed in keeps working for the rest of the 90-day session.

### F-29 · `content-disposition` is built from a user-typed title with no control-character strip
**Confidence: reported.** `lib/inventory/media.ts:77` removes quotes and
backslashes but not CR/LF. Undici rejects such a header, so the outcome is a 500
rather than response splitting — a validation gap at an egress boundary.

### F-30 · The `npm audit` exception expires on a date, not a change
**Confidence: reported.** `scripts/audit-gate.mjs:23` carries
`until: '2026-12-15'` and `:61-62` fails the build the day it expires. Working as
designed, but CI turns red on **15 December 2026** for whoever merges that
morning.

**Next step:** schedule the upgrade now.

---

## Architecture: suspicious dependencies

### F-31 · No layering between `lib` and `services`
**Confidence: confirmed.** The directed dependency graph has **one
27-module strongly-connected component** spanning every `lib/*` and `services/*`
area: `lib/{ai,api,auth,db.ts,grid,integrations,inventory,leads,proposals,security,value}`
and `services/{conversations,crm,distribution,hr,idempotency.ts,identity,integrations,inventory,leadership,leads,meta,notifications,shared,social,targets}`.
A second 5-module cycle covers
`app/(workspace)/[workspaceSlug] ↔ components/{nav,sales,ui,workspace}`.

Nothing enforces a direction, so the component can only grow. It is not causing
a defect today; it is why a change in `lib` can reach anywhere.

**Next step:** a lint rule forbidding `lib/* → services/*` imports would stop it
growing. Unwinding it is a project, not a fix.

### F-32 · Six file-level import cycles
**Confidence: confirmed.** 14 files in 6 groups:
`services/integrations/{calendarSync,googleCalendar,microsoftCalendar}.ts`;
`lib/ai/{analysis,audit,simulated}.ts`; `lib/ai/{allowance,usage}.ts`;
`services/hr/attendance.ts ↔ services/targets/dailyBoard.ts`;
`lib/ai/liveCoach.ts ↔ services/leads/callContext.ts`;
`services/automation/{records,writableFields}.ts`.

---

## Duplicated logic

### F-33 · A `money()` formatter in 18 files and a `date()` formatter in 13
**Confidence: confirmed.** Local helpers of the same name are defined
independently in 18 and 13 page files respectively. The `date()` copies matter
more than duplication alone: the project's rule is that a date formatted on the
server reads in the **workspace's** zone, and F-34 shows that rule being missed.

**Next step:** one shared formatter pair, taking the zone.

### F-34 · ~25 server-rendered timestamps are formatted in the container's zone
**Confidence: reported.** `sales/calls/[id]/page.tsx:183`,
`admin/audit/page.tsx:326`, `sales/allocation/page.tsx:233`,
`dashboard/page.tsx:672` and about 21 others call `toLocaleString('en-GB', …)`
with **no `timeZone` option**, so Node formats in `process.env.TZ` — UTC in the
deployed image. The canonical implementation exists and is correct
(`components/workspace/gridCells.tsx:104-106` threads the zone through), which
is why the project rule says every configurable list gets it from
`ConfigurableGrid`.

A call started 02:30 Dubai shows as 11 Nov in the list and 10 Nov 22:30 on its
own page. On the audit log it is worse: the page is documented to narrow to a
range of the **workspace's** days, so between 00:00 and 04:00 Dubai the stamp on
the row and the filter that returned it name different days.

**Checked and not a bug:** the HR pages' `date()` helpers pass
`{ timeZone: 'UTC' }`, which is correct for date-only columns stored as UTC
midnight.

### F-35 · `canTransition()` in 8 files is *not* duplication
**Confidence: confirmed.** Each is a one-line lookup into its own `ALLOWED` map
over a different enum — `ReferralStatus`, `TestimonialStatus`, `ContestStatus`,
`MandateStatus`, `UnitStatus`, `CommissionStatus`, `PayoutStatus`,
`VisitStatus`. Eight genuinely different state machines. Recorded here so nobody
"consolidates" them. The same applies to the six telephony provider methods,
which are an intentional interface.

---

## Possibly unused code

Each checked against dynamic routes, the queue job table and configuration.

| Candidate | Evidence | Verdict |
| --- | --- | --- |
| `coverageWindow` + the CRM monitoring ceilings, `lib/auth/platform-access.ts:80-88` | `openCoverage:343-384` takes no `kind` and writes none, so every row defaults to `OPERATIONAL`; the only `CRM_MONITORING` rows in existence are written by `tests/security/platform-crm-monitoring.spec.ts` | **Unreachable in production**, by design pending one edit. `changes/PROJECT.md:462` says so. Keep; it is the other half of a planned change |
| `Lead.searchVector` | Present in the baseline migration; never read or written anywhere in `src/` | **Dead column.** Likely an abandoned full-text approach — see F-22 for what to do instead |
| `MODULE_OF` entries for CONTACT / ACCOUNT / OPPORTUNITY, `lib/security/fieldSecurity.ts:37-42` | No sensitive-field map and no `FieldPermission` writer exists for those types | **Dead until F-12 is fixed.** Keep and implement, or remove the permission that pretends to work |
| `/api/v1/platform/monitoring/grants` | No caller in `src/app` or `src/components`; only tests | **Live endpoint, no UI.** Not unused — it is reachable and tested. `changes/PROJECT.md:42` wrongly lists it as a console screen |
| `Branch` CRUD | `Branch:1065` has no CRUD route | **Not unused** — rows are read by scope resolution (`lib/security/visibility.ts:124`) and P&L. Seeded, not managed |
| `src/workers/index.ts` | My own static scan found no importer | **False positive.** It is the worker process entrypoint, selected by `PROCESS_ROLE`. Recorded to show why a no-caller result is not a verdict |

---

## Documentation defects

### F-36 · `changes/PROJECT.md` has merge corruption
**Confidence: confirmed.** The project's own working memory contains five
duplicated or broken blocks:

| Line | Problem |
| --- | --- |
| `:310` and `:329` | **`Attendance is not HR.`** appears twice with *different* content — a reader gets two partial versions of one rule |
| `:317` | An orphaned sentence fragment starting mid-clause after "oneself." |
| `:450` and `:452` | **`Real AI and telephony`** twice, with different trailing content |
| `:453` and `:461` | **`Store submissions`** twice; `:461` is a superset |
| `:220` and `:222` | The `10-second Undo` line twice |

Neither "Attendance is not HR" block is wholly right. What the code does is in
[`MODULE-INVENTORY.md`](MODULE-INVENTORY.md) — four enforcement points, each
with its own exemption list.

### F-37 · `docs/product/CURRENT-CODE-MAP.md` is stale, and one of its findings is fixed
**Confidence: confirmed.** It is pinned to commit `f16ed677` on another branch,
last touched 13 Oct, and states "None has been fixed." Re-checked at this commit:

- **`:40`** (HR report visibility authorises with `can()` and so ignores granted
  scope) — **partly still true, consequence closed.** The `can()` call remains
  (`services/hr/reports.ts:987`), so the literal sentence holds. But
  `resolveWithAudience` (`:1014-1017`) now narrows below ORGANIZATION via
  `audienceFor` (`:122-146`), attendance reports delegate to `attendanceScope`,
  the narrowing is spread with `AND` so a report's own filter cannot displace it,
  and a workspace-subject report is refused outright below ORGANIZATION. The
  observed failure it cites — an OWN-scope employee exporting nine payslips —
  cannot recur.
- **`:45`** (payroll approval gate requires `employee:VIEW`) — **fixed.** That
  route is now `selfService: true` with a comment naming this exact defect and
  role, and the gate is per-action; `payroll-run-decide` maps to
  `['payroll','APPROVE']`. Regression-tested at
  `tests/security/hr-action-authority.spec.ts:132`.

**Next step:** add a header to that document pointing here, or re-date it.

### F-38 · Test connection is only honest on the Google branch
**Confidence: confirmed.** `changes/2026-11-05-gemini-connection-proves-tool-calling.md`
records the fix: Test connection used to list models only, so it was green while
the assistant was dead. The fix sends the real 16 tool declarations through
`generateWithTools` — **but only for Google** (`lib/integrations/verify.ts:184-194`).
The OpenRouter branch returns `ok: true` straight after a `GET /api/v1/key`
credits check (`:142`) and never sends a tool declaration. The same defect
class, on the branch nobody re-checked.

**Next step:** send a tool declaration on the OpenRouter branch too.

### F-39 · ONE AI has no model fallback
**Confidence: confirmed.** `runCascade`/`modelCascade` callers are
`lib/ai/analysis.ts:185`, `audit.ts:106` and `generate.ts:122`. The assistant is
not among them — `service.ts:178` resolves one model and uses it for every
round. A transient 429 or 5xx on the primary model fails the question outright,
where call analysis retries and falls back. Nothing documents this as
deliberate.

**Next step:** decide whether it is intended; if not, route the assistant
through `runCascade`.

---

## What could not be analysed

- **Nothing was executed.** No build, typecheck, test run, `EXPLAIN` plan,
  bundle size or connection measurement. Every performance figure is counted
  from code, never observed.
- **The 128 `.sql` migration files are not in the knowledge graph** — parsing
  them needs an optional `tree_sitter_sql` extra that was deliberately not
  installed. Index claims come from `prisma/schema.prisma` plus targeted
  greps, so an index created in a migration under a name not grepped for could
  exist.
- **Graph integrity caveat:** 72 dangling-endpoint and 1,611 collapsed directed
  edges, mostly YAML `contains` relations from `ci.yml`. File-level dependency
  conclusions hold; symbol-level counts are approximate.
- **Unaudited subsystems:** prompt-injection handling and tool-recursion limits
  beyond `assistant/tools.ts`; recruitment, performance, compliance and
  documents under `services/hr/`; the platform console routes behind
  `requirePlatformOwner`; `lib/security/outboundUrl.ts` (SSRF allowlisting); the
  public share-token paths; dependency CVE state; CSS, fonts, images and
  `apps/mobile` internals.
- **Known and excluded:** the production CSP keeps `script-src 'unsafe-inline'`,
  already recorded in `docs/KNOWN-LIMITATIONS.md`, so it is not re-filed here.
