# Report CSVs needed only VIEW and left no trace; machine writes to leads left no audit row

**What.** A report's CSV (`GET /api/v1/reports?format=csv`) needs
`reports:EXPORT` as well as VIEW, and writes an `EXPORT_REQUESTED` audit row
naming the report and its date range. The reports screen shows Export CSV only
to a role that may use it. The writes no person makes now leave an AuditLog
row with no actor (the Audit Log shows "System") and the machine in
`metadata.source`: a lead created or enquired on again by a portal, Google Ads,
a QR capture or a Meta Lead Ads form, an automatic assignment, a lead the
recycling sweep returns to the pool, and a first-contact SLA breach. Two
Lead Eagle write routes that recorded nothing now do: a document upload and the
end of a live-microphone call. **One migration (99 in all):**
`20261011000000_reports_export_grant`.

**Why.** The Lead Eagle gap audit of 11 Oct, rows M2-07 and M2-08. Several
reports carry lead names row by row, yet any role that could see reports could
download them, unrecorded; every other export already asked for EXPORT and
wrote `EXPORT_REQUESTED` (`docs/EXPORTS.md`). Intake, assignment and the SLA
clock wrote history rows only, so the Audit Log could not show how a lead came
to exist or to whom it went.

**Where.**

- `lib/security/audit.ts`: `audit()` takes a `SystemActor` (`{ tenantId, source }`)
  as well as a `Ctx`; its row has `actorType` SYSTEM and no actor, IP or request.
- `api/v1/reports/route.ts`: EXPORT asserted before the report runs when
  `format=csv`; the audit row after it. `sales/reports/page.tsx`: the button.
- `prisma/migrations/20261011000000_reports_export_grant`: every role holding
  `reports:VIEW` gets `reports:EXPORT` at the same scope, as listings took
  VIEW_SENSITIVE_FIELDS from leads in 20260808220000.
- `services/leads/intake.ts` (`takeEnquiry`, shared by the portal and Google Ads
  worker, QR capture and cold data): RECORD_CREATED, or RECORD_UPDATED
  `lead.enquired_again`, in the lead's transaction; as the system with
  `sourceDetail` as source, or as the person when the caller passes `actor`.
- `api/v1/cold-data/[id]/convert/route.ts`: passes `actor`; its kernel
  `auditEvent` (object `leads`, no record id) is gone, so one row, naming the lead.
- `services/meta/applyEvent.ts` (`applyLeadgen`, the Meta webhook worker): the
  same two rows, source `facebook:<form id>`, each in the write's transaction.
  No product module gates this path (route, worker or the Integrations screen),
  so a Lead-Eagle-only workspace can receive Lead Ads leads.
- `services/distribution/assignLead.ts`: OWNER_CHANGED on `ownerId`, source
  `distribution`, with the rule's name, in the assignment's transaction.
- `services/leads/recycle.ts`: OWNER_CHANGED to null, source `recycle`, with the
  threshold, per lead, in the sweep's transaction.
- `services/sla/checkLeadFirstContact.ts`: RECORD_UPDATED on `slaState`, source
  `sla`. The breach and its row commit together, and only the update that moved
  the state writes the row, so a retry after a failed insert still records it
  and a duplicate job does not record it twice.
- `admin/audit/page.tsx`: a field-change row also shows what it recorded beside
  the change (`source`, the distribution rule), so every System row names its
  machine on screen.
- `api/v1/documents/route.ts`: RECORD_CREATED on `documents` with the lead and
  the scan verdict, rejected uploads included.
- `api/v1/calls/[id]/live-audio/route.ts`: CALL_COMPLETED on finalise, as the
  call's PATCH records it. Not per chunk; the start was recorded when the call
  was logged.

**Behaviour.** No role loses the report download at release: the migration
grants EXPORT to every role that holds VIEW, and an administrator can withdraw
it in the role editor. A role made afterwards with VIEW only sees the report
without the button and gets 403 on the file. Each download adds an Export
Requested row (object Report). The report as JSON (`format=json`, the screen's
own data) still needs only VIEW and is not audited, for a person or an API key.
The Audit Log gains System rows for portal, ad, Meta Lead Ads and QR leads,
repeat enquiries, automatic assignments, recycled leads and SLA breaches, and
person rows for document uploads and live-microphone calls ending. A cold-data
"Make lead" row now names the lead. Field-change rows show their source and rule
after the change.

