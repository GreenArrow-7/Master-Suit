# Implementation backlog

Small, reviewable work packages for the blueprint in `WORKFLOW-BLUEPRINT.md`,
against the code mapped in `CURRENT-CODE-MAP.md`.

**Nothing here has been started.** Phase 1 is analysis; implementation needs
approval. Packages are ordered so that each is shippable and reviewable on its own.

## Ordering principle

Three tracks, deliberately separated:

- **Track 0 — urgent security and reliability.** Defects that leak data or corrupt
  money. Not workflow improvements; they should not wait behind product work.
- **Track 1 — the connected agent workflow.** The first user-facing delivery.
- **Track 2 — manager, owner, and AI.** Built on Track 1.

Blocked work stays visible with its blocker named. Nothing is dropped silently.

---

## Track 0 — urgent security and reliability

### P0-1 · Make report scope load-bearing

**Problem.** Any employee can export every colleague's salary. `hr/reports.ts:805`
authorises with `can()`, which checks that a scope exists and discards it; every
report queries `where: { tenantId }` only. An OWN-scope employee exported 9
payslips for 9 employees — identical to the payroll officer's result.

**Retain.** The report registry design, the per-report permission tuple, the
export audit event, the shared `resolve()` gate that makes UI and export agree.

**Files.** `src/services/hr/reports.ts` (registry + `resolve` + every `run`),
`src/lib/security/rbac.ts` (`assertScopeAtLeast` already exists at `:137`).

**Dependencies.** None. **Policy decisions.** None — this restores the scope the
role catalogue already grants.

**Migration.** None.

**Permissions / audit.** No permission changes. Existing `EXPORT_REQUESTED` audit
retained and should record the applied scope.

**Acceptance tests.**

- OWN-scope employee: payroll register returns only their own payslip; CSV row
  count matches.
- TEAM-scope `dept_manager`: employee reports return their team only.
- ORGANIZATION-scope `payroll_officer`: unchanged, full workspace.
- Cross-workspace: unchanged 404.
- The report list endpoint offers only what the caller can actually receive.

**Rollout / rollback.** Pure narrowing; rollback is a revert. Watch for reports
that are _only_ meaningful workspace-wide — those should require ORGANIZATION
explicitly rather than silently returning less.

**Evidence.** Re-run the Finding D access matrix
(`validation-evidence/logs/payroll-and-d.json`) and show the employee row at 0/own.

---

### P0-2 · Unblock the payroll approver

**Problem.** `finance_admin` holds `payroll:APPROVE` but not `employee:VIEW`, and
`hr/actions/[action]/route.ts:286-290` gates the whole route on `employee:VIEW`
before `ACTION_PERMISSION['payroll-run-decide']` is consulted. Observed: 403. Maker
and checker collapse onto `org_admin`.

**Retain.** The per-action permission map; the self-approval refusal, which works.

**Files.** `src/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route.ts`.

**Dependencies.** None. **Policy.** Whether `finance_admin` should also hold
`employee:VIEW` is a role-catalogue question (D-9) — but the route should not
require an unrelated permission regardless.

**Acceptance tests.**

- `payroll_officer` prepares → cannot approve (unchanged).
- `finance_admin` approves → succeeds.
- A role with neither → refused, naming `payroll:APPROVE`.

**Evidence.** The walkthrough script's payroll section, showing 200 on the
`finance_admin` approval.

---

### P0-3 · Atomic booking confirmation

**Problem.** Confirmation never touches inventory. Two concurrent confirmations
against one unit both returned 200. No protection at API, service, or database.

**Retain.** `services/inventory/unitStatus.ts` `moveUnit` — row-locked, explicit
transition table, rollups in the same transaction. It is already correct; it is
simply never called by the booking flow. Its own caller's comment
(`projects/[id]/units/[unitId]/route.ts:21-23`) anticipated this.

**Files.** `src/app/api/v1/bookings/route.ts` (CONFIRM and CANCEL branches),
`src/services/inventory/unitStatus.ts` (extend the holder guard to `HELD → BOOKED`),
one migration adding a partial unique index.

**Migration.** Partial unique index on `Booking(unitInventoryId)` where
`status = 'CONFIRMED' AND deletedAt IS NULL`. **Backfill risk:** existing duplicate
confirmed bookings on one unit would block the index — audit and resolve first.

**Acceptance tests.**

- Two concurrent confirmations on one unit → exactly one 200, one refused with a
  reason.
- Confirming moves the unit in the same transaction; failure leaves both unchanged.
- Confirming against a `SOLD` unit → refused.
- Confirming over another agent's live hold → refused.
- Cancelling a confirmed booking releases the unit.
- The database rejects a second confirmed booking even if the application is bypassed.

