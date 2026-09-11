# Next-follow-up derivation — checkpoint

Branch `claude/restructure-foundation`. Nothing merged, nothing deployed, no
production data touched. No task-store consolidation, no AI features.

---

## 1. The baseline, reconciled

| | |
| --- | --- |
| Starting HEAD | `b5ab575a9832e1f80b4fa4e7606f7fb0b1bbc2d9` |
| **Final SHA** | `9d61108f214ef3bce2a223cd086d14c7f25935c0` |
| **Tested revision** | `9d61108` — the full Linux run below is against this commit, working tree clean |
| The checkpoint's `1a48d458` | `1a48d45 → b5ab575` is **one file, +335 lines, zero code files** — the P1-1 completion checkpoint committing itself. Documentation only, so no test was repeated for it. |
| Reference material | `claude/nextfollowup-wip` @ `190bc23` — 14 files, +1,167/−37. Read, not merged and not cherry-picked. Nothing from it ships here; the implementation below was written against the inventory re-taken in §2. |

### 1.1 The 446/506 figure is historical

**446 of 506 leads with a disagreeing `nextFollowUpAt` was measured before the
prototype's backfill ran, and the backfill has since run.** It is a
**pre-backfill measurement of the validation database**, not the current state
and not evidence about this package.

The current state of `master_suite_val`, measured read-only today: 506 leads,
177 carrying a value, 300 tasks (180 open), 60 follow-ups (51 open), 0 orphans
in either store. Those numbers describe a database somebody already corrected,
which is exactly why none of the verification below depends on them.

### 1.2 What the verification runs against instead

A **fresh database**, `master_suite_nfu`, created and migrated for this package,
plus **synthetic fixtures whose every value is planted deliberately**. Both the
test suite and the reconciliation fixture poison the stored column before
asserting anything about it, so a passing assertion means the code wrote the
value — not that someone had already fixed the data.

Isolation was proved rather than assumed: pointing the override at a database
that does not exist makes the suite fail to connect, which is how I know the
48 passing tests ran where I claim they did. `master_suite_val` was re-measured
afterwards and is byte-identical to before.

---

## 2. Writer and reader maps, re-taken

### 2.1 Writers — the five are the five, and that is now a fact rather than an assumption

Searched for Prisma model writes, raw SQL, dynamic model dispatch
(`(prisma as any)[…]`), nested relation writes, cascade paths, retention,
imports and bulk operations.

| Site | Operation | Recomputes now |
| --- | --- | --- |
| `api/v1/tasks/route.ts` | create | ✔ lead locked, recomputed in the same tx |
| `api/v1/tasks/[id]/route.ts` | update — status, `dueAt`, owner, completion, **move** | ✔ both leads locked ascending |
| `api/v1/follow-ups/route.ts` | create | ✔ |
| `api/v1/follow-ups/[id]/route.ts` | update — including the `RESCHEDULED` stamp, **move** | ✔ |
| `services/automation/actions.ts` (`create_task`) | create, from a rule | ✔ only when the rule fired on a LEAD |
| `prisma/seed/*` | demo data | not wired; seeds write the column directly and are not application code |

**Nothing else writes either store.** No raw `INSERT`/`UPDATE`/`DELETE` names
`Task` or `FollowUpTask` anywhere in `src/`, `scripts/` or `prisma/`; the only
dynamic model accessor (`services/automation/records.ts`) is restricted to
LEAD/OPPORTUNITY/ACCOUNT/CONTACT.

**A sixth writer, of the column rather than the obligations.** `update_field` in
the automation engine passes `spec.field` **unvalidated** to
`updateRecordField`, which writes `{ [field]: value }` on the Lead. A rule
configured with `field: "nextFollowUpAt"` writes the derived column directly and
recomputes nothing. This is left working and is the main thing the drift canary
exists to catch — see §5.

**Moves.** Before this package neither PATCH route accepted `leadId`, so a task
filed against the wrong lead could only be moved by editing the row by hand —
and kept contributing to the wrong lead's date. Both routes now accept it, which
is what makes "handle concurrent moves" a real requirement rather than a
theoretical one.

### 2.2 Readers — the spec said six, there are more

