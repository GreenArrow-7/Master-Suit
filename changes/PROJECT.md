# YOUHAN ONE — project state

Updated 2026-10-11. Production runs `main` at f9c0c1a, released 11 Oct, with
101 migrations; `main` is ahead of production where the index says so.

## The product

Multi-tenant SaaS for UAE real-estate brokerages and sales teams: one platform,
and product modules a workspace is entitled to (`src/lib/modules/catalogue.ts`).
Paths below are under `apps/web/`.

| Module | Folder under `src/app/(workspace)/[workspaceSlug]/` | Screens | Covers |
|---|---|---|---|
| Sales | `sales/` | 76 | leads (spreadsheet import with a dry run, close-out, merge), contacts, accounts, opportunities, tasks, follow-ups; calls with AI coaching, analysis and audits; campaigns, inbox, forms, landing pages, social leads; dashboards, leadership (productivity, value, daily target); projects, listings, bookings, collections, commissions, proposals, portals |
| HRMS | `people/` | 32 | employees, users, roles, departments; face check-in, attendance, shifts, roster, leave, overtime; payroll, payslips, WPS; recruitment, performance, documents, compliance |
| Real Estate | `realty/` | 42 | the Sales property screens as a brokerage works them, plus Properties, allocation (data pool), events with QR passes, lead recycling, website forms and landing pages |
| Lead Eagle | `lead-eagle/` | 32 | the lead-management product: Real Estate's lead screens without the money and marketing ones — dashboard, leads (a grid or a board by stage, filter chips, each person's saved views), follow-ups (by due day and by kind: call, meeting, site visit, other), tasks, calendar, calls, site visits, requirements, allocation, properties, projects, listings, reports (shared with Sales and Real Estate: projects, site visits and calls among them; Activity Log, Follow-up Adherence, Site Visits and Call Report regroup by user, month, project or lead with `?by=`; a role with `reports:VIEW` and `reports:EXPORT` has any report emailed daily, weekly or monthly as a CSV, run as them by the maintenance sweep while the workspace is live, to members who may see that report only (for Rep Activity, Call Performance and Call Report, also all the calls the creator sees), without the view's person, team, source and project filters; Call Report and Call Performance read calls under the calls scope, and a project filter on Site Visits and Projects reads the visit's and booking's own project; `services/leadership/reports.ts`, `reportSchedules.ts`), and Automation (Sales' page, re-exported; every lead module authors rules: on a lead created or updated, or some hours after it arrives and optionally only if nobody contacted it, then create a task, notify the owner or the owner's manager, tag, assign — a named person or the next in turn —, send an email or WhatsApp template, or call a signed webhook carrying only records its author may see). Automatic assignment (Allocation → Automatic assignment) takes rules with conditions (source, city, project, language — a lead tagged with one goes only to people who speak it) and uneven shares (`weights`, turns per round); each person's daily quota, languages, availability and who they report to are set under Admin → Users → the account → Lead work, and a person switches their own availability on My role & access. A project's page records its payment plans and enters unit plans and units by floor range; a project or listing takes a photo, floor plan, brochure or creative uploaded from its page; a new project or listing names its developer, community and amenities by typing them; the catalogue and the listing book page past 50 rows and keep each person's saved views, the catalogue's filters show their counts; a listing's page sets its status and its Trakheesi permit (Active with no portal publication is a pocket listing: it matches and shares), and Administration → Company stores the brokerage's ORN. Leads arrive from Property Finder, Bayut, Dubizzle, Google Ads lead forms, any other sender through a signed Custom webhook, and the portals’ lead emails through Portal emails, posted by a mail service the workspace runs (Admin → Integrations → Lead sources; any lead module), each with a Deliveries tab (outcome, Replay) and a field mapping (`/admin/lead-sources/{source}`), and a lead can be recorded as a Referral with its referrer. A WhatsApp message from a number no lead, contact or user holds, and a call from such a number, become leads for distribution (switches on the WhatsApp Business and telephony cards: on by default in Lead Eagle, and for callers in every lead module). With a Google Calendar connected (Admin → Integrations → Google Workspace → Connect with Google), a lead module's meetings go onto it with their owner as a guest — follow-ups of kind meeting or site visit (every follow-up with the card's switch), appointment-type tasks and site visits — and move, read Done or come off as they change, queued after the write on the `calendar` queue so Google never holds it up; what runs out of retries is re-driven by the quarter-hourly `calendar-sync-retry` sweep, and a leaver's hand-over re-syncs their meetings (`src/services/integrations/googleCalendar.ts`). Every lead module also has the Calendar, QR Capture, Cold Data, Targets, the objection Playbook (cards the live call's coach cites, "Your playbook"; written only with `calls` at ORGANIZATION), website forms and landing pages (public `/f/{ws}/{key}` and `/l/{ws}/{slug}`; `/embed.js` frames a form on the brokerage's own site), and Lead Stages, Sources (the source and sub-source catalogue, each entry's starting score, and the score decay) and Custom Fields (with the Add lead form's order and hidden fields; a required field is asked of a person creating a lead, not of an API key) under Administration → Settings; and on the lead page a requirement, interest links to projects and listings, and the workspace's custom fields. Every lead-list row and the lead page log a call in one step (outcome, note, the next follow-up); the lead page has a paged timeline, headed by the lead's calls, connected calls and talk time, of activity, stage moves, field edits, assignments, calls and messages, its done follow-ups, and the stock its requirement matches (live listings, and available units of the developer projects it fits, in the communities its typed areas name); the lead grid filters by a project of interest; each call there opens its call page (_Play recording_ once the recording is in our storage and its consent stands). The Calls list narrows to one lead (`?lead=`, the timeline's _All calls_) and lists the _Recorded_ calls; a provider call that ends answered (where the vendor reports talk time, with talk) counts as connected with nobody logging it, its talk time kept (`Call.talkSecs`); an inbound call missed rings the lead's owner (a new caller's lead: the agent distribution picks); a telephony connection's tracking numbers give a new caller's lead the Sources entry its number is tagged with; Reports has Call Performance per agent (`changes/2026-10-18-le-calls.md`). Two leads merge into one from a compare screen (`/leads/{id}/merge?with={other}`, from the lead page's duplicate notice or Merge with two selected); the merged-away lead's page names the lead it went into. The spreadsheet import can update the leads it matches, be checked first without saving (a dry run) and hand back its refused rows as a CSV. The board (Real Estate's, re-exported) counts, under the viewer's scope and on the workspace's clock, new, unassigned and untouched leads, overdue and due follow-ups and today's callbacks, leads in the meeting stages, conversion, leads by source and by stage, received against worked over 14 days, the week's follow-ups, the last 7 days' calls and an agent leaderboard; each tile, bar, day, Calls figure and leaderboard cell opens the list of what it counted (the Calls list with the logged calls beside the provider's, Tasks, Site visits). Filters at the top (a period, a person or team, a source, a project) narrow every figure and its list (on the Real Estate board the booking and revenue figures narrow, but their tiles open the unfiltered Collections), are kept in the URL and remembered per user (`User.uiPreferences`); a person or team outside the viewer's reach is ignored. From the lead page a role holding `communications:CREATE` (in a new Lead Eagle workspace every starter role but the Viewer; in an existing one, once its administrator grants it) sends an approved WhatsApp template or an email template (Administration → Settings → Email Templates), and a role that works the lead shares a listing or project as a public page (`/s/{token}`), from the lead page or with Share with a lead on the listing's or project's page, the share and each opening on the lead's timeline; the lead grid's Send template queues one to many leads, and a call's WhatsApp follow-up starts or reopens the lead's thread with a template where no free-form message can go. Reports (Sales' page, re-exported) read the board's filters (a period, a person or team, a source, a project) on the workspace's clock and hand the same query to their CSV; a Lead-Eagle-only workspace is not offered Revenue Forecast, Team Performance or Campaign Performance (404 by URL); its Pipeline Summary has no opportunity columns, its Source to Booking and Projects no booking columns and its Lead conversion no opportunity or booking steps. |