**Rollout / rollback.** The index is the irreversible part; add it after the audit.
Application change is revertible.

**Evidence.** `tests/diagnostic/finding-bc-booking.diag.ts` B1–B4 flip from failing
to passing.

---

### P0-4 · One eligibility rule for every assignment path

**Problem.** Three paths, three policies. `assignLead()` enforces none — leads were
assigned to over-quota, unavailable, on-leave and SUSPENDED agents. Concurrent
allocations delivered 4 leads against a quota of 2. Concurrent auto-assignments
both went to the same agent.

**Retain.** `headroom()`, `LeadAssignmentHistory`, the `FOR UPDATE SKIP LOCKED`
claim, and `nextDistributionOwner()`'s walk-the-pool pattern.

**Files.** `src/services/distribution/allocation.ts`,
`src/services/distribution/assignLead.ts`, `src/workers/distribution.ts`.

**Dependencies.** Leave-derived availability is **P1-2**; until then this package
uses `User.status`, `isAvailable`, `deletedAt` and quotas.

**Policy.** D-4 (quota behaviour when the pool is exhausted).

**Acceptance tests.**

- SUSPENDED / DEACTIVATED agent receives nothing from any path.
- Quota-exhausted agent receives nothing from the automatic path.
- Two concurrent allocations cannot exceed the quota.
- Two concurrent automatic assignments to a two-agent pool → one each.
- Empty eligible pool → `UNASSIGNED` (needs **P1-1**); until then, refuse and
  report rather than assign to an ineligible agent.

**Evidence.** `tests/diagnostic/finding-e-allocation.diag.ts` E1–E7.

---

### P0-5 · Dependency upgrades

**Problem.** `npm audit --omit=dev` fails: `next` 16.2.12 (critical,
unauthenticated RCE — including a Windows-host advisory), `nodemailer` (4 high),
`sharp` (high).

**Files.** `apps/web/package.json`, `package-lock.json`.

**Dependencies.** `next@16.3.4` is outside the declared range — a minor-version
bump needing a full gate run and an E2E pass.

**Acceptance.** Audit gate exits 0; full `npm run verify` green on Linux; E2E green.

**Rollback.** Lockfile revert.

---

### P0-6 · Stop the test suite writing to the developer's database

**Problem.** `tests/server/session-lifecycle.spec.ts:18` and
`unified-saas.spec.ts:20` default to `postgresql://leadflow:…@localhost/leadflow`
when `E2E_DATABASE_URL` is unset. They write to and delete from whatever `leadflow`
is on that machine. They also silently require a BYPASSRLS role, which
`scripts/verify.mjs` does not mention.

**Files.** the two specs, `tests/server/globalSetup.ts`, `scripts/verify.mjs`.

**Acceptance.** With no `E2E_DATABASE_URL`, the suite **fails with a clear message**
rather than falling back to a real database. `verify.mjs` states the requirement.

**Why Track 0.** It is not a product defect, but it can destroy a colleague's data.

---

### P0-7 · Make `verify.mjs` work on a CRLF checkout

**Problem.** `scripts/verify.mjs:127` `/^ {8}run:\s*(.*)$/` cannot match a CRLF
line, so every gate parses with a null command and the script exits 2 claiming all
24 gates were deleted. The guard that would catch it (`:141`) runs before the
filter that causes it (`:150`).

**Files.** `scripts/verify.mjs`. Two-line fix plus reordering the guard.

**Acceptance.** `node scripts/verify.mjs --list` returns the correct plan on a
CRLF checkout; a genuinely broken parser still exits 2 with the honest message.

---

## Track 1 — the connected agent workflow

**The first user-facing delivery.**
`Enquiry → eligible assignment → contact outcome → next action → manager visibility.`

### P1-1 · `UNASSIGNED` as a real state _(first package)_

**Problem.** An enquiry with no eligible owner today is `ownerId = null` with no
owning queue and no deadline. It is invisible until someone happens to filter for
it. This is the "who owns this customer" clause of the product question, unanswered.

**Expected user behaviour.** When automatic assignment finds nobody eligible, the
enquiry enters `UNASSIGNED` with a responsible queue and a review deadline, and the
manager sees it in their exception queue with an assign action.

**Retain.** `Lead.ownerId`, `LeadAssignmentHistory`, the manager home seam at
`sales/page.tsx:136-141`, `chasingQueue`'s "a lead with no task is the one most
likely to be forgotten" reasoning.