| # | Site | View it now asks for |
| --- | --- | --- |
| 1 | `sales/leads/page.tsx` — filters | scope, or personal for `Overdue · mine` |
| 2 | `sales/leads/LeadGrid.tsx` — Follow-up column + sort | same as the active filter |
| 3 | `sales/leads/[id]` — detail | **personal** ("Your next follow-up") |
| 4 | `sales/page.tsx` — dashboard overdue count | scope |
| 5 | `sales/smart-views/page.tsx` — Overdue, No Next Action | scope |
| 6 | `services/leadership/rollups.ts` — chasing queue | scope, passed in by the caller |
| **7** | `api/v1/leads/export/route.ts` — **CSV filter and column** | scope |
| **8** | `api/v1/leads/route.ts` — v1 list payload | scope |
| **9** | `lib/ai/assistant/tools.ts` — lead search, `getLead`, dashboard | scope |
| **10** | `lib/api/filterTree.ts` — **`nextFollowUpAt` as a user-buildable filter** | withdrawn |

Sites 7–10 were not in the specification's six. Two of them mattered most:

- **The CSV export** carried the unrestricted column straight out of the
  database, which made a file download the easiest way to read a colleague's
  schedule.
- **`filterTree`** exposed `nextFollowUpAt` as a filterable field on saved
  views. A filter is an oracle: compare, read the count, repeat, and a
  colleague's due date falls out in a dozen requests without ever being
  rendered. The field is withdrawn; the two system views are built from the
  viewer's own obligations instead. A saved view still referencing it falls
  through the existing `catch` and shows the unfiltered list — still scoped by
  lead visibility, but no longer filtered. That is a visible behaviour change
  and is listed in §8.

`leadBrief` in the assistant now **fails closed**: without a scoped map it emits
no date at all. That is how the two call sites I had not wired were found — by
the compiler, not by review.

---

## 3. Authorization, and the assumption that was withdrawn

### 3.1 Lead visibility does not authorise the aggregate

The specification claimed the stored column "carries no new disclosure: it is a
fact about the lead, and every site reading it already applies lead visibility."
**That is false against this application's own seeded roles.**

| Seeded role | `leads:VIEW` | `tasks:VIEW` |
| --- | --- | --- |
| Marketing Manager | ORGANIZATION | **no grant at all** → NONE |
| Marketing Executive | TEAM | **OWN** |

`scopeFor` is explicit-grant-or-NONE with no fall-back to the role's
`defaultScope`, so those are the real resolved scopes. For either role the
stored column answers a question about a task they may not open.

### 3.2 The model, stated

> An obligation reaches an aggregate only if the viewer could have seen that
> obligation directly. Lead visibility is applied **on top**, never instead.

- `Task` is gated by `tasks:VIEW` — the module its existing reader uses
  (`lib/ai/assistant/tools.ts`).
- `FollowUpTask` is gated by `leads:VIEW` — the module `api/v1/follow-ups`
  authorises under. The two stores being governed by different modules is the
  application's existing arrangement, not a new one.
- A store whose scope is NONE contributes **nothing**.
- An obligation with no owner (`Task.ownerId` is nullable) reaches a scoped view
  only at ORGANIZATION reach.
- The **stored column stays unrestricted** — it is the cache reconciliation
  compares against — and is read directly by no user-facing surface. Where a
  screen needs to distinguish "nothing scheduled" from "not yours", it uses the
  stored value **as a boolean only**: `stored && !mine`. The date never leaves
  the derivation.

### 3.3 Personal and team, labelled

- **Personal** — the signed-in user's own authorized obligations.
- **Scope** — obligations within their authorized team or organizational reach.

For a rep the two resolve to the same set, so the second chip is offered only to
someone whose reach is genuinely wider — derived from the resolved owner sets,
not from the role name, so a bespoke role gets the right answer. A manager sees
`Overdue · team` and `Overdue · mine` as separate, labelled chips.

**The defect this removes:** an agent selecting "Overdue" and receiving a row
whose own follow-up is in the future because a manager has another overdue task.
Tested directly, at a `now` between the two due dates: the rep's filter returns
0 rows, the director's returns 1.

### 3.4 Three states, and the difference between two kinds of blank

| State | Condition | How it reads |
| --- | --- | --- |
| Overdue | `dueAt < now` | the date, in the one colour on the screen |
| Scheduled | `dueAt >= now` | the date, neutral |
| Not yours | nothing visible open, something open | **"Not yours"** |
| Unscheduled | nothing open at all | **"No next action"** |

