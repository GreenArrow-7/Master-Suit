# Current code map

What exists today, traced through the whole path — navigation, page, API route,
service, Prisma model, permission, queue, audit, test — for the capabilities the
target product depends on.

**Phase 1, analysis only.** Nothing here changes behaviour. Statements are marked
by the strength of their evidence:

- **[S]** source evidence — read in this checkout, path and line cited.
- **[R]** runtime evidence — observed against a running build during the
  2026-09-10 baseline validation; see `validation-evidence/`.
- **[U]** unverified — not established by either; needs work before it is relied on.

A model or an endpoint alone does not prove a feature is usable. Where only one
layer exists, the row says so.

## Starting point

| Item                                       | Value                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                                     | `claude/master-suite-baseline-validation-7c75ce`                                                                                                                |
| Commit                                     | `f16ed677516fb07f31832a5d725e13efb477c34d`                                                                                                                      |
| Relationship to the reviewed commit        | **identical** — `git rev-list --count f16ed67..HEAD` = 0                                                                                                        |
| `origin/main`                              | same SHA; upstream has not moved                                                                                                                                |
| Relevant changes since the reviewed commit | **none**                                                                                                                                                        |
| Working tree                               | clean of tracked modifications; untracked: `apps/web/tests/diagnostic/`, `apps/web/vitest.diagnostic.mts`, `validation-evidence/`, and two gitignored env files |

Existing validation evidence: `validation-evidence/BASELINE-VALIDATION-REPORT.md`
plus per-gate logs, diagnostics, role-walkthrough JSON and screenshots.

### Status of the previously identified concerns

Re-checked at this SHA rather than assumed. Because the commit is unchanged, every
source-level finding necessarily still stands; each was re-confirmed by direct
inspection.

| Concern                                       | Status   | Evidence                                                                                                                                                                                                     |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HR report visibility ignores granted scope    | **open** | `src/services/hr/reports.ts:805` still authorises with `can()`; `src/lib/security/rbac.ts:121-123` `can` = `scope !== 'NONE'` **[S]**; an OWN-scope employee exported 9 payslips for 9 employees **[R]**     |
| Booking confirmation does not touch inventory | **open** | `src/app/api/v1/bookings/route.ts` references the unit only as `unitInventoryId` (`:66`, `:96`) and `unit` in the select (`:33`) — never `status` **[S]**; two concurrent confirms both returned 200 **[R]** |
| Collection represented only by a timestamp    | **open** | `Booking.collectedAt` (`prisma/schema.prisma:6742`) is the whole representation; no Payment/Receipt/Invoice model exists **[S]**                                                                             |
| Allocation eligibility and concurrency        | **open** | `status: 'ACTIVE'` appears at `assignLead.ts:71`, inside `nextDistributionOwner()` (starts `:51`), **not** in `assignLead()` (`:11-36`) **[S]**; 4 leads delivered against a quota of 2 **[R]**              |
| Financial reporting (P&L)                     | **open** | `pl.ts:76` `status: { not: 'CANCELLED' }`; `pl.ts:227` no run-status filter; `pl.ts:236` current-team read **[S]**                                                                                           |
| Payroll approval access                       | **open** | `hr/actions/[action]/route.ts:286-290` outer gate `employee:VIEW`; `finance_admin` holds `payroll:APPROVE` but not `employee:VIEW` **[S/R]**                                                                 |
| Test isolation                                | **open** | `tests/server/session-lifecycle.spec.ts:18` and `unified-saas.spec.ts:20` still default to the `leadflow` database **[S]**                                                                                   |
| Dependencies                                  | **open** | `next` 16.2.12, `nodemailer` ^9.0.4, `sharp` ^0.35.0 — audit fails with 1 critical + 2 high **[S/R]**                                                                                                        |

**None has been fixed.** They are inputs to the backlog, not history.

## Relationship to existing documents