Outside the modules: `check-in` and `attendance` (every workspace), `admin/`
(users, roles, work locations, settings, data retention, audit), `profile/`, and the platform
console in `src/app/(platform)/platform` (workspaces, plans, subscriptions, AI
Control Center, monitoring grants).

Also in the repo: `apps/mobile` (iOS and Android WebView shells — a web change
never needs a new store build), `apps/face` (the face-recognition service,
Python), `apps/web/infra` (compose files, Dockerfile, Prometheus), `docs/`.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript, Prisma 7 on
Postgres with row-level security, Redis and BullMQ, zod, vitest, Playwright.
Node 22 or newer (CI uses 24).

## Rules every change follows

- **Tenancy.** Every query names its tenant; `src/lib/db.ts` refuses one that
  does not, and Postgres row-level security backs it. A read that must span
  tenants goes through `withPlatformTx`, nothing else. Inside `withTx`, query
  through its `tx` only: the global client there runs on another connection
  with no tenant set, where row-level security returns nothing — a permission
  or field rule read that way silently reads as "no rule". The same guard
  hides soft-deleted rows only of the model queried: an `include` of a model
  with `deletedAt` filters it itself. Outside `withTx` each query is its own
  transaction on its own pooled connection, and the pool holds 10, so a page
  reading many independent lists reads them in one
  `withTx(tenantId, (tx) => Promise.all([...]))`, or in rounds where a helper
  reads on the global client; one render asks for half the pool at most.
  `tests/sales/lead-page-connections.spec.ts` and `screen-connections.spec.ts`
  measure a screen's peak.