One due-time boundary, in one function: **`overdue` is `dueAt < now`, strictly;
an obligation due at exactly `now` is scheduled.** Count, filter, sort,
displayed date and drilldown all use it.

The previous rendering was an em dash for both blanks, in the same grey as every
other empty cell — which is how a lead nobody had scheduled anything for read as
fine. "Overdue" also carries a visually-hidden "(overdue)" so the state is not
colour-only.

**Undated obligations do not exist.** `Task.dueAt` and `FollowUpTask.dueAt` are
both `NOT NULL`, so the count is structurally zero. It is reported anyway, and
asserted, because a schema can change.

**Closed leads.** "No next action" and the chasing queue are restricted to
open-category stages — a won or lost lead with nothing scheduled is finished,
not neglected. The **Overdue** views are *not* stage-restricted, so genuine
outstanding work on a closed lead stays reachable.

---

## 4. The derivation boundary

**Open is `OPEN`, `IN_PROGRESS` and `RESCHEDULED`.** `api/v1/follow-ups/[id]`
stamps `RESCHEDULED` on any open follow-up whose date moves, so the draft SQL in
`NEXT-ACTION-AND-REMINDER-CONTRACTS.md` §2.6 (`status = 'OPEN'`) would have
excluded exactly the obligations most likely to be late. `COMPLETED`,
`CANCELLED` and soft-deleted are closed.

**Both stores stay live.** The derivation reads the union. Narrowing to `Task`
would set `NULL` on every lead whose only open obligation is a `FollowUpTask`,
silently removing real work from every overdue screen.

**Locking.** Every mutation that can change a lead's set of open obligations
takes the lead's row lock first and recomputes in the same transaction. Under
`READ COMMITTED` the `MIN` subquery snapshots and locks nothing, so the
statement is not itself isolation — the lead lock is.

- Obligation writes: **`Lead` first**, then obligation rows; several leads in
  ascending id order.
- Assignment writes: **`User` first**, then `Lead` (`distribution/eligibility.ts`).
- Therefore an obligation write never takes a `User` lock while holding a `Lead`
  lock. Nothing here does.

**Moves** lock both leads ascending and then **revalidate the obligation's
current lead inside the lock**. If it changed under us, the write is refused
with a conflict rather than reaching for a third lock out of order — a
deliberate, visible outcome rather than a deadlock.

**Schema.** `FollowUpTask.leadId` had carried **no foreign key** since it was
introduced, so Prisma could express no relation filter on it and deleting a Lead
left its follow-ups pointing at an id that no longer resolved (`Task` has always
cascaded). The migration adds the relation with `ON DELETE CASCADE` and
**detaches rather than deletes** any orphan: a follow-up whose lead is gone is
still real work in somebody's queue.

**Bounded queries.** Scoped values come from two `groupBy` calls per page, not
one aggregate per row. The chasing queue oversamples to 500 candidates and trims
after deriving, because the stored column is a *lower* bound on any given
viewer's value — ordering by it in SQL and truncating there can drop a lead that
belongs in the viewer's top N. Ties break on lead id; unscheduled sorts last in
both directions.

---

## 5. Reconciliation and drift

**Report first, and there is no scheduled repair.** The canary
(`follow-up-drift-daily`, 03:20) is report-only with no override. Every writer
recomputes under the lock, so a non-zero count means a path exists that does not
— and auto-correcting would hide the one signal that says so. §2.1's
`update_field` is the concrete way that happens.

**A rerun cannot clobber a concurrent write.** The repair does not write the
value it measured; it takes the lock and calls the same `recomputeNextFollowUp`
the application uses, re-deriving from what is committed at that moment.

### Reproducible fixture — planted, then measured

`npx tsx --env-file=.env.test --env-file=.env.test.local scripts/nfu-fixture.ts --apply`

| | measured | planted |
| --- | --- | --- |
| leads | 37 | 37 ✓ |
| agreeing | 16 | 16 ✓ |
| missing | 7 | 7 ✓ |
| stale | 9 | 9 ✓ |
| unexpected | 5 | 5 ✓ |
| open tasks | 9 | 9 ✓ |
| open follow-ups | 19 | 19 ✓ |
| unattached (both stores) | 0 | 0 ✓ |
| ambiguous tasks | 0 | 0 ✓ |
| undated obligations | 0 | 0 ✓ |

