# P1-1 completion checkpoint

|                             |                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Branch                      | `claude/restructure-foundation` (isolated worktree, unpushed)                        |
| Package start               | `4fd90b246f9ca5005eb414b6a91e7c2cc32bdd98`                                           |
| Final SHA                   | `1a48d45817b47a98b690761cfce679344064963c` (plus this document)                      |
| Parked, not in this package | `claude/nextfollowup-wip` @ `190bc23`                                                |
| Not done                    | merged, deployed, production data touched, task consolidation, next-follow-up writes |

---

## 1. Starting point

|                 |                                            |
| --------------- | ------------------------------------------ |
| HEAD at start   | `4fd90b246f9ca5005eb414b6a91e7c2cc32bdd98` |
| Working tree    | clean, 0 entries                           |
| Tested revision | the same tree                              |

**`1524676` vs `4fd90b2` reconciled: documentation only.** `1524676` is the last
commit listed inside the P1-1 checkpoint's own table; `4fd90b2` is that document
committed on top. `git diff 1524676..4fd90b2` = **one file**,
`P1-1-CHECKPOINT.md`, +377 lines, and **zero** files under `apps/`, `prisma/` or
`scripts/`. No test from that package was repeated.

**Next-follow-up work was parked, not discarded.** A prototype existed in the
working tree when this package was requested. It is committed to
`claude/nextfollowup-wip` (`190bc23`) and `claude/restructure-foundation` was
returned to `4fd90b2`. Two of its measurements are carried into
[`NEXT-FOLLOW-UP-PACKAGE-SPEC.md`](NEXT-FOLLOW-UP-PACKAGE-SPEC.md); the code is
raw material and is not proposed for review.

One side effect to record: that prototype's backfill was run against the
isolated validation database, correcting 446 of 506 `Lead.nextFollowUpAt` values.
The column is now more accurate there than it was and nothing maintains it, since
the code is parked. It affects no assertion in this package.

---

## 2. Fixed versus verified unchanged

The instruction was to inspect the code, not the checkpoint. **Three of the
previous checkpoint's claims did not hold.**

### Fixed

| #       | What was wrong                                                                                                                                                                                                                                                                                                                                                                                             | Where                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **§5a** | Bulk allocation filtered on `headroom`, which checks quotas, capacity, `isAvailable` and `onLeaveUntil` — **not** account status, membership, employment, or HR leave. `allocate` would hand leads to a SUSPENDED or DEACTIVATED account. Its count was taken outside the claim transaction and the claim locked only _leads_, so two concurrent allocations to one agent could spend the same slot twice. | `allocation.ts`                   |
| **§5b** | The social path checked `status = 'ACTIVE'` under a comment claiming it re-checked "against eligibility". Somebody whose employment had ended, who was on leave, or who was at capacity passed. Its write was also a separate transaction from the eligibility read.                                                                                                                                       | `assignSocialLead.ts`             |
| **§5c** | **HR records were written into a Sales-readable column.** The triage entry's `detail` JSON carried "approved leave until 2026-09-18" and "employment is terminated" — HR facts, in a column any Sales viewer with queue access could read, with no permission check between.                                                                                                                               | `eligibility.ts`, `assignLead.ts` |
| **§4**  | Notifications were lost on a crash. `notifiedAt`/`escalatedAt` were stamped by a conditional UPDATE and the notification created afterwards; a worker dying in between left the stamp committed, so no later sweep ever picked the row up. The catch-block hand-back only runs when the process survives — precisely the case it was defending. `assignFromTriage` had no recovery at all.                 | `triageQueue.ts`, new `outbox.ts` |
| **§3**  | `requestKey` was accepted and ignored. A lost response then a retry got a 409 saying somebody else had dealt with the lead — a lie about its own earlier attempt.                                                                                                                                                                                                                                          | new `idempotency.ts`              |
| **§2**  | Existing unassigned leads were outside the queue entirely. 32 on the validation workspace.                                                                                                                                                                                                                                                                                                                 | new `triageBacklog.ts`            |
| **§7**  | The worker tests re-implemented the handler bodies beside the real ones — a copy stays green while the original is broken.                                                                                                                                                                                                                                                                                 | `workers/*.ts`                    |
| —       | The three sweeps and outbox delivery span tenants by design, so two test files sharing a database claimed each other's rows. Found by the Linux run; the two failures were opposites, which is interference, not a defect.                                                                                                                                                                                 | optional tenant filter            |

### Verified unchanged and correct

- **`assignLead`** already applied the shared rule under a `User` row lock at its
  write boundary. Confirmed by reading `tryAssign`, not by trusting the note.
- **Episode numbering** (§6) — `MAX + 1` plus the partial unique index behaves
  correctly under three concurrent transactions on separate connections. A
  conflict is reported as `alreadyQueued`, not raised as a server error and not
  a lost episode.
