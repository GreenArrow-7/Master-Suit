# SPEC-0004 — human code review packet

| Field | Value |
|---|---|
| Specification | `SPEC-0004` — cross-platform test determinism |
| Risk | `R2` |
| Gate | human code review — **1 reviewer** (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, R2 row) |
| Author | AI agent, Planner role — authorship unchanged |
| Base commit | `f16ed677516fb07f31832a5d725e13efb477c34d` |
| Date | 2026-09-08 |
| Packet version | **2 — regenerated against the final diff** |

**This replaces version 1**, which was written before the `CONV-004`,
`CONV-005` and seed-parity rework. Three files changed after it: one was
rewritten, one gained a step, one gained a section. Reviewing version 1 would
have been reviewing code that no longer exists.

**This packet asks for one thing: a human reads the diff and approves or
requests changes.** `REV-0001` and `REV-0002` exist, both returned `APPROVE`,
and both carry `actorType: "ai"` with `satisfiesHumanGate: false`. Neither
discharges this gate, and neither is offered as though it does.

## What the change is

Twenty of twenty-four product-suite failures fixed **at the cause**, on a
Windows workstation where `core.autocrlf=true`. No assertion was weakened, no
test deleted, no file skipped.

| Root cause | Failures | State |
|---|---|---|
| RC-1 CRLF text scanning | 17 | fixed |
| RC-2 path separator in a test helper | 1 | fixed |
| RC-3 POSIX file mode | 2 | platform-gated — `17-rc3-posix-disposition-packet.md` |
| RC-4 biometric capture path | 4 | **not fixed** — `R4`, excluded by explicit human instruction, now `SPEC-0005` |

## The ten files

### Group A — TEST (6 files, +275 / −12)

Where a reviewer's attention is worth most: a test edit is the one change that
can quietly reduce what is being checked.

| File | +/− | Task | Requirement | What changed |
|---|---|---|---|---|
| `apps/web/tests/unit/env-example-parses.spec.ts` | +5 / −1 | `TASK-001` | `FR-001` | splits on `/\r?\n/` instead of `\n` |
| `apps/web/tests/security/assistant-guardrails.spec.ts` | +29 / −2 | `TASK-001` | `FR-001`, `SEC-002` | newline-agnostic body delimiter; **new** `ST-002` bounding the extracted body |
| `apps/web/tests/unit/observability.spec.ts` | +35 / −2 | `TASK-001`, `TASK-003` | `FR-001`, `FR-003`, `SEC-001` | two POSIX file-mode cases gated behind `itPosix`; comparison normalised to LF |
| `apps/web/tests/security/guarded-prologue.spec.ts` | +22 / −2 | `TASK-002` | `FR-002` | separators normalised once at the boundary; **new** `REG-004` |
| `apps/web/tests/helpers/fixtures.ts` | +27 / −5 | `TASK-009` (`CHG-002`) | `FR-004`, `AD-005` | `ensurePermission` catches `P2002` and re-reads |
| **`apps/web/tests/e2e/helpers.ts`** | **+157 / −0** | `TASK-008` (`CHG-001`) | `FR-008`, `NFR-006` | **rewritten this round** — see below |

**Security relevance.** `assistant-guardrails` and `guarded-prologue` are
security tests; `observability` asserts secret-file handling; `fixtures.ts`
builds the permission catalogue the RBAC suites derive their actors from.

**Verification.** `REG-001`–`REG-005`, `ST-001`, `ST-002`, `IT-006` — all PASS
(`VER-0001`, `VER-0003`).

#### `tests/e2e/helpers.ts` — the file that changed most

Version 1 of this packet described a probe that gated on one route and fired a
second once, **discarding its status**. That is the defect `CONV-004` records:
a discarded 404 is exactly the uncompiled-route signal the gate exists to wait
out, and run 4 of a second five-run confirmation hit it.

It now polls **all four** required routes until each answers as its own
implementation says it should. The expectations were measured on a cold dev
server before being encoded:

| Probe | Ready response | Why |
|---|---|---|
| `GET /api/v1/auth/login` | `405`, no body | POST-only route; 405 proves the module was matched and its exports read |
| `GET /api/v1/workspaces/readiness-probe/identity/self/password-change` | `401 application/problem+json` | `route()` refuses before the slug is read |
| `GET /api/v1/platform/workspaces` | `401 application/json` | platform-owner route |
| `GET /api/v1/workspaces/readiness-probe/hr/departments` | `401 application/problem+json` | `route()` refuses before the slug is read |