| step | result |
| --- | --- |
| dry run | considered 21, **repaired 0**, 21 still disagreeing |
| apply | considered 21, **repaired 21**, **0 disagreeing** |
| rerun | **considered 0** |

Reproduced twice with identical counts. Raw output:
`validation-evidence/next-follow-up/reconciliation-fixture.txt`.

**Unmapped `FollowUpTask` rows are not lost work.** The union includes them, so
they reach every surface. They are reported as a count because narrowing to
`Task` later depends on it — not because anything is currently missing.

### Production rollout — written, not executed

1. Deploy the migration. It adds a foreign key and two indexes; the orphan
   detach runs first and `RAISE NOTICE`s its count.
2. `reportDrift` per workspace, read-only, and keep the output. Expect a large
   `missing` count: the column has never been maintained.
3. Repair **one workspace**, smallest first, with `repairDrift(tenantId, { apply: true })`.
   Confirm `considered` falls to 0 on an immediate rerun.
4. Remaining workspaces in batches, re-reporting between them.
5. Arm the canary and watch for a week. A non-zero count is a missing writer,
   not drift to be swept.
6. **Recovery:** there is nothing to roll back. The repair only recomputes a
   derived column from rows it does not modify, so re-running it after a revert
   restores whatever the obligations say. If the *derivation* itself were found
   wrong, reverting the code and re-running the repair is the whole recovery.

---

## 6. Verification

### Linux — the deployment target, mandatory

| | |
| --- | --- |
| Gates | **13 / 13** — typecheck, lint, format, schema drift, RLS coverage, raw-SQL scope, README counts, observability, redis auth, face token, backup round trip, audit, build |
| Unit suite | **2,118 / 2,118 passed, 159 / 159 files, 0 skipped** |
| Build | `next build`, `output: 'standalone'`, succeeded |

Run in `node:24` on Linux against its own database (`master_suite_linux`), its
own `node_modules` and its own build directory.

Three failures on the first Linux pass were **harness, and are recorded as such
rather than dismissed**: `buildId()` returned `'unknown'` because a git
worktree's `.git` is a file pointing outside the mount; `pooling.spec.ts` reads
`RLS_DATABASE_URL`, which I had not remapped; and `next build` hit `EACCES` on a
`.next` directory created by the Windows build. One skipped test was the demo
seed refusing to run without `ALLOW_DEMO_SEED=yes` — the guard working
correctly. All four are environment, all four were fixed, and the run above is
after fixing them.

### Windows

**2,116 passed / 2 failed** of 2,118. Both failures are
`tests/unit/observability.spec.ts` asserting POSIX file modes (`0o600`) on NTFS,
which reports `0o666`. Both pass on Linux. These are carried forward from P1-1
unchanged.

### The tests bite

| disabled | failures |
| --- | --- |
| derivation (recompute returns the stored value) | **21 of 48** |
| scoping (`obligationAccess` returns unrestricted) | **5 of 48** |

Run against **deliberately poisoned** stored values throughout, so the parked
prototype's earlier backfill cannot conceal a missing implementation.

### What the 48 cover

Lifecycle (all three open statuses, completed, cancelled, soft-deleted,
restored); both stores and the union; the exact-now boundary in both directions;
the three states proved mutually exclusive and exhaustive; every write path
through the **real routes**; moves and detaches; reassignment leaving the
lead-wide value alone; authorization at OWN / TEAM / sub-team / ORGANIZATION /
no-grant, plus cross-tenant; count-filter-date-sort agreement; and concurrency.

**Concurrency, on separate connections** (`Promise.all` over `withTx`, each its
own transaction): concurrent creation in both stores; completion racing
creation; rescheduling racing completion; two moves between the same pair of
leads in opposite directions, asserted not to deadlock; and reconciliation
racing an application write.

### Browser — the standalone artifact under `NODE_ENV=production`

`next start` prints "does not work with `output: standalone`" and serves the
other build, so evidence taken through it is evidence about a different
artifact. These ran against `.next-prod/standalone/server.js` on `:3320` under
`NODE_ENV=production`, behind the TLS terminator on `:3443` — the session cookie
is `secure` in production, so plain HTTP cannot authenticate.

The production startup check refuses mock providers, correctly, so the three are
**configured rather than mocked**: `EMAIL_PROVIDER=smtp` to the local Mailpit
capture, `ANTIVIRUS_PROVIDER=clamav` against the running container, and
`WHATSAPP_PROVIDER=meta` **without credentials**, so an actual send fails loudly
instead of being quietly accepted. It also refused to start until
`TRUSTED_PROXY_CIDRS` named the terminator. Nothing was weakened to get a
screenshot: no certificate verification was bypassed and no TLS was disabled.

