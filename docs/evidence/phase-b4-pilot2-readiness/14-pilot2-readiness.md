# Pre-pilot #2 readiness

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Outcome | **NOT READY** — one product defect blocked at `R4`, and three human decisions open on `SPEC-0004`. The Playwright instability is fixed and re-verified |
| Product suite | **1914 passed · 4 failed · 2 skipped** of 1920, from the CI-equivalent baseline |
| Pilot #1 | untouched, `CONVERGED` |

---

## What changed

`SPEC-0004` was approved at gate 1 by a human Product Owner and implemented
across eight controlled sessions. **20 of the original 24 failures are fixed at
the cause.** No assertion was weakened, no test deleted, no application source
file touched.

| Root cause | Failures | Fix | State |
|---|---|---|---|
| RC-1 CRLF text scanning | 17 | `/\r?\n/` splitting; newline-agnostic body delimiter; normalised comparison | **FIXED** |
| RC-2 path separator | 1 | separators normalised once at the boundary | **FIXED** |
| RC-3 POSIX file mode | 2 | platform-gated, assertion text unchanged | **FIXED** |
| RC-4 biometric capture path | 4 | — | **BLOCKED at R4** |

## The readiness gate

| # | Criterion | State |
|---|---|---|
| 1 | Deterministic `master_saas_test` bootstrap exists and is documented | **YES** — `db:test:prepare`, idempotent, proven from empty and from prepared |
| 2 | False `npm run setup` claim corrected | **YES** |
| 3 | Remaining product failures fixed or legitimately blocked | **YES** — 20 fixed, 4 blocked at `R4` with a decision packet |
| 4 | No active malformed scope declaration can authorise work | **YES** — 7 warnings, all double-blocked |
| 5 | Historical-session mechanism verified | **YES** — `UT-056`–`UT-063`, 8 of 8 |
| 6 | Playwright has no reproducible blocking instability | **YES** — **5 of 5**, and three of the five began from a genuinely cold dev server with port 3000 confirmed free. `CONV-004` `RESOLVED` |
| 7 | B2 green | **YES** — 93/93 |
| 8 | B3 green | **YES** — 70/70 |
| 9 | `validate --all` free of blocking ERROR | **YES** — 0 errors, 7 known warnings |
| 10 | Pilot #1 remains `CONVERGED` | **YES** |
| 11 | No unresolved blocking security or risk escalation | **NO** — the `R4` capture-vault defect |
| 12 | *(new)* `SPEC-0004` converged | **NO** — three findings open, and all three are human decisions rather than outstanding work |
| 13 | *(new)* Local test preparation matches the CI baseline | **YES** — `db:test:prepare` now migrates **and** seeds, as CI does. The third skip is gone |

**Eleven of thirteen met.** Criterion 6 has now been met properly: it was
first reported met on one five-run check, contradicted by a second, and is now
re-verified after the readiness defect was actually fixed — with three of the
five runs starting from a confirmed-cold server rather than whatever happened
to be listening.

The two that remain are `RC-4` and `SPEC-0004`'s human gates.

## The Playwright root cause, corrected

`webServer.url` gated on `/login`, a **page**. Under `next dev` a route compiles
on first request, so the suite could start while `/api/v1/auth/login` was still
uncompiled — and an uncompiled route is answered by the catch-all 404, not held.
In one run the same login route answered `200` eleven times and `404` on the
twelfth.

The remedy is a bounded readiness probe, not a retry: it waits for a determinate
condition and stops. `retries` stays `0`, no timeout was raised, no sleep
replaces a real wait, and `apps/web/src/` was prohibited for that task so no
authentication behaviour could change.

**My earlier MFA hypothesis was wrong** and is corrected. It was a symptom: the
login request 404'd, so no session existed and no MFA step appeared.

### The probe is incomplete, and a second correction is owed

The probe polls `/api/v1/auth/login` until its status is not `404`, then issues
one request to a dynamic-segment route **and discards the result**. A discarded
`404` is precisely the uncompiled-route signal the poll exists to wait out, so
the suite can still start before that route's module has compiled. That is what
run 4 of the second confirmation hit.

The reason recorded for discarding it was wrong. It was written down as *"a
route with a dynamic slug returns a legitimate 404 for a workspace that does not
exist"*. Measured on a cold development server, an unauthenticated `GET` on that
path returns **401 `application/problem+json`**: `route()` throws `Unauthorized`
before parameter validation and before `requireWorkspace` resolves the slug, so
the workspace is never looked up. The route can be gated on exactly the same
condition as the login route.