**Verified.** `tests/sales/lead-eagle-reports.spec.ts` (3 new cases: VIEW-only
403 on the file, 200 on JSON, no button; an EXPORT role's download writes one
row with the report, range and row count; the migration, run as written on this
spec's workspace, grants EXPORT at TEAM and ORGANIZATION as held, and nothing to
a role without VIEW). `tests/sales/lead-audit-trail.spec.ts` (6 new: a signed
Property Finder delivery worked by the registered job, then `assign-lead`,
leaves RECORD_CREATED and OWNER_CHANGED rows by SYSTEM, and the Audit Log page
rendered for the admin shows both by "System" with the source; repeat enquiry;
SLA breach; cold data one row as the person; document upload; live-mic
finalise). On the old code all 9 fail: 8 on their assertions, the migration case
on the missing file; the button case alone fails on "Export CSV" with only the
old page restored. Review follow-up: the Meta Lead Ads case (created, then the
same person again), the SLA retry case (the audit insert fails once: the breach
is rolled back, and the retry records one row), the recycle row
(`tests/tenant/lead-recycle.spec.ts`) and the System OWNER_CHANGED row showing
`source=distribution` on the page all fail on the code before it. Pins that pass
either side: the SLA check run twice writes one row; a rejected (INFECTED)
upload answers 422 and is audited; the migration leaves a wider EXPORT and a
refused one alone (an overwriting `ON CONFLICT DO UPDATE` fails it). Also
green after the follow-up: `tests/sales` (632 in 47 files), `tests/permission`
and `tests/unit` (1,510, 2 POSIX-only skips on Windows), `tests/security` with
`tests/tenant/lead-recycle.spec.ts` (665 in 53); before it, `tests/hr` and
`tests/identity` (492) and `tests/tenant/audit-retention.spec.ts`; tsc, eslint,
prettier; the migration applied on the rig.

**Non-GET API handlers declaring no `auditEvent`** (77, from a scan of every
`route.ts`; `{}` marks a path segment):

- Lead Eagle, fixed here: POST `documents`, POST `calls/{id}/live-audio`.
  Lead writes now audited by the intake: POST `public/capture`, POST
  `webhooks/leads/{key}` (in the worker), POST `cold-data/{id}/convert`. Lead
  Ads leads now audited in the Meta worker: POST `webhooks/meta/{key}` (its
  WhatsApp and comment events write messages and social comments, not leads,
  and are left open below).
- Lead Eagle, audited in their service or route body: POST `leads/triage/{id}/assign`,
  PUT `calls/{id}/recording/media`.
- Lead Eagle, write nothing (drafts and hints): POST `calls/{id}/coach`,
  `calls/{id}/follow-up-email`, `calls/{id}/follow-up-whatsapp`, `social-leads/{id}/draft`.
- Personal state, not audited on purpose: POST `projects/{id}/favourite`, PATCH
  `notifications`, POST `devices`, POST `devices/unregister`.
- Every workspace, dispatching to services that call `audit()` (not checked
  action by action): POST/DELETE
  `workspaces/{slug}/identity/{action}`, POST `identity/self/{action}`,
  `roles/{action}`, `hr/self/{action}`, `hr/actions/{action}`; POST `hr/documents/upload` (HRMS).
- Telephony, which no workspace has connected yet: POST `webhooks/telephony`,
  `webhooks/telephony/{key}`, `webhooks/telephony/{key}/answer`.
- Sales, or Sales and Real Estate: POST `assistant`, `campaigns/{id}/members`,
  `campaigns/{id}/qualifications`, `campaigns/{id}/talking-points`,
  `practice/{id}`, `practice/transcribe`, `targets/progress`,
  `collections/receipts/evidence`, `events/{id}/invitees`, `events/{id}/rsvp`;
  DELETE `targets/{id}`; PATCH `listings/{id}/portals`, `portals`.
- Anonymous: POST `public/forms`, `public/proposal`, `public/rsvp`,
  `public/signup`, `public/signup/confirm`, `public/testimonial`.
- Sign-in and the platform console (most write the platform trail): POST
  `auth/accept-invite`, `auth/enroll-2fa`, `auth/forgot-password`,
  `auth/login`, `auth/logout`, `auth/logout-all`, `auth/refresh`,
  `auth/reset-password`, `auth/workspaces`; POST/PATCH/DELETE
  `auth/service-login`; POST/DELETE `platform/ai`; POST `platform/credentials`,
  `platform/plans`, `platform/users/{id}/actions`, `platform/workspaces`; POST/DELETE
  `platform/monitoring/grants`, `platform/workspaces/{id}/access`,
  `platform/workspaces/{id}/enter`; PATCH `platform/settings`; PATCH/DELETE
  `platform/subscriptions/{id}`, `platform/users/{id}`, `platform/workspaces/{id}`;
  POST `admin/retention`.

**Left open.**

- Machine writers still without an AuditLog row: the telephony webhooks' call
  updates (no telephony is connected yet), public form leads (forms are created
  under Sales), Meta comments and messages (a social comment is created and
  auto-assigned with its own assignment history; messages are stored as
  conversations), and automation actions (`update_field`, `add_tag`,
  `create_task`). The engine runs an action as the automation's creator
  (`ctxForUser`), so whether its row names that person or System with the
  automation as source is the owner's call.
- The report as JSON needs only VIEW and is not audited, so a VIEW-only role
  (or API key) can still read the same rows the CSV gate guards, unrecorded.
  The brief asked only for the file; auditing JSON pulls by API key is the
  owner's call.
- The report CSV still answers an API key that holds `reports:EXPORT`; the two
  list exports are browser-only (`sessionOnly`). The route also serves JSON, so
  making the file session-only is a check in the handler, not the route flag.
- The grant migration keeps the file for every role that views reports today.
  A narrower option for the owner: grant only where the role also holds
  `leads:EXPORT` (the gate for downloading lead names and phones) or is the
  Company Administrator.
- On the Audit Log, an owner change still shows the user ids, not names.
- The demo seed's Sales Director, managers and reps hold `reports:VIEW` without
  EXPORT, so a freshly seeded workspace shows them no Export CSV button.