**Files.** `src/services/distribution/assignLead.ts`, `allocation.ts`,
`src/app/(workspace)/[workspaceSlug]/sales/page.tsx`,
`src/services/leadership/rollups.ts`, one migration.

**Migration.** Add `Lead.assignmentState`, `responsibleQueueId`, `reviewDueAt`.
**Backfill:** existing `ownerId IS NULL` open leads become `UNASSIGNED` with a
review deadline of _now + default window_; this is a visible, reversible backfill
and its row count should be reported before it runs.

**Policy.** D-2 (who owns the unassigned queue), D-3 (review window).

**Permissions / audit.** No new permission. Entering and leaving `UNASSIGNED` is an
assignment-history event.

**Acceptance tests.**

- Pool with no eligible member → enquiry is `UNASSIGNED`, deadline set, manager
  queue shows it, nobody is notified as owner.
- Manager assigns from the queue → state and history update; deadline cleared.
- Deadline passes with no action → the row escalates within the queue.
- Backfill: count of affected rows matches the pre-run report.

**Rollout / rollback.** Additive columns; rollback leaves them unread.

**Completion evidence.** A manager screenshot showing an unassigned enquiry with
its deadline, plus the assignment-history rows for entry and exit.

---

### P1-2 · Leave-derived availability

**Problem.** `headroom()` reads `User.isAvailable` and `User.onLeaveUntil`, and
**nothing in `src/` writes either** — the only writer is the demo seed.
`decideLeave` (`hr/leave.ts:378-425`) never touches them. Approved leave therefore
has no effect on who gets work. `onLeaveUntil` is also a single scalar with no start
date, so it cannot express leave that begins in the future.

**Retain.** `HrLeaveRequest` with its date range and approval; `headroom()`.

**Files.** `src/services/distribution/allocation.ts` (derive from leave rather than
the scalar), `src/services/hr/leave.ts` (emit the event).

**Dependencies.** P0-4. **Policy.** D-5 (which leave types block assignment).

**Migration.** None required if availability is derived. Deprecating
`User.onLeaveUntil` is a later cleanup, not part of this package.

**Confidentiality.** The sales side sees _unavailable on these dates_, never the
leave type or reason.

**Acceptance tests.**

- Agent with approved leave 3–10 Oct: ineligible on 5 Oct, eligible on 11 Oct.
- Leave approved for next month does not block assignment today.
- Rejected or cancelled leave does not affect eligibility.
- A sales manager's view exposes dates only, no leave type.

---

### P1-3 · One commitment store

**Problem.** Four competing next-action stores; reminders cover two and **not** the
one the agent's own page counts; agent and manager use different definitions of
"overdue" on the same page.

**Expected user behaviour.** A follow-up created anywhere appears in the agent's
queue **and** produces a reminder, and the manager sees the same thing overdue at
the same moment.

**Retain.** `Task` (type, category, recurrence, `escalatedAt`, team, reminder
fields) as the authoritative store — it is already what `crm/reminders.ts` sweeps.

**Amended — do NOT retain the reminder idempotency design.** This item previously
said to keep `crm/reminders.ts:16-23`. That design is an existence check in one
transaction followed by an insert in another, and it is not idempotent: the two
are not atomic, `NOT EXISTS` takes no lock under `READ COMMITTED`, and
`Notification` carries no unique constraint to fall back on. It also keys on the
_lead_, so two open tasks on one lead collapse to a single reminder and one of
them is never sent. Replace it with the unique index and `ON CONFLICT` claim
specified in
[`NEXT-ACTION-AND-REMINDER-CONTRACTS.md`](NEXT-ACTION-AND-REMINDER-CONTRACTS.md)
§3.3.

**Files.** `src/app/api/v1/follow-ups/*`, `src/services/crm/reminders.ts`,
`src/app/(workspace)/[workspaceSlug]/sales/page.tsx`, `sales/follow-ups`,
`sales/calendar`, `dashboard`, `src/services/leadership/rollups.ts`,
`src/lib/ai/assistant/tools.ts`.

**Migration.** Migrate `FollowUpTask` rows into `Task`, preserving ids by mapping
table. **This is the largest data move in the backlog** and should be its own
reviewable step with a dry-run count and a reversible mapping. Every open
obligation is preserved: rows are never collapsed because they share a lead and a
kind. `Lead.nextFollowUpAt` becomes derived (contracts §2.6 — earliest open
`dueAt` across every owner and kind), maintained from `Task`, not written
independently.

**Split out.** Deriving `nextFollowUpAt` does not need the migration and should
precede it. The column has no writer today, and six Sales surfaces already read
it. Three prerequisite steps, in order, from contracts §2.6:

