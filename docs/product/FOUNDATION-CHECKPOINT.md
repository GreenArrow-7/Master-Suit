# Foundation package — checkpoint

The first delivery of the restructuring. **Five items, complete and verified.**
No production deployment, no merge, no destructive migration, no functionality
removed.

## 1. Baseline

| Item                                | Value                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Branch                              | `claude/restructure-foundation` (from `claude/master-suite-baseline-validation-7c75ce`) |
| Base commit                         | `f16ed677516fb07f31832a5d725e13efb477c34d`                                              |
| Relationship to the reviewed commit | started **identical** — 0 commits ahead before this work                                |
| `origin/main`                       | same SHA; upstream has not moved                                                        |
| Working tree at start               | clean of tracked modifications                                                          |

Documents read: `WORKFLOW-BLUEPRINT.md`, `CURRENT-CODE-MAP.md`,
`IMPLEMENTATION-BACKLOG.md`, `DECISIONS-REQUIRED.md`,
`BASELINE-VALIDATION-REPORT.md`.

Every previously reported finding was re-verified against the current code before
any change; all were still present. Two needed sharper evidence than the earlier
report gave: `assignLead()` has no `status: 'ACTIVE'` check (that line is at
`assignLead.ts:71`, inside its sibling `nextDistributionOwner()`), and the
bookings route references the unit only as a foreign key, never its status.

## 2. Commits

| SHA       | Change                                                                          | Kind                      |
| --------- | ------------------------------------------------------------------------------- | ------------------------- |
| `ea08902` | Phase 1 blueprint, code map, backlog, decisions, diagnostics, baseline evidence | docs                      |
| `4a189ca` | Server suites refuse an unnamed database                                        | security / test isolation |
| `aa12237` | HR reports apply the granted scope                                              | **security**              |
| `f2326c4` | Payroll approver no longer blocked by an unrelated permission                   | **security**              |
| `247b231` | `next`, `nodemailer`, `sharp` upgrades                                          | dependencies              |
| `9c91f4b` | Visual system assessment                                                        | docs                      |
| `ab58162` | E2E against a TLS-terminated production server                                  | test config               |

Kept separate deliberately, as asked: security repairs, dependency updates and
test configuration are each reviewable on their own.

## 3. What each item did

### 3.1 Test isolation — `4a189ca`

The two server specs fell back to
`postgresql://leadflow:…@localhost:5432/leadflow` when `E2E_DATABASE_URL` was
unset — the database a developer runs the product against. During the baseline
they wrote to it; their own cleanup ran and left no residue, but that is not a
control.

`tests/server/environment.ts` now refuses unless five conditions hold, and it is
called from `globalSetup` before the server starts as well as from each spec:

1. `E2E_DATABASE_URL` and `E2E_REDIS_URL` named explicitly — no default.
2. The database name ends in `_test`, `_val`, `_ci`, `_e2e`, `_scratch` or `_tmp`
   — a **suffix**, so `test_leadflow_mirror` is still refused.
   `E2E_ALLOW_UNMARKED_DATABASE=yes` waives this one check, in the command, where
   a reviewer sees it.
3. Fixtures and the running server name the same database.
4. Fixtures do **not** use the application role — cross-tenant fixture writes need
   BYPASSRLS, and under the NOBYPASSRLS application role RLS matches nothing and
   reports success.
5. No provider can reach a real recipient: `EMAIL_PROVIDER`,
   `WHATSAPP_PROVIDER`, `ANTIVIRUS_PROVIDER` must be `mock` in `.env` **and** in
   the process environment — either being live is enough to refuse.

No message contains a credential; `describeTarget()` reduces a connection string
to `host:port/database`.

**Verified.** Each refusal fired: no variables, unmarked name, substring-only
name, mismatched pair, application role. With correct configuration,
`npm run test:server` passes 6/6.

### 3.2 HR report visibility — `aa12237`

`resolve()` authorised with `can()`, which checks a scope exists and discards it.
Every report queried `where: { tenantId }` alone. The seeded `employee` role holds
`payroll:VIEW` at **OWN**, so an ordinary employee exported the whole workspace's
payroll register.

