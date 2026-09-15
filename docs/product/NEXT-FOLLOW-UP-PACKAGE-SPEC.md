# Next package — deriving `Lead.nextFollowUpAt`

> **Superseded 2026-09-11 by
> [`NEXT-FOLLOW-UP-CHECKPOINT.md`](NEXT-FOLLOW-UP-CHECKPOINT.md), which is
> implemented and verified.** Kept for the record. Three things in it turned out
> to be wrong and are corrected there rather than here:
>
> 1. **§3.2 is wrong.** "The lead-wide column carries no new disclosure" is
>    false against this application's own seeded roles — Marketing Manager holds
>    every lead and no `tasks` grant at all.
> 2. **"The six read sites" undercounts.** There are ten, including the CSV
>    export and `filterTree`, which exposed the column as a user-buildable
>    filter.
> 3. **"Five writers" was right, but only by luck** — it was asserted rather
>    than established. The re-taken inventory confirms it, and also finds
>    `update_field`, which writes the derived column directly.

Specification. Nothing here is implemented in the P1-1 completion package, and
no next-follow-up write ships in it.

Prototype work exists on the branch `claude/nextfollowup-wip` (`190bc23`), parked
deliberately and reviewed by nobody. Two of its **measurements** are carried into
this document because they were taken against the validation database rather
than assumed; the code is raw material, not a proposal.

---

## 1. Why this package exists

`Lead.nextFollowUpAt` is declared on `Lead`, indexed, and read by six Sales
surfaces. A search of `src/` for a write finds none — every occurrence is a
`select`, an `orderBy`, a filter predicate or a formatter. Only the seed and the
tests set it.

**Measured on the validation workspace: 446 of 506 leads hold a value that
disagrees with reality**, in both directions — leads showing a follow-up date
with nothing open, and leads with an open obligation showing nothing. Every
"overdue" surface in Sales is driven by that column.

---

## 2. Writer and lifecycle inventory

Taken from the tree, not from memory. **This inventory is a snapshot and must be
re-taken at implementation time**, because §6 turns on it.

### 2.1 `Task` — writers

| Site                                                 | Operation                                   |
| ---------------------------------------------------- | ------------------------------------------- |
| `src/app/api/v1/tasks/route.ts`                      | create                                      |
| `src/app/api/v1/tasks/[id]/route.ts`                 | update — status, `dueAt`, owner, completion |
| `src/services/automation/actions.ts` (`create_task`) | create, from a rule                         |

### 2.2 `FollowUpTask` — writers

| Site                                      | Operation                                  |
| ----------------------------------------- | ------------------------------------------ |
| `src/app/api/v1/follow-ups/route.ts`      | create                                     |
| `src/app/api/v1/follow-ups/[id]/route.ts` | update — including the `RESCHEDULED` stamp |

Five writers in application code. **Neither model has a soft-delete path in a
route**, so `deletedAt` is set only by retention or by hand — which is itself
worth confirming before relying on it.

### 2.3 Lifecycle states, and what "open" means