- **Routing accountability** points to an active, authorised person or is flagged
  `routingPolicyMissing` and left visible. No path widens anybody's access.
- **Review timing** stays configuration-driven; nothing invents an SLA.
- CRM, HRMS and the visual work from earlier packages are untouched — no HR
  service, route, permission or token changed.

---

## 3. §2 — existing unassigned leads

Reason `PRE_EXISTING`, its own value rather than a guess at one of the four real
failure codes. Recorded: `openedAt` = when reconciliation found it,
`historyUnknown = true`, and `detail.assessedAt` + `detail.candidates` — the
eligibility picture **as it stands now**, which is a present-tense fact.

Scope uses the lifecycle rules that already exist: `ownerId IS NULL`,
`deletedAt IS NULL`, `LeadStage.category = 'OPEN'` — the same rule `poolDepth`
and `claimForUser` use, so an imported lead is exactly a lead bulk allocation
would hand out. Won, lost and otherwise closed stages are excluded by it.

**Isolated database:**

| Step                | Result                                                     |
| ------------------- | ---------------------------------------------------------- |
| `count` (read-only) | eligible **32**, alreadyQueued 4, closedStage 8, deleted 0 |
| `import --apply`    | considered 32, imported **32**, skipped 0                  |
| re-run              | considered **0**, imported 0                               |
| `count` again       | eligible **0**, alreadyQueued **36**                       |

Counts reconcile exactly: 4 + 32 = 36.

**The UI does not claim a waiting time it does not have.** A reconciled row reads
`Unknown · found 6 min ago`, with "Unassigned before the queue existed — original
reason not recorded" and "Eligibility below was assessed at discovery, not at the
time it went unassigned." A lead unowned for eight months showing "3 min" is
worse than showing nothing, because it looks precise.

### Production rollout procedure — **not executed**

1. **Read-only first.** `tsx --env-file=.env scripts/triage-backlog.ts count`.
   Record the per-tenant numbers. Nothing is written.
2. **Sanity-check the eligible figure** against `poolDepth` for the same tenants;
   a large divergence means the lifecycle assumption needs revisiting before,
   not after.
3. **One workspace first**, smallest eligible count:
   `scripts/triage-backlog.ts import --apply <tenantId>`. Confirm
   `imported + skipped = considered`.
4. **Look at the queue** for that workspace. Confirm reconciled rows read
   "Unknown", not a duration.
5. **Re-run the same command.** On a quiet workspace it reports `considered=0`.

   > **Corrected 2026-09-11.** This step used to say `considered=0` was
   > mandatory and that anything else meant the partial unique index had
   > failed. That is wrong, and following it would stop a correct rollout. A
   > workspace taking new leads produces *newly eligible* ones between the two
   > runs, so `considered > 0` on a rerun is the expected result of a busy hour,
   > not evidence of a broken index.
   >
   > What actually indicates a broken index is `imported > 0` **for a lead that
   > already holds an open episode** — so the check is `already_queued`
   > accounting for every lead the first run imported, and
   > `imported + skipped = considered` still balancing. If a lead appears twice
   > in `LeadTriageEntry` with `status = 'WAITING'`, stop; that is the index
   > failing, and it is a different symptom from a non-zero `considered`.

6. **Remaining workspaces**, in batches, re-running `count` between them.
7. **Recovery**, if wanted: target the batch, not the reason.

   > **Corrected 2026-09-11.** This step used to cancel every `PRE_EXISTING`
   > episode in the workspace with one `UPDATE` on the reason. That is
   > indiscriminate: `PRE_EXISTING` is also the reason carried by any earlier
   > import, so a rollback of this morning's batch would silently close
   > episodes from last month's — including ones a manager is part-way through.
   >
   > Every entry written by a single import run carries the same
   > `detail->>'assessedAt'`, set once per run. That is the batch key, and
   > recovery uses it:
   >
   > ```sql
   > UPDATE "LeadTriageEntry"
   >    SET "status" = 'CANCELLED', "resolvedAt" = NOW(), "resolution" = 'IMPORT_ROLLED_BACK'
   >  WHERE "tenantId" = $1
   >    AND "reason" = 'PRE_EXISTING'
   >    AND "status" = 'WAITING'
   >    AND "detail"->>'assessedAt' = $2;   -- the assessedAt of the run being undone
   > ```
   >
   > **Pending notifications must be handled in the same transaction.** Opening
   > an episode enqueues `triage.opened:<entryId>` in `NotificationOutbox`;
   > cancelling the episode without withdrawing the notice leaves the queue
   > telling people to work leads that are no longer queued. `withdrawNotice`
   > removes `PENDING` rows only — deliberately, because a notice already
   > `DELIVERED` is a thing that happened and deleting it would make the record
   > lie. So the honest description of a rollback is: pending notices are
   > withdrawn, delivered ones are not, and anyone already notified may open a
   > lead that is no longer in the queue and find nothing waiting. That is
   > recoverable and visible; a silently truncated notification history is not.
   >
   > No lead row is touched by the import, so there is nothing else to undo.