`docs/CAPABILITY-MATRIX.md`, `docs/FEATURE-INVENTORY.md`,
`docs/FEATURE_MATRIX.md` and `docs/FUNCTIONAL-PRESERVATION-MATRIX.md` answer a
different question — _does this capability exist_ — and were written against
earlier phases. This document answers _does this capability serve the target
workflow, end to end_. It does not restate them and does not supersede them;
where a claim here contradicts one of those, this one is the later evidence.

## Classification key

**RETAIN** fits the target workflow · **REPAIR** exists with a demonstrated defect ·
**CONNECT** exists but is not joined to the functionality it needs ·
**ADD** absent · **DEFER** useful later · **VERIFY** evidence insufficient.

---

## 1. Duplicate sources of truth

The single most important structural finding. **Four independent stores answer
"what must happen next", and no two agree.**

| #   | Store                | Model / field                                                             | Written by                                                                    | Read by                                                                                                                                   |
| --- | -------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tasks                | `Task` + `TaskType` (`schema.prisma:3662`, `:3643`)                       | `api/v1/tasks`, `services/automation/actions.ts`, `lib/ai/assistant/tools.ts` | `dashboard`, `sales/calendar`, `sales/dashboards`, `sales/tasks`, `tasks`                                                                 |
| 2   | Follow-up tasks      | `FollowUpTask` (`schema.prisma:5470`)                                     | `api/v1/follow-ups`, call detail page                                         | `dashboard`, `sales/calendar`, `sales/calls/[id]`, `sales/follow-ups`, `sales` overview                                                   |
| 3   | Lead next action     | `Lead.nextFollowUpAt` (`schema.prisma:3007`)                              | `api/v1/leads`                                                                | leads grid and detail, `sales/smart-views`, `services/leadership/rollups.ts`, lead export, `lib/api/filterTree.ts`, `lib/grid/columns.ts` |
| 4   | Activity next action | `Activity.followUpAt` / `Activity.nextAction` (`schema.prisma:3617-3618`) | `api/v1/calls/[id]`                                                           | `services/crm/reminders.ts`                                                                                                               |

**[S]** All four verified by grep across `src/`.

Three consequences, each independently demonstrable:

1. **Nothing reminds anyone about a `FollowUpTask`.** `services/crm/reminders.ts`
   sweeps `Task` (`:70-79`) and `Call` (`:113-122`). It does not read
   `FollowUpTask` — which is the store the agent's own overview and the
   `sales/follow-ups` page count. **[S]**
2. **"Overdue" means two different things on one page.**
   `sales/page.tsx` counts agent overdue from `followUpTask` (`:160`) and manager
   overdue from `lead.nextFollowUpAt` (`:388`). **[S]**
3. **The manager exception queue uses a third definition.**
   `rollups.ts:349 chasingQueue` is built from `Lead.nextFollowUpAt` and
   `slaState`, deliberately — its docstring argues a task-based queue cannot see a
   lead with no task at all. The reasoning is sound; the effect is that agent and
   manager work from different lists. **[S]**

Classification: **CONNECT** (choose one authoritative store and project the
others), not ADD. Building a fifth store would be the failure mode workflow C
explicitly warns against.

Other competing implementations found:

| Area                | Competing paths                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead assignment     | `services/distribution/allocation.ts` `allocate()` (bulk), `assignLead.ts` `assignLead()` (auto), `assignLead.ts` `nextDistributionOwner()` (social), `api/v1/leads/assign` (direct), `api/v1/social-leads/[id]/assign`. **Three different eligibility policies.** **[S]** |
| Customer identity   | `Lead` carries full contact identity _and_ enquiry state; `Contact` and `Account` exist separately; `Lead.convertedContactId` (`:3069`) and `Lead.accountId` link them. Which is the customer of record is not settled in code. **[S]**                                    |
| Site visit vs. task | `SiteVisit` (`schema.prisma:6538`) has its own lifecycle and does not appear in any task store. **[S]**                                                                                                                                                                    |

---

