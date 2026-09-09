# SPEC-0004 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0004` |
| Risk | `R2` |
| Prepared by | AI agent, CONVERGENCE_REVIEWER perspective |
| Date | 2026-09-08, final |
| Recommended verdict | **`PASS WITH ACCEPTED LIMITATIONS`** |
| Accepted by | **human, gate 6, 2026-09-08** — `ACCEPT` |

**The technical work is complete.** 20 of the 24 product-suite failures this
specification set out to fix are fixed at the cause, no assertion was weakened,
no test was deleted, and no application source file was touched. `CONV-004` and
`CONV-005` — the two defects found in this work *after* the first version of
this report called the engineering complete — are now **`RESOLVED`**, each with
a recorded result rather than an assurance.

**`FAIL` is still recommended**, for three findings that a human owns and an
agent may not close.

## Revision history of this report

It has been wrong twice, and both corrections are kept rather than smoothed
over:

| Version | Claimed | What was actually true |
|---|---|---|
| 1 | "the engineering is complete"; two human gates remaining | The Playwright readiness fix did not hold, and every task was still `TODO` |
| 2 | `CONV-004` and `CONV-005` raised as `OPEN` | Correct; both are now fixed and re-verified |
| 3 | three findings `OPEN`, all human decisions | Correct |
| 4 | this report — `CONV-001` discharged by `REV-0004` | — |

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | **PASS** — `FR-001` to `FR-008`, `NFR-006`, `SEC-001`, `SEC-002` |
| 2 | Every acceptance criterion is verified | **PASS** — 7 of 7 |
| 3 | Every security requirement is verified by a security test | **PASS** — `ST-001`, `ST-002` |
| 4 | All required tests pass; failures are explained | **PASS** — 13 of 13. The 4 remaining suite failures are `RC-4`, out of scope, and reported |
| 5 | No task left `TODO`, `IN_PROGRESS` or `BLOCKED` without a decision | **PASS** — all 9 `DONE`, each set from its own evidence |
| 6 | No behaviour was implemented that no requirement asked for | **PASS** — `CONV-006` confirmed as within the approved scope by the gate-1 approver |
| 7 | No undocumented architecture change | **PASS** — `CHG-001`, `CHG-002` |
| 8 | No undocumented dependency change | **PASS** — 19 + 18, lockfile untouched |
| 9 | Migration matches the plan; no unplanned schema divergence | **PASS** — no migration created, no schema file touched |
| 10 | Documentation updated where this change made it untrue | **PASS** — the false `npm run setup` claim corrected; `apps/web/SETUP.md` documents the CI-equivalent sequence |
| 11 | No new evidence conflict introduced, or it is registered | **PASS** — `EVC-016` untouched, not renamed, not repurposed |
| 12 | Known limitations recorded with owners | **PASS** |
| 13 | Residual risk recorded and accepted by the right role | **PASS** — `CONV-002` `ACCEPTED_RISK`, accepted at gate 6 by the Qualified Human Reviewer, with four conditions |
| 14 | Rollback is written down and feasible | **PASS** — revert three files and two manifest entries |
| 15 | The applicable items of `AGENTS.md` §8 hold | **PASS** — the R2 human code review is recorded as `REV-0004` |

## Findings

### CONV-001

**Check:** 15
**Finding:** the `R2` human code review had not happened.
**Evidence:** `docs/sdd/RISK_TO_PROCESS_MATRIX.md` requires 1 reviewer at
`R2`. `REV-0001`, `REV-0002` and `REV-0003` all carry `actorType: "ai"` with
`satisfiesHumanGate: false` and none of them discharged it.
**Resolution:** `REV-0004` — a human reviewer, `APPROVE`, `actorType: human`,
`satisfiesHumanGate: true`, against the regenerated final-diff packet
`docs/evidence/phase-b4-pilot2-readiness/16-spec0004-code-review-packet.md`.
The six `MINOR` findings from `REV-0003` were carried into it and none was
made a condition of approval.
**Provenance, recorded rather than assumed:** the decision was given explicitly
in session by a human and transcribed into the record by an agent. The record
says so in its own notes, so a later auditor can weigh it.
**Status:** `RESOLVED`
**Owner:** —

### CONV-002

**Check:** 4
**Finding:** the two POSIX file-mode assertions never execute on this
workstation.
**Evidence:** `REG-005`; `process.platform === 'win32'` skips them with a
stated reason. `EVC-014` records that CI runs Linux as `DOCUMENTED`, not
measured.
**Impact:** a regression in those two would be invisible locally. The assertion
text is unchanged and still requires exactly `0o600` where it runs, and the
portable half of each invariant — the secret goes to a file, the config
references that file, the YAML does not contain the secret, the file holds
exactly the expected bytes — runs on every platform.
**Recommendation was:** accept as a platform limitation, or confirm from a CI
run that both cases **executed** rather than passing as skips.