Sessions were minted as `PlatformSession` rows the way the test fixtures do. No
password was handled, and none is printed here or in any artifact. Two guards
fired during setup and were satisfied rather than bypassed: the workspace layout
redirected to "set your own password" until the seeded accounts carried a
`passwordChangedAt`, and the startup check refused to boot until the proxy was
named.

#### What the two viewers see, on the same five leads

| Lead | Agent — `leads:OWN`, `tasks:OWN` | Manager — `leads:TEAM`, `tasks:TEAM` |
| --- | --- | --- |
| Hassan Kaddoura — agent's own task, 3 days late | `08 Sept` overdue | `08 Sept` overdue |
| **Layla Farouk — a colleague's task, 5 days late** | **`Not yours`** | **`06 Sept` overdue** |
| Tariq Aziz — agent's own follow-up, due in 4 days | `15 Sept` | `15 Sept` |
| Noor Rahman — nothing open at all | `No next action` | `No next action` |
| Yusuf Demir — follow-up in 2 days, task in 9 | `13 Sept` | `13 Sept` |

The middle row is the whole package in one line. The last row is the union: the
earlier obligation wins across the two stores.

The agent's toolbar carries an unlabelled `Overdue`, because a rep's reach *is*
themselves and two chips would be two names for one list. The manager's carries
`Overdue · team` and `Overdue · mine` as separate, labelled chips. Both carry
`No next action`.

**0px horizontal overflow at 1440×960 and 390×844**, no console errors. The one
colour on the screen is the overdue date; every other state is words. "Overdue"
also carries a visually-hidden "(overdue)", which is how it appears in the
extracted row text above.

Screenshots: `validation-evidence/next-follow-up/leads-{agent,manager}-{desktop,mobile}.png`.

---

## 7. P1-1 limitations, carried forward accurately

### 7.1 Two corrections to the backlog rollout

Both applied in place in `P1-1-COMPLETION-CHECKPOINT.md` §3, marked as
corrections:

1. **`considered > 0` on a rerun is not proof of a broken unique index.** The
   old step 5 said a rerun *must* report `considered=0` and to stop otherwise.
   A workspace taking new leads produces newly eligible ones between two runs,
   so a busy hour would have halted a correct rollout. The real symptom of a
   failed index is two `WAITING` episodes for one lead.

2. **Recovery targets the import batch, not the reason.** The old step 7
   cancelled every `PRE_EXISTING` episode in the workspace with one `UPDATE`,
   which would also close episodes from earlier imports — including ones a
   manager is part-way through. Every entry from a single run shares
   `detail->>'assessedAt'`; that is the batch key. Pending notifications are
   withdrawn in the same transaction; **delivered ones are not**, because a
   delivered notice is a thing that happened. Someone already notified may open
   a lead that is no longer queued and find nothing waiting — visible and
   recoverable, unlike a silently truncated notification history.

### 7.2 Partial-day leave and leave-date timezone semantics

Tracked as a **separate HRMS allocation item**, not touched here. An approved
`HrLeaveRequest` covering any part of a day currently blocks the whole day, so
someone on a morning's leave receives no lead that afternoon. **UTC storage does
not establish correct local calendar-day behaviour** — a workspace at UTC+4
crosses midnight four hours before the stored dates do, so "on leave today" and
"on leave on this UTC date" are not the same set, and no evidence here
establishes which one the allocator should use.

### 7.3 The Windows Redis-contention failure

Recorded here alongside the two filesystem failures, having been omitted from
the P1-1 limitations. `tests/security/p2-regressions.spec.ts` fails on Windows
in a full-suite run on a rate-limit assertion and passes in isolation (17/17).
It is **contention on a shared Redis bucket between concurrently running spec
files**, not a defect in the rate limiter — but it is a real, reproducible
failure of the full Windows run and belongs in the limitations rather than in a
footnote. It did not recur in this package's Windows run; that is one
observation, not a fix.

---

## 8. Remaining limitations

1. **`update_field` can still write `nextFollowUpAt` directly.** The automation
   action takes an unvalidated field name. The canary catches the result; it
   does not prevent the cause. Closing it means validating the field list, which
   is an automation-engine change and out of scope here.