- **One record, several screens.** Real Estate reuses Sales' rows (`Lead`,
  `Call`, `SiteVisit`, `Booking`, `Project`, `Listing`, `UnitInventory`);
  `realty/` and `lead-eagle/` pages are one-line re-exports of `sales/` pages,
  and `tests/unit/realty-routes.spec.ts` and `lead-eagle-routes.spec.ts` guard
  that. Never add a parallel model.
- **Entitlement.** A page asserts its module with
  `resolveWorkspacePage(slug, { module, permission })` (`src/lib/workspace-page.ts`);
  an API route with `route({ productModule })` (`src/lib/api/handler.ts`).
  Shared screens assert a set: `LEAD_MODULES` (Sales, Real Estate, Lead Eagle)
  for lead work, `SALES_OR_REALTY` for money and marketing, `PRODUCT_MODULE_KEYS`
  for any module. A layout asserting a module covers everything beneath it, so a screen
  that must work without that module is re-exported from outside its folder.
  A module layout (`workspaceOwns`) shows `NotInPlan` for a module the plan
  lacks, never a silent redirect. `NotInPlan` sends the viewer to the same
  screen under a product the plan has (`sameScreenElsewhere`,
  `src/lib/nav/realtyShared.ts`), else names every product that carries it; the
  API's refusal names every module of the set ("Sales or Real Estate is not
  enabled for this company."). Next still renders the page beneath `NotInPlan`,
  so every page in a module folder asserts its module itself
  (`tests/permission/page-access.spec.ts`). A workspace whose only usable
  product is Lead Eagle opens on `/{slug}/lead-eagle/dashboard` after sign-in
  and from `/` (`workspaceLanding`, `src/lib/security/entitlements.ts`); every
  other workspace on its summary, `/{slug}/dashboard`. Lead Eagle has its own
  sign-in door, `/login?product=lead-eagle` (`LEAD_EAGLE_LOGIN`,
  `src/lib/security/redirect.ts`): the same form, endpoint, accounts and session
  under Lead Eagle's name (`AuthShell product="lead-eagle"`); a signed-out visit
  to a Lead Eagle screen, signing out of a Lead-Eagle-only workspace and
  self-serve sign-up go to it, with the workspace's board as `next` where it is
  known (the server lands an account in two workspaces on the oldest).