**Questions worth asking:**

- Is this a readiness condition rather than a retry? (`retries` stays `0`; no
  sleep; no raised timeout; the deadline is the probe's own.)
- Is `readiness-probe` a fake workspace the probe depends on? **No** —
  `handler.ts` throws `Unauthorized` at step 3, before parameter validation at
  step 4 and before `requireWorkspace`. The slug is never read. The comment in
  the file says so, and the previous, wrong belief that it *was* read is what
  left the defect in place.
- Does an unexpected answer hang? No — a determinate answer that does not match
  fails immediately naming the route; only HTML, a connection error or a 5xx is
  waited out.

#### `tests/helpers/fixtures.ts` — still the highest-value target in this group

This is the permission catalogue the RBAC suites build their actors from. A fix
that widened a grant would make many authorization tests pass for the wrong
reason. The claim is that only the failure mode changes: the loser of the
`(module, action)` race re-reads the winner's row instead of throwing. **Worth
checking directly rather than accepting.**

Note that seeding now removes the empty catalogue this race needs, so it was
re-proved against a deliberately **unseeded** database: 1913 passed, 4 failed,
3 skipped, zero skipped files.

### Group B — SCRIPT (2 files, +15 / −3, plus 224 new lines)

| File | +/− | Task | Requirement | What changed |
|---|---|---|---|---|
| `apps/web/scripts/prepare-test-db.mjs` | **new, 224 lines** | `TASK-004` | `FR-004`, `FR-005`, `FR-006` | deterministic bootstrap; **now also seeds** |
| `apps/web/scripts/generate-secrets.mjs` | +15 / −3 | `TASK-005` | `FR-007` | corrected a false claim in its own output |

**What to check in `prepare-test-db.mjs`**, in this order — it is the only file
in the change that can destroy data:

1. **It refuses anything that is not a loopback test database.** Loopback host
   from a three-literal allowlist; the database name must match `/test/i`; any
   `prod`/`staging`/`stage`/`live` marker is refused. These checks run **before**
   anything else, including the seed.
2. `db:test:prepare` **never drops**; `db:test:reset` announces the drop by name.
3. **New this round: it seeds.** It answers `ALLOW_DEMO_SEED=yes` on the
   operator's behalf, only after the checks in (1) pass. The seed keeps its two
   other independent gates (`NODE_ENV`, `APP_ENV`) and this passes neither.
   **This is `CONV-006`** — a scope judgement the approver may overrule.
4. **It passes `.env.test`'s values into the seed's environment.** Without
   that, `npm run db:seed` reads `.env` and seeds `leadflow` — migrating one
   database and seeding another, silently. `dotenv` does not overwrite an
   already-set variable, which is what makes the target unambiguous.
5. **No credential is printed.** The seed ends by printing a banner containing
   the demo password shared by every seeded account, so its output is captured
   (`stdio: ['ignore','pipe','pipe']`) and is **not echoed even on failure** —
   the failure path tells the operator to run the seed directly instead. This
   was `REV-0002/RF-004`, `MAJOR`, found and fixed before that review closed.
6. `adminUrl.search = ''` — `psql` rejects Prisma's `?schema=`.
7. Prisma and `tsx` are invoked as `node <cli>` because Node refuses to spawn a
   `.cmd` with `shell: false` on Windows (`EINVAL`) — the exact platform this
   script exists to support.

### Group C — DOC (1 file, +47 / −0)

| File | +/− | Task | Requirement | What changed |
|---|---|---|---|---|
| `apps/web/SETUP.md` | +47 / −0 | `TASK-004`, `TASK-005` | `FR-004`, `FR-007` | documents both commands, and the CI-equivalent sequence |

The correction that matters is in Group B: `generate-secrets.mjs` told the
reader to run `npm run setup` to prepare the test database, and `npm run setup`
did not do that.

New this round: `SETUP.md` states the CI ↔ local mapping and **warns against
substituting a bare `npm run db:seed`**, which would seed the wrong database.

### Group D — HARNESS (1 file, +3 / −1)

| File | +/− | Task | Requirement | What changed |
|---|---|---|---|---|
| `apps/web/package.json` | +3 / −1 | `TASK-004` | `FR-004`, `FR-006` | adds `db:test:prepare` and `db:test:reset` |

**Unchanged this round.** The seed step went inside the script, so no script
entry moved. `apps/web/playwright.config.ts` was **not** modified: `retries`
stays `0` and no timeout was raised.

### Group E — GOVERNANCE / TRACEABILITY (not code)

`specs/SPEC-0004-cross-platform-test-determinism/` — `spec.md`, `plan.md`,
`tasks.md`, `test-plan.md`, `traceability.md`, `change-record.md`,
`convergence.md`, and `execution/`: `ASES-0001`–`ASES-0012`, `VER-0001`–
`VER-0003`, `REV-0001`–`REV-0002`.

Not part of the code review, but the place to check that the claims below are
recorded rather than asserted.

## Explicit confirmations

| Claim | State | How to check |
|---|---|---|
| No `apps/web/src/` application code changed **by this specification** | **CONFIRMED** | `agent scope-check` attributes 1 path to `ASES-0010` and 2 to `ASES-0011`, none under `src/`. Several tasks name `apps/web/src/` a prohibited path. The working tree does contain 37 changed files under `src/` — those are the pre-existing redesign and `SPEC-0003`, classified `PRE_EXISTING` by scope-check, not this change |
| Prisma schema unchanged | **CONFIRMED** | `git status --porcelain apps/web/prisma` → empty |
| No migration added | **CONFIRMED** | same; no new directory under `prisma/migrations` |
| Auth product behaviour unchanged | **CONFIRMED** | no file under `src/` touched; `apps/web/src/` was prohibited for `TASK-008` precisely so a harness fix could not reach the auth implementation |
| Authorization unchanged | **CONFIRMED** | no permission is added, widened or granted; `ensurePermission` creates the same rows |
| Tenant isolation unchanged | **CONFIRMED** | no RLS policy, tenant guard or query scope touched |
| Dependencies unchanged | **CONFIRMED** | 19 runtime + 18 development, before and after |
| Lockfile unchanged | **CONFIRMED** | `git status --porcelain apps/web/package-lock.json` → empty |
| No production or staging contact | **CONFIRMED** | loopback-only checks in the script; no deployed system was contacted by any part of this work |

## Evidence a reviewer can check

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint tests/e2e/helpers.ts` | clean |
| Product suite, CI-equivalent baseline | `npm test` | **1914 passed · 4 failed · 2 skipped** of 1920; the 4 are `RC-4` |
| Product suite, empty catalogue | `npm test` | 1913 · 4 · 3, zero skipped files |
| Bootstrap from empty | `npm run db:test:reset` | 65 migrations, then seed — 25s |
| Bootstrap idempotence | `npm run db:test:prepare` | no migration applied, seed idempotent — 8s |
| **Playwright** | 3 cold-start cycles + 2 normal runs | **5 of 5** |
| B2 | `node tools/sdd/tests/validator.test.mjs` | 93 / 93 |
| B3 | `node tools/sdd/tests/agent.test.mjs` | 70 / 70 |
| Artefacts | `node tools/sdd/cli.mjs validate --all` | 0 errors, 7 known warnings |

## Open findings the reviewer should see first

| Finding | Status | Summary |
|---|---|---|
| `CONV-001` | **`RESOLVED`** | **this review — `REV-0004`, human `APPROVE`, 2026-09-08** |
| `CONV-002` | `OPEN` | the two POSIX mode assertions do not execute on Windows |
| `CONV-006` | `OPEN` | `db:test:prepare` now seeds — a scope judgement for the gate-1 approver |
| `CONV-004` | `RESOLVED` | Playwright readiness, 5 of 5 with three cold starts |
| `CONV-005` | `RESOLVED` | task states reconciled from evidence |
| `CONV-003` | `NOT_APPLICABLE` | `RC-4`, out of scope |

## What is being asked for

**One decision: `APPROVE` or `REQUEST_CHANGES` on the final diff.**

This is a code review, not convergence acceptance. Gate 6 is separate, is
recorded separately, and — for an AI-authored `R0–R2` specification — is
discharged by a Qualified Human Reviewer under `EVC-017`. One person may do
both; the two decisions are still recorded separately.

**No approval may be recorded by an agent**, and none has been.