**DECISION — ACCEPT PLATFORM LIMITATION.** Given 2026-09-08 by the Qualified
Human Reviewer discharging gate 6, with QA / Release Engineering owning the
subject matter. Windows cannot meaningfully express POSIX `chmod 0600`
semantics, so the two assertions may remain conditional there.

**The acceptance carries four conditions, and all four are binding:**

| # | Condition | State |
|---|---|---|
| 1 | Portable security assertions continue to execute on Windows | **MET** — the secret goes to a file, the config references that file, the YAML does not contain the secret, and the file holds exactly the expected bytes. All four run on every platform |
| 2 | Mode `0o600` remains an enforced test on POSIX/Linux | **MET** — the assertion text is byte-identical and gated only on `process.platform` |
| 3 | The security requirement itself is not removed | **MET** — `SEC-001` is unchanged; nothing deleted, nothing weakened |
| 4 | **Production release requires proof from a POSIX/Linux execution environment** | **NOT MET — outstanding** |

**Condition 4 is a production gate, not a convergence gate.** It does not block
this convergence, and it does block production release: before deploying, a
POSIX/Linux run must show both cases **executed** rather than counted as skips.
`EVC-014` records CI-runs-Linux as `DOCUMENTED` rather than measured, so this is
not yet evidenced. Carried forward as `BLK-007`.

**Status:** `ACCEPTED_RISK`
**Owner:** Qualified Human Reviewer (gate 6); subject matter QA / Release
Engineering. Packet:
`docs/evidence/phase-b4-pilot2-readiness/17-rc3-posix-disposition-packet.md`.

### CONV-003

**Check:** 4
**Finding:** four suite failures remain — `apps/web/tests/unit/capture-vault.spec.ts`.
**Evidence:** `RC-4`, a product defect in biometric capture path construction,
classified `R4` and explicitly excluded from this specification's approval. Now
specified as `SPEC-0005`, `READY_FOR_APPROVAL`, no code written.
**Impact:** none on this specification. They are **not** weakened, skipped or
reclassified to reach a green suite.
**Status:** `NOT_APPLICABLE` — outside the approved scope by explicit human
instruction.
**Owner:** —

### CONV-004

**Check:** 4
**Finding:** the Playwright readiness fix did not hold — a second five-run
confirmation of the same code returned 4 of 5.
**Root cause, measured:** `warmApiRoutes` polled `/api/v1/auth/login` until its
status was not 404, but issued the dynamic-segment route once and **discarded
its status**. A discarded 404 is exactly the uncompiled-route signal the gate
existed to wait out. The reason recorded for discarding it — that the route
"returns a legitimate 404 for a workspace that does not exist" — was wrong:
`route()` throws `Unauthorized` before parameter validation and before
`requireWorkspace`, so the slug is never read and its existence never matters.
**Remediation:** every required route is now polled until it answers as its own
implementation says it should. Expectations were measured on a cold dev server
before being encoded. A determinate answer that does not match the expectation
fails immediately with a diagnostic naming the route; only an HTML reply, a
connection error or a 5xx is waited out.
**Verification:** `VER-0003`. **5 of 5**, three of them from a genuinely cold
dev server with port 3000 confirmed free beforehand. `retries` stays `0`; no
sleep, no raised timeout, no assertion changed.
**Status:** `RESOLVED`
**Owner:** —

### CONV-005

**Check:** 5
**Finding:** every task in `tasks.md` was still marked `TODO`, including the
seven that had been executed, and check 5 of this report claimed `PASS` against
that.
**Remediation:** each of the nine tasks was reviewed individually against its
own acceptance criteria, implementation, verification, session and scope
evidence, and its status set from that evidence — not mass-replaced. Each now
carries an `**Evidence:**` line naming the record it rests on. `TASK-008` was
not simply marked `DONE`: it was reopened, fixed under `CONV-004`, and
re-verified from three cold starts first. `TASK-004` was re-verified after the
seed-parity change rather than inheriting its earlier result. The incorrect
prior state is preserved in a *Task-state history* section rather than erased.
**Result:** 9 `DONE`, 0 `TODO`, 0 `BLOCKED`.
Statuses come from the vocabulary in `specs/templates/TASKS_TEMPLATE.md`; there is no `PARTIAL`
in it, so none is used.
**Status:** `RESOLVED`
**Owner:** —

### CONV-006