1. **A reconciliation report** — for every open `FollowUpTask`, whether an
   equivalent open `Task` exists. Read-only. Must run clean before step 2.
2. **Derive from the union of both stores**, with a `Lead` row lock taken before
   the recompute. A single aggregate `UPDATE` is _not_ sufficient on its own:
   under `READ COMMITTED` the subquery snapshots and takes no lock, so two
   concurrent obligation writes on one lead can interleave and store a value
   that was stale when computed.
3. **Narrow to `Task`** only once step 1 reports zero unmapped open rows.

**Lock ordering for this subsystem:** `Lead` first, then obligation rows;
several leads in ascending `id` order. The assignment path takes `User` then
`Lead`, so an obligation write must never take a `User` lock while holding a
`Lead` lock.

**Policy.** D-6 (whether `FollowUpTask` is migrated or kept as a projection).

**Acceptance tests.**

- A follow-up created from a call produces exactly one queue item **and** one
  reminder.
- Agent overdue count equals manager overdue count for the same lead set.
- Rescheduling twice leaves two history entries and one open item.
  - **Amended twice.** The first wording — "the same commitment created twice
    yields one item" — assumed the withdrawn one-per-lead-and-kind rule. The
    second wording said a person's create never dedupes, which was also wrong:
    a double-submitted form is a _retry_. Correct: **a request replayed with the
    same `requestKey` yields one item, whoever sent it; a new key yields a new
    item.** A replay carrying materially different input is a **conflict**, not
    a silent success, and authorization runs before the idempotency lookup.
    Contracts §2.2.
- Two open obligations on one lead produce **two** reminders, not one.
- One source event that is meant to create three tasks creates three, not one —
  the dedupe key names the action inside the event, not the event.
- An obligation moved 09:00 → 14:00 → 09:00 still reminds at the final 09:00.
  Keying reminder identity on the due time loses that third one; the key is a
  monotonic `scheduleRevision`. Contracts §3.3.
- A reminder claimed and then overtaken — completed, cancelled, reassigned or
  rescheduled before delivery — is **dropped with a reason**, not delivered.
  Contracts §3.4.
- Deriving `Lead.nextFollowUpAt` reads **both** stores until the reconciliation
  report shows zero unmapped open `FollowUpTask` rows. Deriving from `Task`
  alone erases real work from every Overdue surface. Contracts §2.6.
- Overlapping reminder-worker runs send one notification, not two, under
  concurrent execution — asserted against actual concurrency, not against a
  sequential re-run.

**Rollout.** Dual-read first (queue reads both stores), then migrate, then
single-read. Rollback is possible until the single-read step.

---

### P1-4 · Contact outcome drives the next action

**Problem.** Outcomes and stages are already separate models, but nothing binds an
outcome to a commitment. `Lead.status` is a free-text field beside `stageId`,
inviting a third overlapping notion.

**Retain.** `Call` outcomes; `LeadStage` with `requiredFields`, `allowedNextStages`,
`slaMinutes`, `StageCategory` — this is already a configurable stage model.

**Files.** `src/app/api/v1/calls/[id]/route.ts`, `src/services/leads/updateLead.ts`,
lead detail UI.

**Dependencies.** P1-3.

**Policy.** D-7 (the stage set), D-4 (retry cadence and attempt ceiling).

**Acceptance tests.**

- `CALLBACK_REQUESTED` at 16:00 → exactly one commitment at 16:00.
- `DO_NOT_CONTACT` → consent flags set; customer leaves every dialer and campaign
  queue. _(Includes the VERIFY item: confirm enforcement at the send paths.)_
- `NO_ANSWER` past the ceiling → manager exception, not an infinite retry loop.
- Stage advance missing a required field → refused, naming the field.
- An outcome without a stage change leaves the stage untouched.

---

### P1-5 · Manager exception queue with actions

**Problem.** `chasingQueue`, `activityCompliance` and friends are reports. No action
is attached, so an exception cannot be resolved — only looked at.

**Retain.** All of `services/leadership/rollups.ts`; the manager home seam.

**Files.** `src/services/leadership/rollups.ts`,
`src/app/(workspace)/[workspaceSlug]/sales/page.tsx`, a new exception-resolution
service.

**Dependencies.** P1-1, P1-3.

**Permissions / audit.** Each action reuses an existing permission (`leads:ASSIGN`
for reassign, etc.). Resolution is audited with actor and reason.

**Acceptance tests.**

- Each exception row offers at least one action the caller is permitted to take.
- Resolving records who and why.
- An exception whose cause disappears leaves the queue automatically.
- A manager sees only their subtree.