Note for step 6: `skipped` is expected to be non-zero on a busy workspace — a
lead assigned between the scan and the write is skipped and counted under
`changed_since_scan`. That is the transactional re-check working.

---

## 4. §3 — idempotency

Three questions, three mechanisms: identity `(tenantId, operation, requestKey)`;
sameness a fingerprint of the inputs **plus the actor**; subject a `scopeRef`
carrying the episode.

- Same key, same request → the original result, `alreadyResolved: true`.
- Same key, different assignee → **409**.
- Same key, different actor → **409**, even when every input matches.
- Same key, later episode → **409**; the lead stays waiting.
- No key → unchanged behaviour.

**Authorization runs before the lookup.** A viewer without `leads:ASSIGN` holding
a recorded key gets **403**, not a free result. The record is a result cache,
never an authorization cache.

**Recorded in the same transaction as the assignment**, so a result cannot exist
without its effect. A crash before that commit leaves neither and the retry
legitimately re-runs.

**Retention and expiry.** The default window is **24 hours** and is a _technical_
retry window, not a business retention period — the durable record of what
happened remains the assignment history and the audit log, which have their own
retention. Expiry cannot make anything unsafe: an expired key is unknown, an
unknown key is treated as new, and a new request meets the operation's own guards
and is refused there. Tested: after forcing expiry, a replay returns **409 from
the episode guard** and the assignment history still shows exactly one row.

**The lost-response case is tested end to end**: commit, response discarded,
retry with the same key → the original result, and one `LeadAssignmentHistory`
row.

---

## 5. §4 — notification crash recovery

The decision to notify is committed **with** the business change as a
`NotificationOutbox` row; delivery is a separate resumable step. A crash leaves
either no change and no notice, or a change and a pending notice — never a change
and nothing.

The claim is a **lease**, not a flag: a worker that dies mid-delivery lapses
rather than stranding the row forever, which is the original bug wearing a
different column name.

| Scenario                                                  | Result                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Crash after assignment commit, before notification        | recovered — 0 notifications immediately, 1 after `deliverOutbox`                                                |
| Crash after escalation claim, before notification         | recovered — the alert is delivered by a later pass                                                              |
| Three concurrent deliveries                               | **one** notification                                                                                            |
| Delivery succeeds, persistence fails                      | not reachable in-app: the `Notification` row and the `DELIVERED` stamp are one transaction against one database |
| Assignment resolves an episode with an escalation pending | the undelivered escalation is **withdrawn**; a delivered one **stands**                                         |

**What is claimed, precisely.** In-app is **exactly-once**. External channels —
email, push, WhatsApp — are **at-least-once**: they acknowledge to a provider,
not to this database, so a crash between the provider accepting and the attempt
being recorded produces a retry the provider already took. **A duplicate email
is possible and acceptable; a lost one is not.** Nothing in the code, the tests
or the UI claims exactly-once delivery.

---

## 6. §5 — allocation and HR privacy

**All three paths now call the shared rule at their final write boundary, under
the user's row lock**, in the subsystem's order (`User`, then `Lead`, users
ascending).

Privacy: HR-sourced blockers — approved leave, employment status, marked
unavailable — collapse to one word, **"unavailable"**. One entry however many HR
reasons there were, because three of them is itself a disclosure. Operational
blockers survive intact: a quota or capacity figure is a Sales fact a manager
cannot act without.

**Redacted before it is persisted, not before it is rendered.** A redaction
applied only at render time is one somebody eventually forgets, and the row
outlives the screen. Verified on the built page: **0 occurrences** of any leave
or employment string across the whole queue.

Tested with a **real team-scoped manager**, not a workspace administrator: a
`leads:VIEW` at `TEAM` scope sees their team's waiting leads and not another
team's.

**Leave boundaries** are compared as instants in UTC, which is what the columns
hold — a workspace's display timezone changes rendering, never the decision.
Asserted the day before a leave window (eligible), during it (blocked) and
immediately after it (eligible). **Partial-day leave is not supported by the
decision**: `HrLeaveRequest.halfDay` exists and the comparison is date-range
only, so a half-day leave blocks the whole day. Recorded as a limitation rather
than silently rounded.

**Unresolved policy, still explicit:** which leave _types_ block allocation is
D-5 and remains open. Every approved leave blocks today, which is the safe
direction; the answer belongs on `HrLeaveType`.

---

## 7. §6 — episode concurrency