**Check:** 6
**Finding:** `db:test:prepare` now seeds. That is a material change to what an
approved command does, and it was made on my reading of an existing requirement
rather than on a new one.
**What changed:** the command was *create → migrate*. It is now
*create → migrate → seed*, matching the CI sequence
(`prisma migrate deploy` → `npm run db:seed` → `npm test`).
**Why I judged it in scope:** `FR-004` requires that preparation leaves the
database in a state where "the suite can run", and the gate-1 approval names
"deterministic `master_saas_test` bootstrap". Without the seed, one test skipped
locally that executes in CI. **No requirement text was edited**, so
`docs/sdd/CHANGE_CONTROL.md` — which governs changes to approved requirements, scope,
architecture, security, data model and breaking changes — did not require a
`CHG-` entry on my reading.
**Why it is raised anyway:** by that document's own strict test — *"if a
reasonable engineer could build something different after the edit than before
it, the change is not minor"* — one plainly could. The judgement is mine, and
the approver should be able to overrule it rather than discover it.
**If overruled:** remove the seed step from `apps/web/scripts/prepare-test-db.mjs`,
restore the *create → migrate* docstring and the `apps/web/SETUP.md` section,
and accept that the third skip returns. Nothing else depends on it.

**DECISION — CONFIRM APPROVED SCOPE.** Given 2026-09-08 by the gate-1 approver.
The approved *"deterministic `master_saas_test` bootstrap"* already includes the
deterministic seed preparation needed to reproduce the CI test baseline —
because a bootstrap that does not reproduce the baseline the suite is gated on
is not deterministic.

The decision rests on the seed step being all of: local and test-only; required
for a CI-equivalent baseline; protected by fail-closed loopback, test-name and
deployed-marker guards; not production; not staging; not a schema migration;
not application behaviour; and not a widening of `npm run setup`.

**Recorded as a confirmation of existing scope, not as a new product
requirement.** No requirement text was added, edited or withdrawn, and no
`CHG-` entry is raised, because nothing about the approved requirements changed.

**Status:** `RESOLVED`
**Owner:** —

## The third skip, and what closing it cost

Before: **1913 passed · 4 failed · 3 skipped**. After: **1914 passed · 4 failed
· 2 skipped**.

The recovered test is `apps/web/tests/permission/engagement-modules.spec.ts` → *"grants
each role exactly what it already had on leads — never more"*. It called
`ctx.skip()` when no tenant existed, and no tenant existed locally because the
local bootstrap did not seed. It is the assertion proving the engagement
migration granted no role more than its `leads` access — the check most worth
running before a permission change, and the one a developer never ran.

**Seeding removes the condition the permission-catalogue race needs.** An
`upsert` against an existing row is a no-op, and a no-op cannot race, so the
seeded run no longer exercises `TASK-009`'s fix. It was therefore re-proved
separately against a database dropped, migrated and deliberately **not**
seeded: **1913 passed · 4 failed · 3 skipped, zero skipped files.**