## 2. Capability map by workflow area

### A. Enquiry intake and customer identity

| Layer      | Path                                                                                                                                   | Notes   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Nav        | `lib/nav/workspaceNav.ts:100` Leads                                                                                                    | present |
| Pages      | `sales/leads`, `sales/leads/new`, `sales/leads/[id]`, `sales/forms`, `sales/landing-pages`, `sales/social-leads`                       | present |
| API        | `api/v1/leads`, `leads/import`, `leads/export`, `public/forms`, `forms`, `landing-pages`, `webhooks/meta/[key]`, `api/v1/referrals`    | present |
| Service    | `services/leads/createLead.ts`, `findDuplicates.ts`, `normalizePhone.ts`, `utm.ts`, `services/meta/applyEvent.ts`, `services/social/*` | present |
| Model      | `Lead` (`:2952`), `LeadStage` (`:2925`), `Contact` (`:3285`), `Account` (`:3232`), `FormSubmission`, `SocialComment`                   | present |
| Permission | `leads:CREATE` etc. via `lib/api/handler.ts` route kernel                                                                              | present |
| Events     | `createLead.ts:134` enqueues `distribution`, `sla`, `automation`                                                                       | present |
| Audit      | `createLead.ts:123-127` `RECORD_CREATED`                                                                                               | present |
| Tests      | `tests/sales/*`, `tests/e2e/crm-lifecycle.spec.ts`                                                                                     | present |

`Lead` already carries source attribution (`source`, `sourceDetail`, `subSource`,
`campaignId`), normalisation (`phoneNormalized`), consent (`consentStatus`,
`doNotCall`, four opt-out flags), duplicate links (`duplicateOfId`, `isMerged`)
and SLA fields. **[S]**

- **RETAIN** — intake channels, normalisation, source attribution, consent flags,
  duplicate detection service, stage history.
- **CONNECT** — customer identity. A returning customer with a second enquiry has
  no single identity row; `Lead` is both person and enquiry. Deciding the customer
  of record is a **DECISION** (see `DECISIONS-REQUIRED.md`).
- **VERIFY** — ambiguous-duplicate review UI: `findDuplicates.ts` exists and
  `onDuplicate: BLOCK|WARN|MERGE` is accepted by `api/v1/leads` (`:114`), but
  whether a human review queue surfaces WARN cases was not established. **[U]**

### B. Assignment and reassignment