The remedy is one line in a file already inside `TASK-008`'s allowed scope. **It
was not applied.** `SPEC-0004` is `VERIFYING`, the control plane refuses an
`IMPLEMENTER` session in that state (`SDD-V043`), and moving the status
backwards to obtain one would be routing around the gate. It is raised as
`CONV-004` for a human instead.

## Three defects found that nobody was looking for

Each surfaced only because the environment was made deterministic:

1. `psql` rejects Prisma's `?schema=` as an unknown URI parameter.
2. Node refuses to spawn `npx.cmd` with `shell: false` (`EINVAL`) — the exact
   platform the script exists to support.
3. `prisma.permission.upsert()` **races** on an empty catalogue. Several suites
   build tenants in parallel over the same 8 × 6 permission grid; on a genuinely
   empty database one loses on `(module, action)`. Invisible for as long as the
   test database happened to hold data, because an upsert against an existing
   row is a no-op and a no-op cannot race. Fixed under `CHG-002`/`TASK-009`:
   **1830 → 1913 passing**, and zero skipped files.

## Corrections to earlier statements

| Earlier claim | Truth |
|---|---|
| `SPEC-0003/CONV-011`: the 11 `assistant-guardrails` failures were AI tool-permission drift | **No drift.** A CRLF-fragile extractor returned 39,757 chars instead of 2,752. `searchLeads` reads exactly `prisma.lead` |
| `CONV-012` was likely `ensureOwnerAuthenticator` failing to enable MFA | A symptom. The login route itself 404'd from the dev server |

**Pilot #1's accepted risks are not rewritten.** Both are recorded as
**post-pilot remediation**, not as claims the limitations never existed.

## Required before pilot #2 — updated

| # | Action | State |
|---|---|---|
| 1 | Deterministic documented `master_saas_test` bootstrap | **DONE** |
| 2 | Review/correction strategy for the 7 `SDD-V064` declarations | **DONE** |
| 3 | `CONV-012` harness-instability follow-up | **DONE** — fully root-caused and fixed under `CONV-004`; 5 of 5 with three cold starts |
| 4 | Correct the false `npm run setup` claim | **DONE** |
| 5 | Retain the corrected historical-session mechanism | **DONE and verified** |
| 6 | Disposition the `R4` capture-vault defect | **OPEN** — Application Security + Solution Architect |
| 7 | `SPEC-0004` human code review and convergence | **OPEN** |

## Identifier allocation

`EVC-016` is **untouched** — not renamed, broadened or repurposed. It remains
the historical `PC-01` PII-classification conflict and stays `OPEN`.

| Purpose | Identifier |
|---|---|
| Test-determinism remediation | `SPEC-0004` — **consumed** |
| `RC-4` biometric capture-path governance | `SPEC-0005` — **consumed**, `READY_FOR_APPROVAL` |
| Pilot #2 product specification | **`SPEC-0006`** |

`SPEC-0005` now exists as a complete `R4` artefact set with **no code written**
and **no gate discharged**. Creating the specification is not the same as
presuming its approval: gates 1, 2, 3 and 5 are all `UNRESOLVED`, every task is
`BLOCKED` rather than `TODO`, and two material clarifications are open. The
decision packet is `19-spec0005-r4-approval-packet.md`.

## Next human actions

1. **`SPEC-0004` code review** — 10 files, all tests, scripts or documentation.
2. **`SPEC-0004/CONV-002`** — disposition the POSIX platform limitation.
3. **`SPEC-0004/CONV-006`** — confirm or overrule the judgement that
   `db:test:prepare` should seed. It closes the third skip and makes the local
   baseline match CI; it also changes what an approved command does, which is
   why it is put to the approver rather than assumed.
4. **`SPEC-0004` convergence acceptance** — a Qualified Human Reviewer, per
   `EVC-017`.

`CONV-004` and `CONV-005` are **`RESOLVED`** and need nothing from a human.
3. **`RC-4` disposition** — Application Security and Solution Architect, using
   `05-capture-vault-r4-blocked.md`. Includes one read-only query against a
   deployed database to establish whether stored `capturePath` values already
   contain backslashes; the local database holds zero rows, which proves nothing
   about production.

Pilot #2 selection follows those, and remains a separate human decision.
