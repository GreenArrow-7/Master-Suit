# Production readiness — executive summary

| Field | Value |
|---|---|
| Prepared for | the 8 PM call |
| Date | 2026-09-08, revised after SPEC-0004 closure |
| Prepared by | AI agent |
| Overall | **RED — not ready for production deployment** |

## Since the last revision — agentic engineering pass

**`BLK-008` is CLOSED.** Both intermittent failures were root-caused from
source and repaired under `SPEC-0006` (`R1`, tests only). Three consecutive
full-suite runs now give **1914 · 4 · 2** with an identical failing set — the
four `RC-4` tests and nothing else. No test was weakened, skipped, retried,
slept on, or given a longer timeout, and no product code changed.

**`BLK-007` moved from "no evidence" to "one CI run from complete."** On real
Linux the two POSIX cases **execute** (20 tests vs 18 on Windows) and the
property they assert **holds** (`mode=600` on both secret files). What is still
missing is a single vitest report showing those two named cases executed *and*
passed — a mechanical gap that one `verify` run on `main` closes.

**Two blockers remain untouched because they need authorization, not
engineering:** production diagnostics and everything downstream of them.

## Earlier revision

`SPEC-0004` is **`CONVERGED`** — human code review `APPROVE` (`REV-0004`), both
remaining findings dispositioned by a human, gate-6 acceptance recorded, verdict
`PASS WITH ACCEPTED LIMITATIONS`. That is the whole of the governance backlog on
that specification cleared.

Two things got **worse**, and both are reported rather than absorbed:

- **The suite is not a reliable gate.** Two of four seeded runs today produced
  one extra intermittent failure, a *different* test each time — `BUG-004`
  (a fixed-window race in a webhook rate-limit test) and `BUG-005`
  (a 30-second timeout). Neither is a product defect; together they mean the
  regression baseline is a range, not a number. New blocker `BLK-008`.
- **A condition rode out of convergence into the release gate.** The POSIX
  acceptance is conditional on proof from a POSIX/Linux run. New blocker
  `BLK-007`.

One thing got **better with evidence**: `EVC-004` (C4, tenant isolation) now has
a runtime measurement — 181 tenant-owned tables RLS-enabled, FORCED and
policied — which favours the code over the stale `docs/RLS-ROLLOUT.md`.

**The headline.** The engineering is in good shape: the build passes, the suite
is at 1914/1920 with every failure accounted for, and the test harness is
deterministic for the first time. **None of that is a production-readiness
statement.** No production or staging system has been observed, backup
capability is contradicted by its own documents, and two human gates remain
undischarged. The correct answer tonight is *not ready*, and the reasons are
specific rather than cautious.

## Status by area

| # | Area | Status | Basis |
|---|---|---|---|
| 1 | Human code review | **GREEN** | **Performed and APPROVED** — `REV-0004`, `actorType: human`, `satisfiesHumanGate: true`. `CONV-001` `RESOLVED` |
| 2 | `SPEC-0004` | **GREEN** | **`CONVERGED`** — `PASS WITH ACCEPTED LIMITATIONS`, human gate-6 acceptance recorded. 0 findings `OPEN` |
| 3 | Product test baseline / release gate | **GREEN** | **1914 · 4 · 2, three consecutive runs, identical failing set.** `BLK-008` CLOSED. The 4 are `RC-4`; the 2 skips are the POSIX-only assertions |
| 4 | Remaining known bugs | **AMBER** | 5 evidenced: `BUG-001` (SEV-3/R4, open), `BUG-002`/`BUG-003` (SEV-4, open, governance-tooling), `BUG-004`/`BUG-005` (SEV-4, **FIXED**) |
| 4b | Linux/POSIX security proof | **GREEN** | **`BLK-007` CLOSED.** Both named cases executed and passed on Linux x86_64, node v24.20.0 — 20 passed vs 18 on Windows. `CONV-002` condition 4 met |
| 5 | `RC-4` / `SPEC-0005` | **RED** | `READY_FOR_APPROVAL`, R4, **not implemented**. All four gate *roles* are now named — gates 1, 2, 3, 5 all still `UNRESOLVED`, 0 approvals recorded. Blocked on four signatures, not on engineering |
| 6 | Production defects discovered | **RED** | **Zero — because production was never observed.** `BLK-003` |
| 7 | Production defects fixed | **RED** | Zero. None could be identified, so none could be fixed |
| 8 | Defects blocking release | **RED** | 6 blockers, `BLK-001`–`BLK-006` |
| 9 | Staging | **RED** | Configuration exists (`docker-compose.staging.yml`, `Caddyfile.staging`); **no verified running instance**, and no evidence it reproduces production. `BLK-006` |
| 10 | Security | **AMBER** | No control weakened; `EVC-004` now has runtime evidence — 181 tables RLS-enabled, FORCED, policied — but only locally, and it is not closed; `RC-4` carries a real biometric-retention exposure; `BUG-004` makes one security assertion unreliable |
| 11 | Rollback readiness | **RED** | `SPEC-0004`'s own rollback is trivial and written down. **Platform rollback is not**: `EVC-005` is `OPEN` and **release-blocking**, and backup/restore is the thing that decides whether a bad deploy is recoverable |
| 12 | Production deployment authorization | **RED** | **NOT AUTHORIZED.** No approver, no window, and the gates below are unmet |