Each report now declares its subject. `employee` reports narrow to the people the
caller's scope covers; `workspace` reports (open requisitions, candidate pipeline)
are about the company and now require ORGANIZATION scope rather than being
returned whole. `availableReports()` applies the same rule, so the list cannot
offer what the run endpoint would refuse. The export audit row records the scope
the rows were narrowed to.

`within()` emits `AND: [...]` rather than a bare key — load-bearing, because
`leave-balances` also honours an `employeeId` filter and a plain key would have
been silently overwritten, widening the result.

**Verified on the standalone production build:**

| Caller                                     | Before                               | After                               |
| ------------------------------------------ | ------------------------------------ | ----------------------------------- |
| `employee` (OWN) — payroll register        | 9 payslips, **9 distinct employees** | **1 distinct employee** (their own) |
| `employee` (OWN) — headcount total         | 49                                   | **1**                               |
| `payroll_officer` (ORG) — payroll register | 9 employees                          | **9 — unchanged**                   |
| `dept_manager` (TEAM) — payroll            | 403                                  | 403 — unchanged                     |
| Other workspace                            | 404                                  | 404 — unchanged                     |

### 3.3 Payroll approver — `f2326c4`

The route's kernel gate was `employee:VIEW`, applied _before_ the per-action
permission. Reaching any verb needed `employee:VIEW` **and** the verb's own
authority. `finance_admin` holds `payroll:APPROVE` and deliberately not
`employee:VIEW`, so the designated approver could not approve and maker-checker
collapsed onto `org_admin`.

The unrelated conjunct is gone; nothing is widened and nothing is ungated. Verbs
with a permission assert exactly that permission; SELF verbs assert
`employee:VIEW`, which is precisely the floor the kernel used to apply.
`requireWorkspace(..., 'HRMS')` and the entitlement check are untouched.

**Verified on the standalone production build:**

| Actor             | Action                      | Result                              |
| ----------------- | --------------------------- | ----------------------------------- |
| `payroll_officer` | create / calculate / submit | 200                                 |
| `payroll_officer` | approve own run             | **403** — maker-checker holds       |
| `finance_admin`   | approve                     | **403 → 200**                       |
| `sales_rep`       | approve                     | **403** — nothing widened           |
| `employee`        | leave-apply                 | authorised — self-service unchanged |

### 3.4 Dependencies — `247b231`

Checked against the registry on the day, then upgraded to the lowest version that
clears each advisory.

| Package            | From → to         | Advisory                                                                           |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| `next`             | 16.2.12 → 16.3.4  | GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4, both **critical** unauthenticated RCE |
| `nodemailer`       | ^9.0.4 → ^9.1.1   | four high advisories; 9.1.1 is outside the affected range, so no major bump        |
| `sharp` (override) | ^0.35.0 → ^0.35.4 | GHSA-rgj7-g3m4-5g8c                                                                |

`npm audit --omit=dev --audit-level=high` → **exit 0, 0 vulnerabilities.**

### 3.5 Visual system — `9c91f4b`

Assessment only; no visual change. `tokens.css` turns out to be a designed system
with a documented colour budget, not an accumulation. Contrast was measured for
both palettes: both meet AA on everything that carries text. The choice is
therefore about brand, not accessibility, and is recorded as **D-12** rather than
executed — it stays cheap to defer because the alias layer means a palette swap
is one block, not ~400 call sites.

The real gaps are sizes: table text is 13px against a 14–16px requirement, body
text 15px against 16px, and `--yh-text-muted` fails AA at 2.90:1. Full detail and
a proposed sequence in `DESIGN-SYSTEM-ASSESSMENT.md`.

## 4. Test evidence

| Command                                   | Exit | Result                               |
| ----------------------------------------- | ---- | ------------------------------------ |
| `npx tsc --noEmit`                        | 0    | clean                                |
| `npm run lint`                            | 0    | 0 errors, 113 warnings               |
| `npx vitest run`                          | 1    | **1935 passed, 7 failed, 0 skipped** |
| `npm run test:server`                     | 0    | 6 passed                             |
| `npm audit --omit=dev --audit-level=high` | 0    | 0 vulnerabilities                    |
| `npm run build`                           | 0    | standalone output produced           |
| `npx playwright test` (production, TLS)   | 1    | **30 passed, 5 failed**              |

