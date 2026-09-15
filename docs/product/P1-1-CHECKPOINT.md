# P1-1 checkpoint — the accountable unassigned-lead queue

|               |                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------- |
| Branch        | `claude/restructure-foundation` (isolated worktree, unpushed)                               |
| Package start | `02f889bd6eef10e349266753d147d20cee4982b6`                                                  |
| Final SHA     | `1524676304f160433cab63c4eed7a27fb4388321` (plus this document)                             |
| Not done      | merged, deployed, production data touched, financial rules, AI features, task consolidation |

---

## 0. Preflight — the starting point, reconciled

The three references in the brief describe one history, and the difference is
documentation only:

| Reference                                  | What it is                                                 |
| ------------------------------------------ | ---------------------------------------------------------- |
| `701be3e27964b0db159cfad0ba6d205c3e637921` | the last commit **listed inside** the closeout's own table |
| `697b508`                                  | the closeout document, committed on top of it              |
| `02f889b`                                  | a one-line correction to that document                     |

`git diff 701be3e..697b508` is **one file** — `FOUNDATION-CLOSEOUT.md`, +730
lines — and **zero** files under `apps/`, `prisma/` or `scripts/`. The tested
tree and the reported HEAD are code-identical, so **no foundation test was
repeated**; they are carried forward as evidence with their stated limits.

**The branch difference was a real error in the closeout, now corrected.** The
worktree directory is named `master-suite-baseline-validation-7c75ce` after the
Phase-1 branch; the reflog shows it switched to `claude/restructure-foundation`
(created from `f16ed67`) when restructuring began, and every Foundation and
Closeout commit is on that branch. `claude/master-suite-baseline-validation-7c75ce`
still exists, still at `f16ed67`.

Foundation limits that remain in force and are **not** re-litigated here: two
Windows unit tests fail on POSIX file modes that NTFS cannot express, verified
passing on Linux; and the team-feed reaction test's recovery is plausible but
unbisected.

---

## 1. Commits

| SHA       | Subject                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| `8ac14ef` | `docs(product)`: correct the task and reminder contracts (revision 2)                   |
| `09641ad` | `fix(distribution)`: one eligibility rule, and a deactivated employee never gets a lead |
| `4db62a6` | `feat(distribution)`: a lead that cannot be assigned becomes an accountable episode     |
| `7411919` | `feat(distribution)`: the unassigned-lead queue, end to end                             |
| `7c36259` | `feat(sales)`: a Waiting tab on Allocation, so a manager can act without leaving it     |
| `6c8e62e` | `test(distribution)`: 38 behavioural tests for the unassigned-lead queue                |
| `1c20c91` | `fix(sales)`: the waiting queue's own rendering defects, found by looking at it         |
| `1524676` | `docs(evidence)`: P1-1 queue and assignment flow captures                               |

**18 files, +3,523 / −227**, of which 929 lines are tests and 669 are the
contract corrections.

| Area               | Files                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Schema + migration | `prisma/schema.prisma`, `migrations/20260910190000_lead_triage_queue/`, `README.md`                                    |
| Services           | `distribution/{eligibility,triage,triageQueue,assignLead}.ts`                                                          |
| Worker             | `workers/maintenance.ts`                                                                                               |
| API                | `api/v1/leads/triage/route.ts`, `api/v1/leads/triage/[id]/assign/route.ts`                                             |
| UI                 | `sales/allocation/{page.tsx,WaitingQueue.tsx}`                                                                         |
| Tests              | `tests/sales/lead-triage.spec.ts`, `tests/sales/lead-triage-worker.spec.ts`                                            |
| Docs               | `NEXT-ACTION-AND-REMINDER-CONTRACTS.md`, `WORKFLOW-BLUEPRINT.md`, `IMPLEMENTATION-BACKLOG.md`, `DECISIONS-REQUIRED.md` |

---

## 2. What the code actually did before this

Stated first, because it is what the package is for and it is worse than the
brief assumed.

`assignLead` — the automatic path every inbound lead goes through — had **three
bare `return` statements**: no rule, empty pool, lead already owned. Each left
the lead with `ownerId = null` and recorded **nothing at all**. The lead dropped
into the pool looking exactly like one nobody had reached yet. No deadline,
nobody accountable, no statement of what went wrong. A workspace whose only
distribution rule had been deactivated would quietly stop assigning leads and
nothing anywhere would say so.

And it checked **no eligibility whatsoever**. `pool[(last + 1) % pool.length]`
was assigned regardless of whether that person was suspended, deactivated, on
approved leave, or ten leads past their daily quota. **A deactivated employee
received new leads every time the rotation came round to them.**

Three code paths held three different definitions of "eligible", and the
strictest of them still missed something:

| Path                             | Checked                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `assignLead` (automatic)         | **nothing**                                                                  |
| `nextDistributionOwner` (social) | `status = ACTIVE`, `deletedAt IS NULL`                                       |
| `headroom` (bulk allocation)     | quotas, capacity, `isAvailable`, `onLeaveUntil` — **but not account status** |

And **eight `DistributionRule` columns were read by nothing in `src/`**:
`respectWorkingHours`, `respectLeave`, `respectQuotas`, `respectCapacity`,
`fallbackTeamId`, `fallbackUserId`, `escalateAfterMins`, `reassignAfterMins`. A
workspace could configure "respect leave" and watch it do nothing. P1-1 is
largely the enforcement the schema has been advertising since the beginning —
which is why it needs almost no new configuration surface.

**`User.onLeaveUntil` and `User.isAvailable` are written by nothing in the
application** — only by the seed. Approving leave in the HR module never touched
them, so "on leave" in the allocator has never meant "on leave" in the HRMS.

---

## 3. What now works

### For an agent

- A lead that reaches them has been checked against one rule: active account,
  active workspace membership, active employment, in the routed team if the rule
  scopes to one, not on approved leave, inside quota and capacity.
- They receive a manually-assigned lead through the existing notification and
  their existing lead list — no new surface to learn.
- **Their own leave now protects them.** An approved `HrLeaveRequest` covering
  today keeps new leads off their desk; before, only a field nothing wrote did.

### For a manager

`/{slug}/sales/allocation?view=waiting` — a third tab beside Requests and
Capacity, carrying its own count. Each row shows exactly what the brief asked
for:

| Requirement                              | On the row                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Lead and source                          | name, linked to the record, with source and source detail                   |
| Time waiting                             | largest honest unit, red **and the words "past review time"** when overdue  |
| Why automatic assignment failed          | one sentence, with per-candidate refusals behind a disclosure               |
| Responsible queue/team                   | the accountable person and their team                                       |
| Review deadline, or missing-policy state | the deadline, or a **"Not configured"** badge naming the setting to fill in |
| Available next action                    | an eligibility-filtered picker and an Assign button, in the row             |

A manager can clear the queue **without leaving it**.

### For HR

- Nothing in HR changed. Attendance, leave, payroll, recruitment, employee
  self-service and their permissions are untouched — this package only _reads_
  `HrLeaveRequest` and `EmployeeProfile`.
- Approved leave and employment status now have a consequence in Sales, which is
  the connection that was missing.
- **Employee exit handover remains a separately scoped package.** What P1-1
  establishes is the half that stops the bleeding: once an employee's account or
  employment ends, they receive no _new_ leads through any allocation path. What
  it deliberately does **not** do is move the leads they already hold — that is
  a handover decision with commission and customer-continuity consequences, and
  it needs the exit package. Today those leads stay with the departed owner and
  are visible to their manager.

---

## 4. Design decisions worth reviewing

**An episode, not a flag.** A lead can wait, be assigned, be routed back to a
team pool and wait again. "How long did it wait the second time" must be
answerable separately from the first, so each wait is its own row with its own
episode number. A boolean on `Lead` would overwrite the first with the second.

**Assignment state is separate from sales stage.** Nothing in the new code reads
or writes `Lead.stageId` — verified by grep across `services/distribution/`,
where the only occurrences are pre-existing read-only filters in
`allocation.ts`. A lead can be in the triage queue in any open stage, and moving
stage neither opens nor closes an episode.

**Four reason codes, not one flag.** `NO_RULE` and `EMPTY_POOL` are
configuration; `NO_ELIGIBLE_AGENT` is usually staffing or leave;
`ALL_AT_CAPACITY` is a quota doing its job. Each is a different administrative
fix, and a manager who cannot tell them apart cannot act on any of them.

**Nobody's access is widened.** Accountability resolves in order: the rule's
fallback user → its fallback team's manager → the lead's own team's manager.
Every one of those is somebody the workspace already designated. Where none
exists, the entry is flagged `routingPolicyMissing` and stays visible and
counted — **it is not escalated to whoever happens to hold a broad permission**,
because that would be widening access to paper over a configuration gap.

**No invented SLA.** `escalateAfterMins` is the review window. Where it is
unset, `reviewDueAt` is null, `reviewPolicyMissing` is true, the queue says
"Not configured — set an escalation window on the distribution rule", and the
entry is **neither escalated nor hidden**. Ordering is by `openedAt` rather than
by deadline, deliberately: sorting by deadline would push every unconfigured
entry to one end of the list, which is the entry a manager most needs to see.

**Configuration that cannot be honoured is reported.** `respectWorkingHours` has
no working-hours model to consult, so it is listed as ignored on the entry rather
than silently treated as satisfied.