- **Permissions.** Roles live in the database. A new workspace gets one role,
  Company Admin, holding every permission; the admin builds the others in the
  role editor. Lead Eagle's arrival adds five editable starter roles (Manager,
  Team Lead, Agent, Telecaller, Viewer; `src/services/platform/provisioning.ts`);
  all but the Viewer may send to their leads (`communications:CREATE`), and
  the two that read numbers masked (Telecaller, Viewer) have no inbox.
  Scopes run OWN < TEAM < BRANCH < REGION < ORGANIZATION; check with
  `atLeast(ctx, module, action, scope)` (`src/lib/security/rbac.ts`). A record
  loaded by id is checked with `assertRecordInScope`
  (`src/lib/security/record-scope.ts`): out of scope answers 404, like a
  missing id. A lead's second owner (`secondaryOwnerId`) reaches it as its
  owner does: lead reads go through `leadScope` (placing a waiting lead from
  the Allocation queue excepted). A lead's requirement on its page and its
  interest links (projects, listings) are the lead's: written under
  `leads:EDIT` on its scope, an interest naming, and the lead page showing,
  only a project or listing the caller can see. HR's predicates are in `src/services/hr/access.ts`. A manager's authority over
  people stops at their reporting line (`reportingLine`, `src/services/hr/leave.ts`).
  TEAM scope covers a manager's whole line below them (`User.managerId`, every
  level: `managedUserIds`, `src/lib/auth/session.ts`) and their teams' members.
  A task is read under `tasks` wherever it shows, a lead's page included, and
  a follow-up under `leads` (`src/services/leads/nextFollowUp.ts`); a task is
  changed only where `tasks:VIEW` and `leads:EDIT` both reach its owner. The
  Follow-ups and Tasks lists and their APIs show everyone that scope covers, and
  the caller's own under Mine (`?view=mine`; `workListScope`); the Follow-ups list,
  its API, the boards, the Sales home and the assistant read `due` (overdue is
  before today began), `date` and `kind` (a follow-up is a CALL unless booked as
  something else) on the workspace's clock (`followUpDueWhere`,
  `src/lib/leads/followUpDue.ts`). A lead's first contact (a call placed or
  answered, an activity that is not a note) stamps `firstContactedAt`
  (`touchLead`); a lead its owner leaves uncontacted past its stage's minutes,
  counted from when they got it, tells their manager and is re-assigned when
  the rule says so, once per hand-over (`src/services/sla/checkLeadFirstContact.ts`:
  the delayed check at arrival and the five-minutely `first-contact` sweep,
  `Lead.slaEscalatedAt`). Cold data
  follows the same rule (`coldDataScope(ctx, action)`), and working a cold
  record logs a call on it (`Activity.dataRecordId`) that the daily target
  and the check-out gate count (`services/targets/dailyBoard.ts`); making it a
  lead moves those calls onto the lead. Targets (`api/v1/targets/**` but the
  Sales-only manual tally `targets/progress`, the Targets page under Sales,
  Real Estate and Lead Eagle) are every lead module's and follow the caller's
  `leads` scope; below ORGANIZATION nobody sets, changes or deletes their own
  (`targetReach`, `targetAssignees`). The daily board shows check-in times
  only under the viewer's `attendanceScope`. A
  record loaded by id outside the caller's scope answers 404, as a missing id
  does (`src/lib/security/record-scope.ts`). TEAM, BRANCH and REGION mean the
  caller's resolved owners (`resolveOwnerIds`), never the whole workspace, in a
  list and by id alike: every read of calls adds `callScope(ctx, action)` (a
  call is its caller's), every read of events `eventListScope(ctx, action)`
  (host or creator; an invitee reads), screens, counts and the assistant
  included. A call's or event's write checks it at the route's own action, and
  a page offers that write only where the same check passes.
  Whoever names a new owner for work (a task, follow-up, lead, cold record,
  capture link, social enquiry, an event's host or callers, a hand-over) is
  checked with `assertAssignableUser` / `assignableUserWhere`: an active
  member inside the caller's ASSIGN scope, 404 (or the route's own unknown-user
  answer) otherwise. A picker of people lists `assignableUsers`; a screen that
  also names people (who assigned or replied) keeps a separate list for that.
  The allocation queue's manual placement is the exception: only ORGANIZATION
  reaches a waiting lead, and its picker lists every active agent with their
  eligibility.
- **Uploads.** A file is refused on size before it is read (`readUpload`),
  recognised by its bytes, scanned (`assertClean(await scanBuffer(...))`),
  stored, then recorded; a failed row deletes the object. Project and listing
  media live under `inventory/t-{tenant}/` (`mediaPrefix`) and get their rows
  only from the upload routes (`src/services/inventory/media.ts`); the JSON
  media routes link a video or tour and take no key or type, and the file
  routes render only a recognised type (`mediaFileHeaders`), anything else as a
  download.
- **Identities.** A workspace path that attaches an existing platform identity
  (Add user, invite and accept, a new workspace) takes it through
  `assertIdentityReusable` and sets it ACTIVE with `activateIdentity`
  (`src/services/identity/accounts.ts`): a suspended, deactivated, deleted or
  erasing account answers 409, with one neutral message to a workspace
  administrator. A suspended or deactivated one comes back only through the
  platform console's reactivate, an erasing one when its owner withdraws the
  request, a deleted one never.
- **Sensitive fields.** A lead's phone numbers and email are masked for a role
  without `leads:VIEW_SENSITIVE_FIELDS` (`LEAD_SENSITIVE_FIELDS`,
  `src/services/leads/createLead.ts`). A screen or route that shows a lead or a
  number it holds serialises it through `applyFieldSecurity`, `asLeadPhone` or
  `maskCallNumbers` (a call's lead side), and builds `tel:` and `wa.me` links
  with `dialable()`, which refuses a mask. A message sent from the lead names
  the number by id, and its answer carries no address
  (`src/services/leads/leadMessages.ts`). A notification names the lead, not
  its number. Cold Data shows a record's number as stored to its own agent and
  as a lead's phone reads to the role otherwise. The lead timeline shows a
  field edit as the field reads to the viewer, a call only under
  `callScope`, and a message only where the inbox (`communications`)
  reaches its thread, for a role with no inbox the messages it sent
  (`src/services/leads/timeline.ts`).
  Still outside it: the
  campaign dialer, event invitees and the inbox
  (`changes/2026-10-11-lead-contact-masking.md`).
- **Pipeline stages.** A workspace's stages are its own (Admin → Lead Stages).
  A new one gets Lead Eagle's twelve when it has Lead Eagle, else New,
  Qualified, Won, Lost (`provisionLeadWork`); a pipeline is never reseeded. A
  stage's reason, fields and bookings are checked in `updateLead` (a lead
  created straight into a stage is not, yet): `visitAt` or `meetingAt` in its
  `requiredFields` books a site visit or a meeting task in the same
  transaction (`src/lib/leads/stageBookings.ts`); only a move books, so a
  booking sent with no move is refused 422. A screen that moves a lead opens
  the `StageReason` mini-form when `asksBeforeMove` says so: the lead page,
  the grid's bulk move and the board.
- **Lead lists.** The lead grid, its board and its CSV export read one URL
  (`leadListParams`) through one query (`leadListQuery`,
  `src/services/leads/leadList.ts`): scope, named filter, search, chips, the
  closed-out exclusion; the board's team, project and won-in-the-period
  (`date=won`) come through `boardWhere` (`src/lib/leads/boardFilter.ts`),
  which the board and the Follow-ups, Calls, Tasks and Site visits lists also
  read, so each figure and its list narrow alike; the reports read the same
  parameters (`reportParams`, `src/services/leadership/reports.ts`). Every lead search is `leadSearch`
  (`src/services/leads/createLead.ts`): a typed number is normalised and matched
  against the main number and every LeadPhone, whole numbers only for a role
  that sees them masked. A saved lead view is a personal `SmartView`
  (`objectType` `LEAD_LIST`). The grid pages by keyset (`leadPage`:
  Next carries `after`, Previous `before`, the boundary lead's id), as the list API
  does (`cursorWhere`, `src/lib/api/pagination.ts`); a keyset bounds its sort
  column so the index seeks to the page. Its bulk bar sends one request per
  selected lead, each re-checked in scope: assign, stage, task, Add tag
  (`addTags` on PATCH, added to the lead's own), close out, Move to Data
  (`moveLeadToData`, `src/services/leads/coldData.ts`: a cold record on the
  day's "From pipeline" list, the lead archived and its open follow-ups and
  tasks cancelled; `mayMoveToData` also asks for the lead's numbers in full) and Delete with a
  10-second Undo (`POST /api/v1/leads/{id}/restore`). Delete, restore and Move
  to Data are audited in the service, on `objectType` `lead`.
  10-second Undo (`POST /api/v1/leads/{id}/restore`).
- **Workspace clock.** A date or time formatted on the server reads in the
  workspace's zone (`workspaceTimezone`, `src/services/hr/attendance.ts`), and
  "today" is the workspace's day (`dayBounds`, `todayKey`,
  `src/services/targets/dailyBoard.ts`). Every configurable list gets this from
  `ConfigurableGrid`.
- **API kernel.** `route()` and `bareRoute()` in `src/lib/api/handler.ts`. Prisma
  P2002 answers 409 and P2025 404, a zod failure 422 — let the database say
  "already exists" or "not found" instead of reading first. `route()` honours
  `Idempotency-Key` on JSON POST and PATCH (24 h, `IdempotentRequest`, swept
  nightly); a route that answers with a credential declares `idempotent: false`
  (`selfService` routes are out already). `route()` keeps its spec on the
  handler; `GET /api/v1/openapi.json` serves the OpenAPI 3.1 document built from
  them (`src/lib/api/openapi.ts`), generated into `public/openapi.json` and kept
  equal to the routes by `tests/unit/openapi.spec.ts` — after changing a
  route's schemas (or adding a route), run it with `OPENAPI_WRITE=1`.
- **Audit.** The rule for new code: every write should leave an AuditLog row,
  through the route's `auditEvent`, or `audit(ctx, …)`
  (`src/lib/security/audit.ts`) where the route cannot say enough. A write no
  person makes (a webhook, a worker) calls `audit({ tenantId, source }, …)` and
  shows as System. A date or a list in a value is stored as one.
  `tests/unit/mutation-audit.spec.ts` gates it: every POST, PATCH, PUT and
  DELETE handler declares `auditEvent`, audits in its handler, or is listed
  there with the file that audits it or why nothing is recorded (a draft, the
  caller's own preferences); a new mutation route fails until it says which.
  A named file is checked against what the handler calls from it: one of those
  functions audits, and none writes a record without auditing. A
  file out of the building needs EXPORT, not VIEW, and writes `EXPORT_REQUESTED`; a scheduled report email
  is one too, re-checked at every send. The Audit Log pages by
  keyset (`before=<ISO>|<id>`, across both logs) and narrows to a range of the
  workspace's days.
- **Offline.** The phone app is a web view of the site, so its outbox is the
  site's (`src/lib/offline.ts`, the notice in `OfflineBanner`): a change made
  with no connection waits on the device and is sent when it returns, each with
  its own `Idempotency-Key`, so a repeated send is replayed, not doubled. Sends
  run one at a time (in the page, and across tabs by a Web Lock). Each change
  carries its owner (`tenantId:userId`, the frame's `data-outbox-owner`) and is
  only sent from a screen of that workspace and person; signing out
  (`lib/auth/signOut.ts`) sends what it can and forgets the rest. The
  lead page, the call log (list and lead page), the Follow-ups list (complete,
  reschedule, cancel, reopen, a new follow-up) and Cold Data's call outcome go
  through it; a write whose answer the screen needs (opening what it created)
  still needs the connection.
- **Direction.** A workspace's language (`OrganizationSetting.defaultLocale`,
  Company profile) sets the shell's `dir`: Arabic lays it out right to left,
  the words still English. Stylesheets use logical properties
  (`margin-inline-start`, `inset-inline-end`, `text-align: start`), physical
  ones only where the side is the point (centring, a compass); new CSS follows.
- **Attendance is not HR.** Check-in, the attendance record, attendance
  requests and the attendance summary with its CSV (on the Attendance screen;
  `EVERY_WORKSPACE_REPORT`, `src/services/hr/reports.ts`) work in every
  workspace; everything else in HR needs HRMS. Every attendance read, the
  attendance reports included, covers whom `attendanceScope` covers: everyone
  for an organisation-wide reader, a line manager's reporting line, else
  oneself.
  requests and Face Activity (refused and flagged punches,
  `/{slug}/attendance/face-activity`) work in every workspace, as do work
  locations and the check-in and check-out rules (`CHECKOUT_RULE_KEYS`);
  everything else in HR needs HRMS. A location with people actively assigned
  is not retired (409). The check-in screen shows today's calling target and
  the leads called towards it (`dailyTargetProgress`). Automatic assignment,
  on a rule that respects working hours, passes over someone checked out for
  the day, outside today's roster entry or, without one, their standing shift
  (`HrEmployeeShift`; an overnight shift counts on the day it starts), or not
  checked in since midnight on the workspace's clock once its cut-off
  (`assignmentCheckInBy`; changing it needs `distribution:MANAGE_CONFIGURATION`
  at ORGANIZATION) has passed (`src/services/distribution/eligibility.ts`).
- **Attendance is not HR.** Check-in, the attendance record and attendance
  requests work in every workspace, and so do work locations and the holiday
  register (Administration → Work Locations, → Holidays); everything else in HR
  needs HRMS. Automatic assignment passes over everyone on a confirmed holiday
  where its rule respects working hours (`services/distribution/eligibility.ts`).
- **Lead scores** move by event, each a LeadScoreHistory row and an audit row
  (`src/services/leads/scoring.ts`): a new lead starts at its source's
  `weight`, a logged activity adds its type's `scoreDelta` (taken back if the
  activity is deleted), and the nightly `lead-score-decay` job applies the
  workspace's first DECAY `ScoringRule` (off unless set). Each move locks the
  lead's row. The post-call AI temperature still sets the score outright.
- **Background jobs.** One `JOBS` table in `src/workers/jobs.ts`, keyed by queue;
  `src/workers/index.ts` starts a worker per queue. CI's observability gate reads
  that table, so keep it a literal.
- **Notifications.** Every notice is a bell row; its phone and email copies
  follow the recipient's `User.notificationPrefs` (`readPrefs`,
  `src/workers/notifications.ts`): a push unless turned off, an email per
  notice, or one summary each morning at 08:00 on the workspace's clock
  (`src/services/notifications/digest.ts`, the hourly maintenance job
  `digest`; workspaces with a lead product only, naming only leads the reader
  may open). Hand-overs tell the new owner: automatic assignment, a lead
  created or converted (intake, social enquiry) for someone, and the SLA
  take-back through `notifyCrm` `lead.assigned` after the commit; bulk assign,
  Allocate, cross-team routing and the leaver hand-over through
  `notifyLeadMoves` inside the move's transaction (the previous owner too), then
  one push per receiving person (`ringNewOwner`), not one per lead. A merge
  tells nobody. Reminders ring the owner 10–15 minutes before a follow-up,
  call follow-up or site visit is due (`src/services/crm/reminders.ts`, 15
  minutes ahead; swept every five minutes on the `reminders` queue, apart from
  the maintenance worker's long jobs), once each.

## Testing and verifying

From `apps/web`:

| What | Command |
|---|---|
| Unit and integration (needs Postgres and Redis) | `npx vitest run [files]` |
| Specs that drive a running server | `npm run test:server` |
| Measurements, never CI: `tests/perf`, against a scratch database | `PERF_100K=yes npx vitest run --config vitest.perf.mts -t seed` (then `-t timing`, `-t sql`, `-t cleanup`) |
| Browser | `npx playwright test`; the demo-workspace specs need `E2E_DEMO_SLUG`, `E2E_DEMO_EMAIL`, `E2E_DEMO_PASSWORD` |
| Types, lint, format | `npx tsc --noEmit`, `npm run lint`, `npm run format:check` |
| Production build | `npx next build`, with `NODE_ENV` unset — `development` breaks prerendering |

CI (`.github/workflows/ci.yml`, one `verify` job) also gates the permission
catalogue, schema drift, tenant isolation, raw-SQL scope, observability drift,
Redis auth, the face token check, the backup round trip, the build and
`npm audit`, and fails on any skipped test. Browser tests run only on PRs to
`main` and on pushes to `main`.

House rules: one finding per commit; a behaviour fix comes with a test that
fails on the old code; a UI change is checked in a browser at phone and desktop
width.

## Releasing

1. Merge to `main` and wait for its CI.
2. Build the images: `gh workflow run build-images.yml -f sha=<full sha>`.
3. The owner runs the release: staging first, then the staging-first migration
   gate, backup and restore drill, production and the smoke test; it stops at
   the first failure. Claude cannot SSH to production, and merging is the
   owner's too unless allowed in Claude Code's settings.

## Requirements and status

The owner's list of 19 Sep (§1–§19: UI, roles, face check-in and check-out,
productivity, work-gated check-out, lead import, delete rights, live AI call
guidance, calls, call audit, measured value, tokenomics, narrative, guardrails,
success metrics, AI evaluation, budgets, model fallback) was accepted on 19 Sep
with named tests: `apps/web/docs/ACCEPTANCE-2026-09-19.md`. Built since: the
daily lead target, the app-wide redesign, the AI Control Center, CRM monitoring,
the Real Estate module, proposals and portals, attendance in every workspace.

Waiting on the owner:

- **Data retention windows** (M18-11) — built: a workspace keeps the audit log,
  attendance punches and AI events longer than the deployment under
  Administration → Settings → Data Retention, never shorter. The deployment's
  `AUDIT_LOG_RETENTION_DAYS`, `ATTENDANCE_PUNCH_RETENTION_DAYS` and
  `AI_EVENT_RETENTION_DAYS` are still empty by default (keep everything); the
  owner's windows (2555, 730, 365 days) take effect only when the operator sets
  them on staging and production. Leads have no window
  (`changes/2026-10-18-data-retention.md`).
- **Database pool size** — the pg adapter ignores `connection_limit` in
  `DATABASE_URL`, so every process holds 10 connections; `max` on `PrismaPg`
  (`src/lib/db.ts`) is an operations decision
  (`changes/2026-10-13-fanout-audit-clock-ui.md`).
- **Lead Eagle inside YOUHAN ONE** — every phase of the plan
  (`changes/2026-10-05-lead-eagle-plan.md`) is live: phase 1 since f89ae61,
  phases 2–6 since c46624f (8 Oct, #134 + #139). What waits on the owner:
  partner credentials for the portals and Google Ads (or, until then, an
  inbound-mail service and a small relay posting their lead emails, signed, to
  a Portal emails source), opening
  sign-up, and a real standalone database for the move tool, if one exists.
  "An application, not a feature" (PROD-13) is built as its own sign-in door
  and the sidebar's Lead Eagle section; its own mark, a domain or a store
  listing would each be a further owner choice
  (`changes/2026-10-18-le-signin-branding.md`).
- **Self-serve sign-up** — built and closed: the platform owner decides whether
  to open it (console → Settings → Self-serve sign-up, trial days).
  Phase 2 is built: Google Ads lead forms work once connected; Property Finder,
  Bayut and Dubizzle deliver only to approved partners, so each needs its
  partner agreement and its signing secret. The standalone Lead Eagle has no
  deployment and no remote; its local database holds test and seed workspaces
  only (7 Oct). Phase 5's tool (`scripts/move-lead-eagle.ts`, dry run by
  default) moved the seed company on the rig; it runs for a real company when
  a copy of its database exists. It carries a unit's type and bedrooms (as a
  unit plan of its project) and payment plans; media stays behind, reported
  (its files are in the standalone's bucket).
- **Google Calendar** — a Google Cloud OAuth client (Calendar API, redirect `{APP_URL}/api/v1/integrations/google/callback`) in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and Google's verification of the `calendar.events` scope before customers outside the owner's Google Workspace connect; until then the card reads not configured (`changes/2026-10-18-le-google-calendar.md`).
- **Real AI and telephony** — a Gemini API key; a Twilio account with Media Streams, and one real call round trip on staging; whether to build handset call detection, which Google Play allows only for the default dialler (`changes/2026-10-18-le-calls.md`).
- **Store submissions** — iOS and Android, in the owner's store consoles.
- **Read-only CRM monitoring of every workspace** — built (v1.4.0), but nobody
  can be granted it until `openCoverage` takes a `kind`; that edit needs the
  owner's permission.
- **Product questions** — `docs/product/DECISIONS-REQUIRED.md`: 17 with no
  recorded answer; the file was last updated 12 Sep.