`TaskStatus` = `OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `RESCHEDULED`,
shared by both models.

> **Open is `OPEN`, `IN_PROGRESS` _and_ `RESCHEDULED`.**

This is a correction to
[`NEXT-ACTION-AND-REMINDER-CONTRACTS.md`](NEXT-ACTION-AND-REMINDER-CONTRACTS.md)
§2.6, whose draft SQL said `status = 'OPEN'`. `api/v1/follow-ups/[id]` stamps
`RESCHEDULED` on any open follow-up whose date moves, so taking the draft
literally would have excluded exactly the obligations most likely to be late.
Four existing readers already use the triple —
`sales/follow-ups/page.tsx:47`, `api/v1/follow-ups/route.ts:45`,
`lib/ai/assistant/tools.ts:634` and `:730`.

`COMPLETED` and `CANCELLED` are closed. A soft-deleted row is closed regardless
of status.

---

## 3. Two views, and the boundary between them

| Question                                              | Value                                         | Where it lives                     | Who may see it                                 |
| ----------------------------------------------------- | --------------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| When is this lead next owed something, **by anyone**? | earliest open `dueAt` across every owner      | the stored column                  | anyone whose lead visibility includes the lead |
| What do **I** do next on this lead?                   | earliest open `dueAt` **owned by the viewer** | computed per request, never stored | the viewer, for their own obligations          |

A lead with a rep's callback due Thursday and a manager's review due Tuesday is
"waiting on us since Tuesday" on an exception queue and "your callback is
Thursday" in the rep's own list. **Rendering the lead-wide number in an agent's
list tells them they are late for somebody else's commitment**, which is the
defect the split removes.

### 3.1 The six read sites, classified

| #   | Site                                                     | View           |
| --- | -------------------------------------------------------- | -------------- |
| 1   | `sales/leads/page.tsx:23` — the Overdue filter           | lead-wide      |
| 2   | `sales/leads/LeadGrid.tsx:389` — the Follow-up column    | **per-viewer** |
| 3   | `sales/leads/[id]/LeadDetail.tsx:179` — the overdue flag | **per-viewer** |
| 4   | `sales/page.tsx:388` — the overdue count                 | lead-wide      |
| 5   | `sales/smart-views/page.tsx:51` — the Overdue smart view | lead-wide      |
| 6   | `services/leadership/rollups.ts:356` — the chasing queue | lead-wide      |

### 3.2 Authorisation

The per-viewer value is derived from obligations the viewer owns, so it discloses
nothing they could not already see in their own task list. **It must not be
computed for an arbitrary `ownerId` supplied by a caller** — that would turn a
personal view into "show me what this colleague owes", which is a different
permission (`leads:VIEW` at TEAM or above) and a different feature. If a
manager's view of a rep's next action is ever wanted, it goes through
`visibilityWhere` like every other cross-person read.

The lead-wide column carries no new disclosure: it is a fact about the lead, and
every site reading it already applies lead visibility.

### 3.3 "Overdue" and "nothing scheduled" are different states

> A lead with **no open obligation** is not overdue. It is unscheduled.

Three states, and every surface must be able to show all three:

| State                     | Lead-wide     | Per-viewer | How it should read                                                                     |
| ------------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------- |
| Something owed, in future | `dueAt` > now | same       | the date, neutral                                                                      |
| Something owed, late      | `dueAt` ≤ now | same       | the date, marked overdue                                                               |
| **Nothing owed**          | `NULL`        | absent     | "no next action" — **never** an overdue style, never an em dash that reads as an error |

Collapsing the third into the second is what a `NOT NULL` column with a sentinel
date would do. Collapsing it into "fine" hides a lead nobody has scheduled
anything for, which is the neglect case the chasing queue exists to catch —
`rollups.ts:356` already handles this by pairing `nextFollowUpAt: null` with an
`slaState` of `BREACHED`/`AT_RISK`, and that pairing must survive.

---

## 4. Both stores stay live

> **The derivation reads the union of `Task` and `FollowUpTask` for the whole
> transition. It is never narrowed while a legacy writer can still create a
> `FollowUpTask`.**

Deriving from `Task` alone would set `NULL` on every lead whose only open
obligation is a `FollowUpTask` — _silently removing real work_ from all six
surfaces. That is worse than the present staleness, which at least errs toward
showing something.

**Measured: 51 open `FollowUpTask` rows on the validation workspace, 0 mapped, 51
unmapped.** Narrowing today would erase every one.

### 4.1 A one-time zero is not a gate

A reconciliation report showing zero unmapped rows means only that no _current_
row is unmapped. The two writers in §2.2 are still live: a report can read zero
at 09:00 and be wrong at 09:01.

**Narrowing to `Task` requires all three, in order:**

1. **No live `FollowUpTask` writer remains.** Both routes removed or rewritten to
   write `Task`. This is a code fact, verifiable by grep and by a test that fails
   if a new writer appears — not a data observation.
2. **Zero unmapped open rows**, sustained across the window in which step 1
   shipped, not sampled once.
3. **A guard that keeps it true**: a check that fails the build if
   `followUpTask.create` reappears anywhere in `src/`, in the shape of the
   existing `check-raw-sql-scope.mjs` gate.

Until all three hold, the union stays. The cost is one extra `UNION ALL` branch
per recompute; the cost of getting it wrong is invisible data loss on every
Overdue screen.

---

## 5. Locking, on every mutation

Under `READ COMMITTED` an aggregate `UPDATE … SET = (SELECT MIN(…))` takes a
snapshot at statement start and takes **no lock** on the obligation rows. Two
recomputes for one lead can interleave and the last writer can store a value
that was already stale. Atomicity of one statement is not isolation from
another transaction.

> **Every mutation that can change a lead's set of open obligations takes a row
> lock on the `Lead` first, and recomputes in the same transaction as the write.**

| Mutation                    | Lock                          | Recompute | Note                                                            |
| --------------------------- | ----------------------------- | --------- | --------------------------------------------------------------- |
| create                      | `Lead` FOR UPDATE             | yes       | may be earlier than the current value                           |
| update `dueAt` (reschedule) | `Lead` FOR UPDATE             | yes       | either direction                                                |
| update `status` → closed    | `Lead` FOR UPDATE             | yes       | may move later, or to `NULL`                                    |
| update `status` → reopened  | `Lead` FOR UPDATE             | yes       |                                                                 |
| soft-delete                 | `Lead` FOR UPDATE             | yes       | the deleted row must be excluded by the same transaction's read |
| move between leads          | `Lead` FOR UPDATE on **both** | both      | ascending id order                                              |

**Ordering, stated once for the whole system:**

- Obligation writes: **`Lead` first**, then obligation rows. Several leads in
  ascending `id` order.
- Assignment writes: **`User` first**, then `Lead` — see
  `services/distribution/eligibility.ts`.
- Therefore an obligation write must **never** take a `User` lock while holding a
  `Lead` lock. If one ever needs both, it adopts the assignment order and this
  section is amended rather than worked around.

`SERIALIZABLE` with bounded retry is an acceptable alternative provided the retry
re-reads everything it depends on. Locking is the default: contention here is
per-lead and low.

### 5.1 The cache needs drift detection

A reconciliation must be able to rebuild the column tenant-wide and **report what
disagreed** before fixing anything, with `apply: false` fixing nothing. A nightly
**report-only** sweep is the canary: every write path recomputes under the lock,
so a non-zero count means a path exists that does not — a new endpoint, a script,
a migration. Auto-correcting would hide exactly that.

---

## 6. Deliverables, in order

1. **Re-take the writer inventory** (§2). It gates everything else.
2. Reconciliation report — read-only, per tenant, mapped/unmapped/ambiguous.
3. Derivation service — union, `Lead` lock, the three open statuses.
4. Wire all five writers, each in-transaction.
5. Split the six read sites (§3.1); add the third state (§3.3).
6. Drift canary, report-only; dry-run and backfill scripts with a repeatability
   check.
7. Behavioural tests, including concurrency across separate connections.

**Out of scope:** task consolidation (P1-3), narrowing to `Task` (§4.1), and any
change to obligation lifecycle semantics.

## 7. Open decisions this package needs

- **D-13** — lead-wide versus personal, now specified in §3 as _both_, kept
  apart. Confirmation that the split is wanted rather than one number.
- **D-14** — whether a lead with nothing open leaves every follow-up surface.
  §3.3 says it becomes "unscheduled", visible and distinct from overdue.
- **D-5** — unchanged and still open; it does not block this package.