**Lock ordering, written down.** Assignment takes **`User` first, then `Lead`**;
several users in ascending id order. The obligation subsystem takes the opposite
order and the two are reconciled in
[`NEXT-ACTION-AND-REMINDER-CONTRACTS.md`](NEXT-ACTION-AND-REMINDER-CONTRACTS.md)
§2.6, which now forbids an obligation write from taking a `User` lock while
holding a `Lead` lock.

---

## 5. Safety properties, and how each is achieved

| Requirement                                      | Mechanism                                                                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated intake does not duplicate queue entries | **Partial unique index** `("tenantId","leadId") WHERE status='WAITING'` + `ON CONFLICT DO NOTHING`. Not a check-then-insert: a `findFirst` first takes no lock and both racers insert.                         |
| Competing workers cannot assign inconsistently   | The claim is `UPDATE … WHERE "ownerId" IS NULL`. Two workers produce one update of 1 row and one of 0; the loser is told the lead is gone.                                                                     |
| Concurrent assignments respect capacity          | `SELECT … FOR UPDATE` on the `User` row **inside** the assignment transaction, then re-count. A read outside the transaction is a guess by the time it commits.                                                |
| Assignment and audit history commit together     | One `withTx`: lead claim, `LeadAssignmentHistory`, triage resolution and `AuditLog`. A crash between any two leaves none.                                                                                      |
| Notifications only after commit, recoverable     | Written after the transaction returns; `notifiedAt` records what has been announced and `sweepTriageNotifications` retries what was missed, giving the stamp back on failure.                                  |
| Repeated sweeps do not duplicate alerts          | `escalatedAt` claimed by conditional `UPDATE`; only rows that UPDATE actually changed are notified, so two overlapping sweeps produce one alert **between** them.                                              |
| Assigning resolves pending escalation            | `resolveTriageEntry` runs in the assignment transaction, so it is true immediately rather than eventually.                                                                                                     |
| Re-entry is a distinguishable new episode        | `episode = MAX + 1` in the inserting statement, unique per `(tenant, lead, episode)`.                                                                                                                          |
| Correct tenant and authorization in the worker   | Every write is inside `withTx(tenantId)`; cross-tenant sweep _reads_ are raw SQL inside `withPlatformTx`, the convention retention and reminders already use. Asserted by the worker test on `entry.tenantId`. |

No new general-purpose task store: the existing BullMQ `maintenance` queue and
its scheduler carry the sweeps.

---

## 6. Tests

```bash
# The service decisions — 35 tests
npx vitest run tests/sales/lead-triage.spec.ts

# The real worker path — 3 tests
npx vitest run tests/sales/lead-triage-worker.spec.ts

# Everything
npx vitest run
```

| Suite                        | Result                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `lead-triage.spec.ts`        | **35 passed**                                                    |
| `lead-triage-worker.spec.ts` | **3 passed**                                                     |
| Full unit suite (Windows)    | **2,038 passed, 2 failed** — the two known NTFS POSIX-mode tests |
| Full unit suite (Linux)      | _(§8)_                                                           |

**34 of the 35 service tests fail against the previous implementation.** The
suite was run against the unmodified `assignLead` from `HEAD` before the change,
and among the failures is `expected 'cmtv…' to be null` — the old code assigning
a lead to a `DEACTIVATED` account. That is the defect this package exists to fix
and nothing in the repository could have caught it.

Covered: no eligible agents; deactivated, suspended, soft-deleted, on-leave and
at-quota agents; `respectLeave = false` honoured as a workspace decision; the
social path; authorised and unauthorised manual assignment; cross-tenant refusal
and out-of-scope refusal; three workers racing one lead; two leads racing one
free capacity slot; redelivered intake; deadline boundaries at 29:59 and 30:00
as absolute instants; escalation raised once across three sweeps; assignment
answering a raised escalation; re-entry producing episode 2; stale entries closed
when a lead is assigned elsewhere; and missing routing and deadline
configuration.

The worker file runs a real BullMQ worker against a real queue with the same
handler bodies the distribution and maintenance workers dispatch to — including
one that **crashes the worker after the work commits**, which is the shape that
actually duplicates. Service tests cannot catch a job enqueued under a name no
worker handles, a payload unpacked wrongly, or a retry delivered twice.

**No migration or backfill was run against any data.** The migration creates an
empty table; there is nothing to backfill, because a lead that is currently
unassigned has no recorded reason to reconstruct — inventing one would be
fabricating history. Existing unassigned leads enter the queue the next time
they are processed. Applied to the isolated `master_suite_val` database only;
`check-rls.mjs` confirms 182 tenant tables enabled, FORCEd and policied, and
`prisma migrate diff --exit-code` reports no drift.

---

## 7. Screenshots

`validation-evidence/p1-1/`, from the production standalone build under
`NODE_ENV=production` behind TLS, with synthetic records:

| File                                | What it shows                                                        |
| ----------------------------------- | -------------------------------------------------------------------- |
| `queue-desktop.png`                 | five waiting leads at 1440×960, all six required columns             |
| `queue-mobile.png`                  | the same at 390×844, stacked into cards, **0px overflow**            |
| `queue-detail-{desktop,mobile}.png` | per-candidate refusals expanded                                      |
| `assign-chosen-desktop.png`         | an eligible agent selected                                           |
| `assign-result-desktop.png`         | after: **five rows → four**, tab count and pool count both following |
| `permission-agent-desktop.png`      | an OWN-scope agent sees an empty queue — correctly scoped, no leak   |

Every capture reports 0px horizontal overflow.

---

## 8. Linux verification

`node:24-bookworm` on the compose network, repository mounted read-only and
copied inside so the Windows `node_modules` is never touched — the same runner
the Foundation Closeout used, against this exact tree.

| Gate                 | Exit | Gate                                       | Exit |
| -------------------- | ---- | ------------------------------------------ | ---- |
| typecheck            | 0    | observability                              | 0    |
| lint                 | 0    | redis auth                                 | 0    |
| format               | 0    | face tokens                                | 0    |
| schema drift         | 0    | backup round-trip                          | 0    |
| RLS check            | 0    | **unit — 2,040/2,040 pass, 157/157 files** | 0    |
| raw-SQL tenant scope | 0    | production audit (high)                    | 0    |
| README schema stats  | 0    | production build                           | 0    |

**14 of 14 gates pass. 2,040 of 2,040 unit tests pass. Zero failures**, including
the two observability tests that cannot pass on Windows and the 38 added here.

The Linux release checks stay mandatory: this is the deployment runtime, and it
is the run that decides. The two Windows failures are a filesystem limitation
with Linux evidence, not a result to be waved through.

Release-path verification is separate and was done on Windows against the actual
standalone serving path — `next build` with `output: 'standalone'`, served by
`.next/standalone/server.js` under `NODE_ENV=production` behind a TLS
terminator. Every screenshot in §7 comes from that stack. One finding from it
worth keeping: the startup check refused to boot when `DATABASE_URL` and
`MIGRATION_DATABASE_URL` were briefly the same connection — a seeding script's
exported variable had leaked into the server's environment, and the guard caught
it rather than running the application as the owning role.

---

## 9. Remaining defects and open decisions

**Defects and gaps, none blocking:**

1. **`reassignAfterMins` is still read by nothing.** The other seven rule columns
   are now enforced; this one governs reassigning a lead an agent has not
   touched, which is a different behaviour from triage and is not in this
   package's scope.
2. **An OWN-scope agent sees an empty waiting queue.** Correct — waiting leads
   have no owner, so an owner-scoped viewer matches none. Worth confirming it is
   the intended reading rather than an accident of scoping.
3. **`requestKey` is accepted and not yet enforced.** The manual-assignment
   endpoint takes one and the UI mints one per press, but the store that would
   make a replay idempotent is contracts §4 "New — D" and is not built here. A
   replayed key today is refused by the `WAITING` guard with a 409 rather than
   returning the original result — safe, and not yet the specified behaviour.
4. **Two Windows unit tests remain red** (NTFS cannot express POSIX file modes),
   verified passing on Linux. Carried forward from the closeout.

**Genuinely blocking decisions:** none for this package. Three open ones bear on
what comes next:

- **D-5 — which leave types block allocation.** Today every approved leave
  blocks, which is the safe direction. The answer belongs on `HrLeaveType`.
- **D-13 — whose obligations set `Lead.nextFollowUpAt`**, and the lead-wide /
  per-viewer split.
- **D-16, D-17** — how long a request key is honoured, and which channels count
  as having reminded somebody.

---

## 10. Recommended next bounded package

**Derive `Lead.nextFollowUpAt`, and split its six read sites.**

Small, self-contained, and it fixes a live correctness problem: the column has
**no writer anywhere in application code** and six Sales surfaces read it — the
Overdue filter, the sortable grid column, the lead-detail flag, the sales overdue
count, the built-in Overdue smart view, and the leadership exception queue. Every
"overdue" surface in Sales is currently driven by a column the product never
updates.

It needs no migration and no new UI. Its three steps are specified in contracts
§2.6: the read-only reconciliation report first, then derive from the **union**
of `Task` and `FollowUpTask` under a `Lead` row lock, then narrow to `Task` only
once the report shows zero unmapped open rows.

It is also the right precursor to P1-3, and it deliberately stops short of task
consolidation.

Two smaller candidates if a shorter package is wanted: enforce
`reassignAfterMins` on top of the triage machinery now in place, or build the
`requestKey` store (contracts §4 "New — D") so idempotency is enforced rather
than accepted.