| Path                                                                    | Eligibility enforced                                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/distribution/allocation.ts` `allocate()` (`:159`)             | quotas (daily/weekly/monthly/capacity) `:109-114`, `isAvailable` `:118`, `onLeaveUntil` `:119`, `deletedAt` `:48`, permission `allocation:APPROVE` `:161`. **Not** `User.status`. |
| `services/distribution/assignLead.ts` `assignLead()` (`:11-36`)         | **none**                                                                                                                                                                          |
| `services/distribution/assignLead.ts` `nextDistributionOwner()` (`:51`) | `status: 'ACTIVE'`, `deletedAt` (`:71`) only                                                                                                                                      |
| `api/v1/leads/assign`                                                   | `leads:ASSIGN`, audit `OWNER_CHANGED` (`:13`)                                                                                                                                     |
| `api/v1/social-leads/[id]/assign`                                       | via `nextDistributionOwner`                                                                                                                                                       |

**[S]** for all rows; **[R]** for the runtime consequences (leads assigned to
over-quota, unavailable, on-leave and SUSPENDED agents; 4 leads against a quota
of 2; two concurrent auto-assignments to the same agent).

- **RETAIN** — `headroom()` and the `FOR UPDATE SKIP LOCKED` claim in
  `claimForUser` (`allocation.ts:234-250`); `LeadAssignmentHistory` (`:3137`)
  as ownership history.
- **REPAIR** — `assignLead()` must share `headroom()`; both paths must check
  `User.status`; `headroom` must be re-checked inside the claim transaction; the
  rule read and pointer advance in `assignLead()` must move inside its transaction.
- **ADD** — an explicit _unassigned / waiting_ state with a responsible queue and
  review deadline. Today an unassigned lead is simply `ownerId = null` with no
  owning queue and no deadline. **[S]**
- **ADD** — leave-aware eligibility. `User.onLeaveUntil` and `User.isAvailable`
  are read by `headroom()` but **written by nothing in `src/`** — the only writer
  in the repository is `prisma/seed/index.ts:909`. `services/hr/leave.ts`
  `decideLeave` (`:378-425`) writes the request row and notifies; it never touches
  availability. **[S]**

### C. Agent work queue

- **CONNECT** — see §1. The parts exist (`Task`, `FollowUpTask`, `SiteVisit`,
  `Lead.nextFollowUpAt`, `Call`); the queue does not.
- **RETAIN** — the role-aware home page already exists:
  `sales/page.tsx:136-141` branches on `SCOPE_RANK[scopeFor(ctx,'leads','ASSIGN')] >= TEAM`
  to render `ManagerHome` or `EmployeeHome`. **[S]** This is the right seam for
  the agent and manager default screens.
- **ADD** — ordering, timezone handling and duplicate-task prevention across
  stores. `Task` has `recurrenceRule` and `parentTaskId` (`:3684-3685`);
  `FollowUpTask` has neither. **[S]**
- **VERIFY** — timezone. Workspace timezone exists in company settings
  (`docs/CAPABILITY-MATRIX.md`), but `sales/page.tsx:146` computes "today" with
  server-local `new Date(...)`. Whether any queue honours the workspace timezone
  was not established. **[U]**

### D. Contact and qualification

- **RETAIN** — `Call` (`:5230`) with outcome and disposition; `LeadStage` with
  `requiredFields`, `allowedNextStages`, `slaMinutes` and `StageCategory`
  (`:2925-2950`) is already a configurable stage model **[S]**; `Requirement`
  capture exists (`sales/requirements`, `api/v1/requirements`,
  `services/inventory/demand.ts`).
- **CONNECT** — contact outcome and sales stage are already separate models, but
  no code enforces the separation as a workflow; `Lead.status` (`:3055`) is a free
  `String?` sitting beside `stageId`, which invites a third overlapping notion.
  **[S]**
- **VERIFY** — whether the do-not-contact flags (`doNotCall`, `*OptOut`) are
  enforced at the dialer and messaging send paths. Not traced. **[U]**

### E. Customer timeline

- **RETAIN** — `Activity` (`:3599`) with `source: RecordSource`, `Call`,
  `Communication`, `Conversation`, `Document`, `LeadStageHistory` (`:3115`),
  `LeadAssignmentHistory` (`:3137`), `SocialComment`.
- **CONNECT** — no single timeline reader joins them; the lead detail page
  assembles some. Provenance exists as `RecordSource` but AI-generated content is
  not distinguished from provider-confirmed content in a single field. **[U]**
- **RETAIN** — field-level sensitivity already exists
  (`LeadCustomFieldDefinition.isSensitive` `:3663`-area, `lib/security/fieldSecurity.ts`).

### F. Follow-up and commitments

- **REPAIR** — reminders do not cover `FollowUpTask` (§1).
- **RETAIN** — `services/crm/reminders.ts` idempotency design: it asks whether a
  `Notification` already exists for this recipient/kind/record rather than adding
  a `remindedAt` column (`:16-23`). That correctly handles "repeated delivery of
  the same event".
- **RETAIN** — `Notification` (`:5024`) carries `channels`, `emailedAt`,
  `emailError`, so notification failure is already recordable.
- **REPAIR** — `services/sla/checkLeadFirstContact.ts` is a single delayed job and
  says so (`:11-13`): a missed or edited due date is not re-swept. Escalation on
  agent absence does not exist. **[S]**

### G. Property matching and viewings

- **RETAIN** — `SiteVisit` (`:6538`) is a strong model: `REQUESTED → APPROVED →
CHECKED_IN → COMPLETED` plus `REJECTED`, `CANCELLED`, `NO_SHOW` (`:6518-6528`),
  geofenced punch, `locationSuspect` plausibility checks, `outcome`, `notes`.
- **RETAIN** — `services/inventory/demand.ts` `matchesForRequirement` (`:101`)
  filters listings to `MARKETABLE` statuses (`:50`).
- **RETAIN** — `services/inventory/unitStatus.ts` `moveUnit` (`:51`): row-locked
  (`SELECT … FOR UPDATE`, `:62-67`), explicit transition table (`:27-33`), rollup
  recalculation in the same transaction (`:114`), hold expiry
  (`releaseExpiredHolds`, `:130`). **This is the best-built control in the
  inventory area and is under-used.**
- **REPAIR** — `moveUnit` guards another agent's hold only for `HELD → AVAILABLE`
  (`:87-94`); `HELD → BOOKED` by a different agent is permitted. **[S/R]**
- **CONNECT** — viewing feedback does not drive a next action; no link from
  `SiteVisit.outcome` to any next-action store. **[U]**
- **VERIFY** — whether matching covers `UnitInventory` as well as `Listing`. Only
  the listing path was traced. **[U]**

### H. Negotiation and booking

| Layer      | State                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Nav        | **absent** — no bookings entry in `lib/nav/workspaceNav.ts` **[S]**                                                                   |
| Page       | **absent** — `sales/` has 40 directories, none is `bookings`; `/sales/bookings` returns **404** for a workspace administrator **[R]** |
| API        | present — `api/v1/bookings` GET/POST/PATCH                                                                                            |
| Service    | inventory service exists but is **not called** by the booking flow                                                                    |
| Model      | `Booking` (`:6700`), `Commission` (`:6845`), `Payout` (`:6905`)                                                                       |
| Constraint | **no** unique index on `unitInventoryId`; 0 non-internal triggers **[R]**                                                             |
| Test       | `tests/sales/bookings-route.spec.ts`; **no** E2E — `tests/e2e/every-route.spec.ts:53` omits bookings **[S]**                          |

- **ADD** — the booking UI (workflow F of the validation report).
- **REPAIR** — atomic inventory protection; concurrent confirmation; booking over
  a `SOLD` unit or another agent's hold.
- **RETAIN** — `services/money/payouts.ts:168,174` is the reference pattern for
  separation of duties: permission **plus** a maker-checker rule refusing the
  creator. Booking collection should follow it, not reinvent it.
- **ADD** — collection as an event with an amount and evidence. Note the review's
  instruction: booking confirmation, property completion and agency collection are
  **three separate business events**, and no rule making collection imply `SOLD`
  is proposed or implied here.

### I. Employee activity and manager intervention

- **RETAIN** — `services/leadership/rollups.ts`: `funnel` (`:60`), `conversion`
  (`:121`), `activityCompliance` (`:178`), `performerBoard` (`:226`), `rank`
  (`:261`), `interactionFeed` (`:314`), `chasingQueue` (`:349`).
- **CONNECT** — these are report surfaces, not an exception queue with actions.
  There is no "request an update / coach / reassign / arrange coverage / resolve"
  action set attached to an exception. **[S]**
- **RETAIN** — `EmployeeTarget` and `services/targets/progress.ts`.
- **ADD** — comparison fairness. Nothing normalises for source quality, assignment
  age or sales-cycle length; `performerBoard` ranks on raw metric. **[S]**

### J. HRMS connections

- **REPAIR/CONNECT** — the critical gap. `services/hr/lifecycle.ts:535-537` sets
  `User.status = 'DEACTIVATED'` on exit. **Nothing hands over that person's open
  leads, tasks, viewings or deals** — no handover code exists anywhere in `src/`
  (the only `handover` matches are unrelated: unit handover dates and AI coaching
  text). **[S]** This compounds §B: allocation does not check `User.status`, so a
  deactivated user can still be given new work.
- **ADD** — leave → availability (see §B).
- **RETAIN** — HR confidentiality boundary is well designed:
  `services/hr/access.ts` splits `isHrAdmin`, `isApprover`,
  `isAttendanceApprover`, `mayReadSensitiveDocuments` with a documented migration
  that changed nobody's effective access.
- **REPAIR** — the reports layer defeats that design by discarding scope
  (`hr/reports.ts:805`), and the HR actions route's outer `employee:VIEW` gate
  (`hr/actions/[action]/route.ts:286-290`) blocks `finance_admin` from approving
  payroll. **[S/R]**

### K. Owner reporting

- **RETAIN** — `services/leadership/pl.ts` structure: `caveats[]`, and `null`
  rather than `0` for an unknown margin (`:150-152`). That is the right instinct
  and should be the pattern for the metric dictionary.
- **REPAIR** — the four query defects (drafts as revenue `:76`; no run-status
  filter `:227`; current-team payroll attribution `:236,:264`; no collected
  figure).
- **ADD** — a metric dictionary. No document defines source, included statuses,
  date basis, timezone, currency handling, scope or drill-down per metric.
- **RETAIN** — currency discipline: `pl.ts:91-100` excludes a minority currency
  and says so rather than summing across currencies.

### L. AI assistance

| Component                             | Path                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Provider + simulated fallback         | `lib/ai/provider.ts`, `lib/ai/simulated.ts`, `lib/ai/gemini.ts`                                        |
| Budget and metering                   | `lib/ai/usage.ts` — `assertAiBudget` (`:176`), `recordAiUsage` (`:205`), `AI_TOKEN_LIMIT_KEY` (`:129`) |
| Redaction                             | `lib/ai/redact.ts`                                                                                     |
| Audit                                 | `lib/ai/audit.ts`                                                                                      |
| Call analysis / metrics / temperature | `lib/ai/analysis.ts`, `callMetrics.ts`, `temperature.ts`                                               |
| Live coaching                         | `lib/ai/liveCoach.ts`, `liveCoachPrompt.ts`                                                            |
| Practice / roleplay                   | `lib/ai/practice.ts`, `services/shared/practiceScoring.ts`                                             |
| Follow-up drafting                    | `lib/ai/followUpEmail.ts`, `services/social/draftReply.ts`                                             |
| Assistant + tools                     | `lib/ai/assistant/service.ts`, `tools.ts`                                                              |
| Playbooks                             | `services/shared/callIntelligence.ts`, `sales-playbooks` API                                           |

- **RETAIN** — a genuinely well-shaped AI layer: a provider abstraction with a
  simulated mode, per-tenant budget enforcement, redaction and an audit trail.
  This is the foundation workflow L asks for.
- **VERIFY** — whether assistant tools retrieve through the caller's permissions.
  `tests/security/assistant-guardrails.spec.ts` exists to assert that each tool
  declares the modules it reads, and it passes on an LF checkout. Whether the
  declared permission is _applied_ to the query (as opposed to merely declared)
  was not traced in this phase. **[U]** — this is the highest-value AI check.
- **ADD** — the six prioritised features (pre-call briefing, call/voice-note
  summary, suggested CRM updates, message drafts, explainable matching, manager
  exception summary) as workflow-attached features with human review; several have
  components but none is specified with permitted data, source references, review
  step and failure handling.

---

## 3. Evidence limitations

- All runtime evidence **[R]** was produced on **Windows** against a production
  _build_ served with `NODE_ENV=development`. Production boot guards, the
  `output: standalone` serving path, real providers, the worker process and
  scheduled jobs were **not** exercised.
- No production access, no live integrations and no database writes outside the
  isolated validation database were used for this mapping.
- Rows marked **[U]** were not traced to a conclusion in this phase and are listed
  as VERIFY work in `IMPLEMENTATION-BACKLOG.md` rather than assumed either way.