**GREEN: 4 · AMBER: 4 · RED: 5.**

**Every remaining blocker now needs a human decision or an authorization — not
engineering.** `BLK-009` is a policy answer; `BLK-005` is four signatures;
`BLK-001`, `BLK-002`, `BLK-003`, `BLK-006` all need production or staging
access this workstream does not hold. There is no engineering task an agent can
pick up without one of those.

## What is genuinely good

Worth saying plainly, because "RED overall" should not erase it:

- `npm run build` compiles clean, 86 static pages, exit 0.
- `tsc --noEmit` clean; `lint` 0 errors.
- Product suite **1914 passing**, up from 1892 at the start of this workstream,
  with **zero skipped files** and every remaining failure explained.
- Playwright **5 of 5**, three runs from a confirmed-cold server — the first
  time this suite has been trustworthy as a gate.
- Local test preparation now matches CI, recovering an authorization assertion
  that had been silently skipping.
- Framework: B2 93/93, B3 70/70, validator 0 errors.

## The six blockers

| ID | Blocker | Owner |
|---|---|---|
| `BLK-001` | Backup/restore capability contradicted by its own documents — `EVC-005`, **release-blocking**, `OPEN` | DevOps / Production Engineering |
| `BLK-002` | RLS rollout document contradicts migrations and gates — `EVC-004`, **C4** | Application Security |
| `BLK-003` | No authorized production or staging evidence access | DevOps / Production Engineering |
| `BLK-004` | `SPEC-0004` not converged — `CONV-002` and `CONV-006` still open; `CONV-001` discharged by `REV-0004` | Qualified Human Reviewer; Product Owner |
| `BLK-005` | `RC-4` unremediated, R4 gates undischarged | Product Owner + Solution Architect + Application Security |
| `BLK-006` | Staging not verified to exist or to reproduce production | DevOps / Production Engineering |
| ~~`BLK-007`~~ | ~~POSIX/Linux proof~~ — **CLOSED**, both cases executed and passed on Linux | — |
| ~~`BLK-009`~~ | ~~Gate 5 names no functional role~~ — **CLOSED**. `EVC-018` `RESOLVED`: gate 5 is the **Solution Architect**, now named in the standard and the risk matrix | — |
| ~~`BLK-008`~~ | ~~The regression suite is not a reliable release gate~~ — **CLOSED**, three consecutive clean runs | — |

## Production deployment gate — Part K checklist

| Requirement | State |
|---|---|
| Approved scope | ✅ gate-1 approval recorded |
| Final reviewed diff | ✅ `REV-0004`, human `APPROVE` against the regenerated packet |
| CI green | ⚠️ not observed — `gh` unauthenticated here; local equivalents pass except `format:check` |
| Required tests green | ⚠️ 4 known failures, all `RC-4`, explicitly excluded |
| Staging green | ❌ no verified staging |
| Security gate green | ⚠️ local suites pass; `EVC-004` open |
| DB impact known | ✅ none — no schema change, no migration |
| Migrations reviewed | ✅ none created |
| Backup status known | ❌ **contradicted** — `BLK-001` |
| Restore strategy known | ❌ same |
| Rollback procedure tested | ❌ not from here |
| Monitoring ready | ⚠️ Prometheus/Alertmanager configured; not observed running |
| Health checks ready | ⚠️ configured; not observed |
| Release owner identified | ❌ |
| Deployment window approved | ❌ |
| Production approver approves | ❌ |

**5 met, 5 partial, 6 unmet. Deployment must not proceed.**

## What would move this forward, in order

1. ~~Human code review of the final `SPEC-0004` diff~~ — **DONE**, `REV-0004`,
   human `APPROVE`, 2026-09-08. `CONV-001` `RESOLVED`.
2. **Two dispositions** — `CONV-002` (POSIX limitation) and `CONV-006` (should
   `db:test:prepare` seed?). Packets `17-…` and the convergence report.
3. **Gate-6 convergence acceptance** by a Qualified Human Reviewer → `SPEC-0004`
   `CONVERGED`.
4. **Authorize read-only production diagnostics** — the 11-item checklist in
   `20-production-defect-register.md`. This is what turns "zero production
   defects observed" into an actual answer, and item 10 settles `BLK-001`.
5. **Settle `EVC-005`** — the release-blocking backup contradiction. Until this
   is closed, a production deploy has no proven recovery path.
6. **`SPEC-0005` R4 gates** — packet `19-spec0005-r4-approval-packet.md`, plus
   the count-only assessment in `18-…` if authorized.
7. **Stand up or verify staging**, then deploy there first.

Steps 1–3 need only a reviewer's time. Step 4 needs one authorization. Step 5
is the one with real work behind it.

## The sentence that matters

**Do not say production ready.** Six blockers are open, one of them
release-blocking and already registered as such, and the production environment
has not been looked at. Tonight's honest position is: *the codebase is in the
best measured state it has been in this workstream, and we have not yet looked
at production at all.*