Baseline for comparison was 1908 passed / 7 failed. The 27 additional passes are
the tests this package added:

- `tests/unit/test-isolation-guard.spec.ts` — 11
- `tests/security/hr-report-scope.spec.ts` — 8
- `tests/security/hr-action-authority.spec.ts` — 8

**Both new security suites were run against the unfixed code and fail there** — 6
of 8 and 2 of 8 respectively. A test that passes either way proves nothing.

### The 7 unit failures

Unchanged from baseline, all Windows-only, none touched by this package:
`capture-vault` (4, POSIX relative-path shape), `observability` (2, `0600` file
modes), `guarded-prologue` (1, forward-slash paths in its exemption list). They
are expected to pass on the Linux CI runner. **Not claimed harmless because they
are on Windows** — claimed harmless because each asserts a POSIX primitive the
platform does not implement, and the two files they flag are exactly the two the
source already exempts.

## 5. Release validation on the real production path

Run as required: `output: standalone` served by `node .next/standalone/server.js`
with `NODE_ENV=production`, `APP_ENV=staging`, and non-mock providers.

**The production startup guards ran and were satisfied** — proved by a negative
test, not asserted: booting the same build with `EMAIL_PROVIDER=mock` exits 1 with
_"Refusing to start in production with mock providers configured"_. So the passing
boot was a real production boot.

TLS was terminated in front, because the production build sets `secure: true` on
the session cookie and a browser will not return it over plain HTTP. That is what
a deployment's Caddy does.

### The 5 E2E failures — one cause, and it is not this package

```
Error upgrading connection with STARTTLS: 502 5.5.1 Command not implemented
code: ETLS   command: STARTTLS
```

`lib/mailer.ts` sets `requireTLS: true` for any port other than 465 — deliberate,
so a relay that does not offer TLS fails rather than sending in the clear. Mailpit,
which this repository's own compose file and staging documentation name as the
staging relay, does not implement STARTTLS.

Consequence: under `NODE_ENV=production` with `EMAIL_PROVIDER=smtp` pointed at
Mailpit, **employee invitation, user invitation and forgot-password all return
500**. Four of the five failures are that; the fifth depends on the invitation
chain.

**New finding, recorded not fixed.** Alertmanager has an
`ALERT_SMTP_REQUIRE_TLS` escape for exactly this; the application mailer has no
equivalent, so it cannot use the relay staging is documented to use. Whether to
add an explicit `SMTP_REQUIRE_TLS` (defaulting true) is a security-relevant
decision, not a foundation-package edit.

A second, smaller finding: the E2E invitation and password-reset specs read the
**mock outbox** (`/api/v1/dev/outbox`, disabled unless `EMAIL_PROVIDER=mock`), so
they are structurally unable to pass against any real provider.

## 6. Capability-preservation matrix

Nothing was removed. Every screen, API, worker, integration and test present at
`f16ed67` is present now.

| Area                                                                              | Classification             | Note                                                 |
| --------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------- |
| HR reports registry, per-report permission, shared `resolve()` gate, export audit | **RETAIN**                 | design kept; only the scope application changed      |
| HR report row visibility                                                          | **REPAIR — done**          | scope now applied                                    |
| Workspace-subject reports                                                         | **REPAIR — done**          | now require ORGANIZATION rather than returning whole |
| HR actions per-action permission map                                              | **RETAIN**                 | unchanged                                            |
| HR actions kernel gate                                                            | **REPAIR — done**          | unrelated conjunct removed, floor preserved          |
| Payroll maker-checker                                                             | **RETAIN**                 | self-approval still refused                          |
| HR self-service verbs                                                             | **RETAIN**                 | same floor, verified                                 |
| Server-suite fixtures                                                             | **REPAIR — done**          | explicit targets, five refusals                      |
| `verify.mjs` gate plan                                                            | **RETAIN**                 | requirement documented in the plan entry             |
| Dependencies                                                                      | **REPAIR — done**          | audit clear                                          |
| Design tokens and component library                                               | **RETAIN**                 | assessed, unchanged                                  |
| E2E suite                                                                         | **RETAIN**                 | config extended, no spec weakened                    |
| Everything else (sales, inventory, AI, workers, integrations)                     | **RETAIN**                 | untouched by this package                            |
| `verify.mjs` CRLF parser                                                          | **REPAIR — deferred**      | P0-7, not in this package                            |
| Booking atomicity, allocation eligibility, P&L                                    | **REPAIR — next packages** | unchanged, still open                                |