2. **Saved views filtering on `nextFollowUpAt` stop filtering.** The field is
   withdrawn from `filterTree`, so such a view falls through the existing
   `catch` and shows the unfiltered — still visibility-scoped — list. No
   migration rewrites existing saved views.
3. **Grid sorting is page-local.** `LeadGrid` sorts the 50 rows it was given,
   as it did before. Sorting the whole result set by a per-viewer derived value
   needs the ordering pushed into the obligation tables.
4. **The chasing queue oversamples to 500 candidates.** Beyond that many
   chaseable leads for one viewer the trim is approximate. Marked with a
   `ponytail:` comment naming the ceiling.
5. **`services/crm/reminders.ts` is a seventh consumer with a third definition
   of open.** It reads `status = 'OPEN'` only, and only `Task` — so no reminder
   ever fires for a `FollowUpTask`, or for `IN_PROGRESS`/`RESCHEDULED`. Left
   alone deliberately: changing it starts sending notifications that were not
   being sent, which is a behaviour change needing its own decision.
6. **Task PATCH does not call `assertRecordVisible`.** It checks the tenant and
   the reassignment reach, but any caller with `leads:EDIT` can PATCH any task
   in the workspace by id. Pre-existing, adjacent to this work, not fixed here
   because it is an authorization change rather than a derivation one — but it
   is a real finding and should be scheduled.
7. **`Task` can attach to a lead and an opportunity/account/ticket at once.**
   Reported as `ambiguousTasks`; measured 0 on the fixture. The derivation
   counts such a task against its lead.
8. **The follow-up column is hidden on mobile.** `lib/grid/columns.ts` marks
   `nextFollowUpAt` `hideMobile: true`, so a rep on a phone sees the stacked
   card without any of the four states. That predates this package, but the
   column now carries meaning it did not before, which makes the omission worth
   more than it was. The lead detail screen does show "Your next follow-up" on
   mobile, so the information is reachable — it is the grid that is silent.
   Changing it is a layout decision I did not take unilaterally, since the brief
   was to preserve mobile behaviour.
9. **"Not yours" depends on the stored column being current.** The distinction
   between "no next action scheduled" and "somebody else is handling this" reads
   the stored aggregate as a boolean. On a workspace that has not yet been
   reconciled the column is null, and the state degrades to "No next action" —
   under-informative, never wrong, and never a leak. The demo above runs the
   repair first, exactly as rollout step 3 does.
10. **Seeds still write the column directly.** They are not application code and
   the canary will report any workspace seeded that way as drift, which is the
   correct signal rather than a false one.

---

## 9. The next bounded package

**Task-store consolidation (P1-3) is the natural successor, and it is still
gated.** Narrowing the derivation to `Task` requires all three, in order:

1. No live `FollowUpTask` writer remains — a code fact, by grep and by a test
   that fails if a new writer appears.
2. Zero unmapped open rows, **sustained across the window in which step 1
   shipped**, not sampled once. A report can read zero at 09:00 and be wrong at
   09:01 while the two writers in `api/v1/follow-ups` are live.
3. A build-time guard that fails if `followUpTask.create` reappears in `src/`,
   in the shape of the existing `check-raw-sql-scope.mjs` gate.

Until all three hold, the union stays.

Smaller items, in the order I would take them: the `update_field` field
allow-list (§8.1), the Task PATCH visibility check (§8.6), then the reminder
sweep's definition of open (§8.5).

---

## 10. Services left running

| Service | Identity | Removal |
| --- | --- | --- |
| Standalone production server | `node server.js` on `127.0.0.1:3320` | stop the process |
| TLS terminator | `127.0.0.1:3443` (pre-existing, from the Foundation Closeout) | stop the process |
| Validation database | `master_suite_nfu` | `dropdb` as the owning role |
| Linux test database | `master_suite_linux` | `dropdb` as the owning role |
| Docker volumes | `nfu_web_modules`, `nfu_next_build` | `docker volume rm` |

The demo workspaces created for the screenshots (`nfu-demo-*`) and the
reconciliation fixture (`nfu-fixture-*`) are removed with the `--clean` flag on
their own scripts. No credential, session cookie, token or environment file is
in any committed artifact; `**/.env.*.local` was added to `.gitignore` because
vitest prefers that file over `.env.test` and `**/.env.test` did not match it.