---

### P1-6 · Booking UI and the collection event

**Problem.** `/sales/bookings` is a 404 even for a workspace administrator; the
whole negotiation-to-money chain is API-only. Collection needs only `bookings:EDIT`
and records only a timestamp, so a partial receipt unlocks full commission.

**Retain.** The booking API and state machine; the commission gate, which correctly
refuses `→ COLLECTED` without a collection date; `payouts.ts:168,174` as the
maker-checker pattern to copy rather than reinvent.

**Files.** new `sales/bookings` pages, `src/lib/nav/workspaceNav.ts`,
`src/app/api/v1/bookings/route.ts`, `src/services/money/commissions.ts`, migration.

**Dependencies.** **P0-3** — do not build the UI on a flow that can double-sell.

**Migration.** Add a collection record (amount, currency, date, payer side,
reference, recorded-by). Derive `Booking.collectedAt` from it; keep the column for
compatibility during transition.

**Policy.** **D-8 blocks the eligibility half of this package** — whether partial
receipt pro-rates or blocks commission is unstated finance policy. The UI and the
receipt record can proceed; the eligibility rule cannot.

**Acceptance tests.**

- An administrator can reach a booking from the customer and from the commission.
- Recording collection requires finance authority and refuses the booking's creator.
- Collecting an agency fee does **not** change the unit's status.
- Booking confirmation, property completion and collection remain three separate
  events with three separate timestamps.

---

## Track 2 — owner reporting, HRMS connection, AI

### P2-1 · Fix the four P&L queries

Drafts as revenue (`pl.ts:76`); no run-status filter (`:227`); current-team payroll
attribution (`:236`, `:264`); no collected figure. **Retain** the caveat and
null-margin design. Acceptance: `tests/diagnostic/finding-a-pl.diag.ts` A1–A4 flip
to passing while the control A1b stays green.

### P2-2 · Metric dictionary

Every owner metric gains the ten attributes in the blueprint. Cohort and period
conversion separated. Money split into five lines. Depends on P2-1.

### P2-3 · Handover on suspension and exit

`hr/lifecycle.ts:535-537` deactivates the user and hands over nothing. Add a
handover queue for open leads, tasks, viewings and deals; preserve historical
ownership and attribution. Depends on P1-1, P1-3. Policy: D-2.

### P2-4 · Customer identity

The `Customer` entity, so a returning enquirer is one customer with several
enquiries. **Blocked on D-1** — the option chosen changes the migration shape.
Largest migration in the plan; should not start before Track 1 is stable.

### P2-5 · Verify AI permission inheritance _(do first in this track)_

Establish whether assistant tools retrieve through the caller's permissions or
merely declare which modules they read. `tests/security/assistant-guardrails.spec.ts`
checks declaration. **This is a VERIFY package, and it gates P2-6.**

### P2-6 · The six AI features

Pre-call briefing, call/voice-note summary, suggested CRM updates, message drafts,
explainable matching, manager exception summary. Each with permitted data, source
references, human review, audit, budget and failure handling. Writes go through
application services; financial calculations stay deterministic. Depends on P2-5.

### P2-7 · Comparison fairness

Segment performance comparisons by source quality, assignment age and sales-cycle
length — or state on the report that they are not segmented.

---

## Blocked and deferred — kept visible

| Item                                                                | Status       | Blocker                            |
| ------------------------------------------------------------------- | ------------ | ---------------------------------- |
| Commission eligibility on partial receipt                           | **blocked**  | D-8, finance policy                |
| Customer identity model                                             | **blocked**  | D-1, and Track 1 stability         |
| Escalation and first-response windows                               | **blocked**  | D-3, company policy                |
| Deprecating `User.onLeaveUntil`                                     | deferred     | after P1-2 proves the derived path |
| Deprecating `Lead.status`                                           | deferred     | after P1-4 settles the stage model |
| Timezone correctness across queues                                  | **VERIFY**   | not traced; affects P1-3           |
| Do-not-contact enforcement at send paths                            | **VERIFY**   | folded into P1-4                   |
| Matching coverage of project units                                  | **VERIFY**   | affects G                          |
| Production boot guards, standalone serving, workers, real providers | **untested** | needs a staging environment        |

## Evidence standard

A package is complete when its acceptance tests pass **and** the corresponding
diagnostic assertions in `apps/web/tests/diagnostic/` flip from failing to passing,
with the baseline in `validation-evidence/baseline-run1/` unchanged as the
comparison point. Re-running on Linux is part of completion evidence, because the
seven POSIX-only unit-test failures cannot clear on Windows.