## 7. Next-action authority map — proposal

Required before restructuring the queue. **Proposal, not applied.**

| Store                                | Semantics today                                                         | Consumers                                                      | Proposed role                                                             |
| ------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Task`                               | full model: type, category, recurrence, `escalatedAt`, team, `remindAt` | dashboard, calendar, sales/tasks, automation actions, AI tools | **the authoritative obligation**                                          |
| `FollowUpTask`                       | thin: title, due, priority, status, owner                               | follow-ups page, call detail, sales overview                   | **migrate into `Task`** (D-6)                                             |
| `Lead.nextFollowUpAt`                | scalar on the lead                                                      | leads grid, smart views, `chasingQueue`, exports, filters      | **derived** from `Task`, not written independently                        |
| `Activity.followUpAt` / `nextAction` | scalar on a logged activity                                             | `crm/reminders.ts` only                                        | **historical record** of what was promised at the time; not an obligation |

**Which record owns the current obligation:** `Task`. It is the only store with
recurrence, escalation and a reminder field, and it is already what
`crm/reminders.ts` sweeps.

**Which fields preserve history:** `Activity.nextAction` and `Activity.followUpAt`
stay as the record of what was said on a call — they answer "what did we promise",
not "what is due". `LeadStageHistory` and `LeadAssignmentHistory` are untouched.

**Propagation:** completion, cancellation and rescheduling write to `Task` and the
derived `Lead.nextFollowUpAt` is recomputed. Reassignment moves `Task.ownerId` and
leaves prior ownership in history. Rescheduling appends rather than overwrites.

**One overdue definition:** `Task.dueAt < now AND status IN (OPEN, IN_PROGRESS)`.
Agent and manager read the same predicate — today the agent's overview counts
`FollowUpTask` while the manager's counts `Lead.nextFollowUpAt`, on the same page.

**One reminder responsibility:** `crm/reminders.ts`, keeping its existing
idempotency design (it asks whether a `Notification` already exists rather than
adding a `remindedAt` column, which is what makes it safe under overlapping runs).

**Duplicate prevention:** one open obligation per (lead, kind) at a time; creating
a second updates the first.

**Migration:** dry-run count, reversible id mapping, dual-read before cut-over.
**No fifth store is created.**

## 8. Assignment-state design — proposal

Assignment state is **separate from sales stage**, as required. A qualified
enquiry whose owner exits becomes `UNASSIGNED` and keeps its qualification, stage
history and timeline.

| Assignment state   | Meaning                                                         | Exit                                  |
| ------------------ | --------------------------------------------------------------- | ------------------------------------- |
| `UNASSIGNED`       | no eligible owner; carries `responsibleQueue` and `reviewDueAt` | assignment, or escalation on deadline |
| `ASSIGNED`         | an accountable owner                                            | reassignment, handover, exit          |
| `HANDOVER_PENDING` | owner suspended or exiting; work not yet transferred            | handover completes                    |

**One eligibility rule, used by automatic, bulk, social and reassignment paths:**
active status, not deleted, available, not on applicable approved leave _for the
assignment date_, within quota, team-eligible.

**Concurrency.** Re-checking quota inside an ordinary transaction is not
sufficient — two transactions at READ COMMITTED can both observe the same
remaining capacity and both commit. The design therefore takes a per-agent lock
for the duration of the claim (advisory lock on the user id, or `SELECT … FOR
UPDATE` on the user row) so capacity is observed serially. Lead ownership is
already protected by `FOR UPDATE SKIP LOCKED`; that protects the lead, not the
quota, and the two need different mechanisms.

**No SLA numbers are invented.** First-response, review-deadline and escalation
windows are configuration, proposed in D-3 and marked **PROPOSED — NOT APPROVED**.
Business-hours behaviour is configurable and depends on the workspace timezone,
whose use in the queues is an open VERIFY item.

## 9. HRMS access and handover boundaries — proposal

| HR event       | Sales effect                                                           | Confidentiality                                      |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Joining        | eligible once active and team-assigned                                 | —                                                    |
| Approved leave | ineligible **for the leave dates**; cancellation and change reverse it | manager sees _dates_, never the leave type or reason |
| Team transfer  | future routing moves; **historical attribution does not**              | —                                                    |
| Suspension     | no new assignments; existing work to handover                          | reason stays in HR                                   |
| Exit           | access revoked by existing controls; open work handed over             | —                                                    |

**Stopping assignment is not completing handover.** They are separate states, and
`HANDOVER_PENDING` exists so the difference is visible rather than assumed.
Handover explicitly transfers open leads, tasks, viewings and deals to _eligible_
recipients. Outstanding commissions keep their history and settlement obligation —
a handover moves future work, never past entitlement.

**Line managers get no automatic access** to salary, bank details or identity
documents; `services/hr/access.ts` already separates those authorities and that
separation is retained. Permissions apply to APIs, reports, exports, searches and
AI retrieval — the report fix in this package is the first instalment of exactly
that principle.

**Payroll maker-checker is preserved.** The blocked approval was fixed by removing
an unrelated permission requirement, **not** by granting broad administrator
access and not by removing an authorization check — verified by the negative tests
in §3.3.

## 10. First connected workflow — scope and acceptance criteria

**Scope.** Enquiry intake → eligible assignment or an accountable unassigned queue
→ agent contact outcome → next action → reminder and overdue handling → manager
visibility and intervention.

Delivered in the backlog's order: P1-1 (`UNASSIGNED` as a real state), P1-2
(leave-derived availability), P1-3 (one commitment store), P1-4 (contact outcome
drives the next action), P1-5 (manager exception queue with actions).

**Acceptance criteria.**

1. An enquiry arriving with no eligible owner enters `UNASSIGNED` with a
   responsible queue and a review deadline, appears in the manager queue, and is
   assigned to nobody. Its qualification and history survive.
2. Approved leave covering the assignment date makes an agent ineligible on that
   date and eligible the day after; cancelled leave restores eligibility.
3. Two concurrent allocations cannot exceed an agent's daily quota — asserted
   with genuinely concurrent requests, not sequential ones.
4. Two enquiries arriving simultaneously against a two-agent rotation go one each.
5. A follow-up created from a call appears in the agent's queue **and** produces
   exactly one reminder, including under overlapping worker runs. The worker is
   exercised, not stubbed.
6. Agent and manager report the same lead as overdue at the same moment.
7. `CALLBACK_REQUESTED` at a stated time produces exactly one obligation at that
   time; `DO_NOT_CONTACT` removes the customer from every dialer and campaign
   queue.
8. Every manager exception row offers at least one action the caller is permitted
   to take, and resolving it records who and why.
9. A suspended or exited owner's leads appear in a handover queue; historical
   performance still attributes them to that person.
10. No new next-action store exists; `Lead.nextFollowUpAt` is derived.

**Decisions that gate it:** D-2 (unassigned queue ownership) and D-3 (timings)
have workable defaults and do not block a start. D-6 (`FollowUpTask` migrate or
project) must be answered before P1-3's migration step.

## 11. Open items and limitations

- **Not fixed, still open:** booking atomicity, allocation eligibility and
  concurrency, P&L queries, `verify.mjs` CRLF parser, customer identity. These are
  Track 1 and Track 2, unchanged.
- **New finding:** the mailer cannot use Mailpit under `NODE_ENV=production`
  (STARTTLS not implemented), so invitation and password-reset return 500 in the
  documented staging shape. Needs a decision, not a quiet edit.
- **New finding:** the invitation and password-reset E2E specs depend on the mock
  outbox and cannot pass against any real provider.
- **Untested:** worker processes and scheduled jobs, real provider delivery,
  real-device and biometric flows, load, backup restore, rollback. Not inferred
  from a successful build.
- **Platform:** all runtime evidence is Windows. The 7 POSIX-only unit failures
  and the CRLF-sensitive tooling both need a Linux run to close out.
- **Local artefacts, not committed:** the staging env file, the self-signed
  certificate and the TLS terminator used for release validation live in the
  session scratchpad. The certificate is valid for two days.