Three transactions on **separate connections** opening an episode for one lead
simultaneously produce **one** row. The losers are reported as `alreadyQueued`,
which is what they are — not a silently dropped episode and not an unexplained 500.

Re-entry after resolution numbers correctly under concurrency: episodes `[1, 2]`,
the first `ASSIGNED`, the second `WAITING`.

The invariant **an owned lead never carries a `WAITING` episode** is raced for
real — an import running concurrently with four assignments — and asserted over
the whole table rather than one row. The stale sweep is the second line of that
defence and is tested separately.

---

## 8. Tests, gates and evidence

```bash
npx vitest run tests/sales/triage-completion.spec.ts   # 30 — this package
npx vitest run tests/sales/lead-triage.spec.ts         # 35
npx vitest run tests/sales/lead-triage-worker.spec.ts  # 3 — registered dispatch
npx vitest run tests/sales/                            # 405
npx vitest run                                         # everything
tsx --env-file=.env scripts/triage-backlog.ts count
```

| Run                         | Result                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `triage-completion.spec.ts` | **30 passed**                                                                                                                  |
| All `tests/sales/`          | **405 passed**                                                                                                                 |
| **Linux — 14/14 gates**     | typecheck, lint, format, schema drift, RLS, raw-SQL scope, README, observability, redis auth, face, backup, unit, audit, build |
| **Linux — unit**            | **2,070 / 2,070 passed, 158/158 files**                                                                                        |
| Windows — unit              | 2,067 passed, 3 failed                                                                                                         |

**The three Windows failures**, all pre-existing or environmental:

- 2 × `observability.spec.ts` — POSIX file modes NTFS cannot express. Passing on
  Linux (`17-observability` exit 0). Carried forward from the Foundation
  Closeout.
- 1 × `p2-regressions.spec.ts` — a rate-limit test that **passes in isolation
  (17/17)** and fails only under full-suite load, sharing Redis buckets. Not a
  regression from this package.

**Each fix proven against its defect**, by disabling it and re-running: with the
idempotency lookup disabled **1 fails**; with redaction disabled **2 fail**; with
the outbox disabled **2 fail**. Restored, all 30 pass.

Two existing tests were **updated, not weakened**: deciding and delivering are two
steps now, so they run the delivery and assert the same counts — three sweeps
still produce exactly one alert.

**Screenshots** (`validation-evidence/p1-1-completion/`) — only where the UI
changed:

| File                           | What it shows                                                                |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `reconciled-queue-desktop.png` | 36 waiting leads, 32 of them reconciled, reading "Unknown · found 6 min ago" |
| `reconciled-queue-mobile.png`  | the same at 390×844                                                          |

Both: **0px horizontal overflow, 32 "Unknown" cells, 32 discovery hints, 0 HR
leaks.**

---

## 9. Remaining limitations

1. **Partial-day leave is not honoured** by the allocation decision.
   `HrLeaveRequest.halfDay` exists; the comparison is date-range only, so a
   half-day blocks the whole day. Safe direction, and a real limitation.
2. **D-5 remains open** — which leave types block allocation. Every approved
   leave blocks today.
3. **`reassignAfterMins` is still read by nothing.** The other seven
   `DistributionRule` columns are now enforced; this one governs reassigning an
   untouched lead, which is a different behaviour and out of scope here.
4. **The idempotency window is 24 hours** and is technical, not a business
   retention decision. Somebody should confirm it (D-16).
5. **External delivery is at-least-once** and cannot be made otherwise from
   here (§5).
6. **Two Windows unit tests remain red** for a filesystem reason, with Linux
   evidence.
7. **An OWN-scope agent sees an empty waiting queue** — correct, since waiting
   leads have no owner, but worth confirming it is the intended reading.
8. **The backlog import assesses eligibility once per run**, not per lead. On a
   very large workspace the assessment could age during a long run; the entries
   carry `assessedAt` so the staleness is visible rather than hidden.

**No blocking decisions.**

---

## 10. Next package

[`NEXT-FOLLOW-UP-PACKAGE-SPEC.md`](NEXT-FOLLOW-UP-PACKAGE-SPEC.md) — deriving
`Lead.nextFollowUpAt` and splitting its six read sites. Specification only.

Its two load-bearing measurements, taken against the validation database:

- **51 open `FollowUpTask` rows, 0 mapped, 51 unmapped.** Narrowing the
  derivation to `Task` alone would erase every one from every Overdue surface.
- **446 of 506 leads** hold a stored value that disagrees with the union, in both
  directions.

And its firmest rule, which the brief asked for explicitly: **a one-time
zero-unmapped report is not a gate.** Narrowing requires no live `FollowUpTask`
writer, a sustained zero, and a build-time guard that fails if a writer
reappears — because a report can read zero at 09:00 and be wrong at 09:01 while
two writers are still live.