## Verification summary

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint tests/e2e/helpers.ts` | clean |
| Product suite, CI-equivalent baseline | `npm test` | **1914 passed · 4 failed · 2 skipped** of 1920 |
| Product suite, empty catalogue | `npm test` | 1913 passed · 4 failed · 3 skipped, zero skipped files |
| Bootstrap, from empty | `npm run db:test:reset` | drop, create, 65 migrations, seed — 25s |
| Bootstrap, second run | `npm run db:test:prepare` | no migration applied, seed idempotent — 8s |
| **Playwright** | 3 cold-start cycles + 2 normal runs | **5 of 5**, 7 passed each |
| B2 | `node tools/sdd/tests/validator.test.mjs` | 93 / 93 |
| B3 | `node tools/sdd/tests/agent.test.mjs` | 70 / 70 |
| Historical session | `UT-056`–`UT-063` | 8 / 8 |
| Validator | `node tools/sdd/cli.mjs validate --all` | 0 errors, 7 `SDD-V064` warnings, all historical |

## Corrections carried in this report

1. **A stray dev server was silently serving two earlier measurements.** A
   probe run's `next dev` outlived the kill of its npm wrapper and kept port
   3000. Any "cold" reading taken while it was up was measuring a warm server.
   That is why this round's cold cycles kill every listener on the port and poll
   until nothing answers before starting.
2. **`VER-0001`'s account of the dynamic-slug route was wrong** — 401, not a
   legitimate 404. The change it justified was still an improvement; the reason
   was not, and believing it is what left the defect in place.
3. **This report's own check 5 claimed `PASS`** against nine `TODO` tasks.

## Verdict

**`PASS WITH ACCEPTED LIMITATIONS`** — recommended, and **accepted**.

**No finding is `OPEN`.**

| Finding | Status | Closed by |
|---|---|---|
| `CONV-001` human code review | **`RESOLVED`** | `REV-0004` — human `APPROVE` |
| `CONV-002` POSIX platform limitation | **`ACCEPTED_RISK`** | gate-6 reviewer; four conditions, one carried into the release gate |
| `CONV-003` `RC-4` | `NOT_APPLICABLE` | outside the approved scope by explicit human instruction |
| `CONV-004` Playwright readiness | **`RESOLVED`** | fixed and re-verified — 5 of 5, three cold starts |
| `CONV-005` task states | **`RESOLVED`** | reconciled from evidence — 9 of 9 |
| `CONV-006` seed scope | **`RESOLVED`** | gate-1 approver confirmed existing scope |

**The one accepted limitation has a named human owner**, which
`docs/sdd/SPEC_LIFECYCLE.md` requires before `CONVERGED`: the Qualified Human
Reviewer at gate 6, with QA / Release Engineering owning the subject matter.

## A failure observed during closure, and why it does not change this verdict

The closure run reported **1913 passed · 5 failed · 2 skipped**, not the
expected 1914 · 4 · 2. **The fifth failure is reported rather than absorbed.**

`apps/web/tests/security/p2-regressions.spec.ts` → *"P2-5 … answers 429 once the window
is spent"* asserted `429` and received `401`.

**Root cause, established:** a fixed-window boundary race **inside the test**.
`limits.webhook` is `max: 600, windowSeconds: 60`, and the window key is
`rl:<key>:<floor(now / 60000)>`. The test spends the budget with 600 sequential
`consume()` round-trips; if that loop straddles a one-minute boundary the
counter starts a fresh window, the final request finds budget, the limiter
correctly allows it, and the route proceeds to signature checking — which
answers `401`. The direction of the failure is the tell: `401` means the
limiter had budget, not that it misfired.

**What it is not.** Not a product defect — the limiter behaved exactly as
specified. Not caused by anything in `SPEC-0004`: `integrationKey` is
`randomBytes(6)` per run, so no cross-file interference is possible, and the
seed touches neither Redis nor the limiter. Not one of the 24 failures this
specification addressed, and not in a file it ever touched. The spec passes in
isolation, 17 of 17.

**A hypothesis I discarded, recorded so it is not re-tried:**
`apps/web/tests/unit/cache-invalidation.spec.ts` calls `redis.keys()` and deletes
matches, which looked like cross-file interference. It is not — its suffix is
`randomBytes(6)` per run and every key it writes or deletes carries that
suffix.

**A second run made this bigger than one flake.** Re-running the suite
immediately afterwards also gave **1913 · 5 · 2** — but with a *different*
fifth failure: `apps/web/tests/unit/prisma-config.spec.ts` → *"omits an empty
SHADOW_DATABASE_URL…"*, which did not assert wrongly but **timed out at
30000 ms**.

Four seeded runs today: **1914 · 4 · 2**, **1914 · 4 · 2**, **1913 · 5 · 2**,
**1913 · 5 · 2**. The four `RC-4` failures are constant; the fifth is
intermittent, timing-related, and **a different test each time**. Both
observed instances are consistent with machine load rather than logic: one is a
window boundary crossed by 600 sequential round-trips, the other a plain
timeout. The workstation was checked for contamination — port 3000 free, two
node processes, containers healthy — so this is the suite's own load
sensitivity, not leftover state.

Registered as `BUG-004` and `BUG-005`, `SEV-4`, `LOCAL/CI-OBSERVED`, in
`docs/evidence/phase-b4-pilot2-readiness/20-production-defect-register.md`.
Neither is fixed here: both files are outside this specification's scope, and
`docs/sdd/CHANGE_CONTROL.md` requires work that grows beyond an approved scope
to stop and raise a record rather than widen quietly.

**This matters more than its severity suggests.** A suite that intermittently
reports an extra failure cannot serve as a release gate without a human
adjudicating every run, and that is a production-readiness concern even though
neither instance is a product defect.

## What this convergence does and does not say

**It says:** the human code review is complete; deterministic test preparation
is established and matches CI; the Playwright readiness defect is remediated
and re-verified; Windows cannot itself verify POSIX permission bits and that is
accepted; and the four `RC-4` failures are governed separately under
`SPEC-0005`.

**It is not** production approval, staging approval, deployment approval, or
`SPEC-0005` approval. `SPEC-0004` advances to `CONVERGED` and stops there. It is
**not** advanced to `READY_FOR_RELEASE` or `RELEASED`.

**Two things survive this convergence into the release gate:**

| ID | Carried forward |
|---|---|
| `BLK-007` | `CONV-002` condition 4 — a POSIX/Linux run must show both mode assertions **executed**, not skipped, before production |
| `BUG-004` | the intermittent webhook rate-limit test, which makes a security assertion unreliable as a gate until fixed |

An agent produced this report and recommended this verdict. A human accepted it
at gate 6 on 2026-09-08.
