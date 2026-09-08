# Production defect register

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Compiled by | AI agent, triage only |
| Production evidence access | **NONE AUTHORIZED** |
| Staging evidence access | **NONE AUTHORIZED** |

> **No production or staging system was contacted to build this register.** No
> log was read, no metric queried, no health endpoint called, no deployed
> database touched. Every entry below is evidenced from the repository or from
> a local run on this workstation.
>
> **Therefore this register contains zero *observed* production defects.** That
> is not a claim that production is healthy. It is a statement that production
> health is currently **unmeasured from here**, which is itself the finding.

## What "no authorized access" means for Parts C, H and I

`CLAUDE.md` prohibits all production activity, and the standing instruction for
this workstream has been *do not access staging, do not access production, do
not query deployed databases*. The register cannot be populated from
application errors, server logs, monitoring alerts, failed requests, worker
errors or operational incidents, because none of those sources is reachable
under the authorization I hold.

Inventing entries to fill the template would be the worst possible outcome, and
the instruction itself says *"do not claim a defect exists without evidence."*
So the register holds what is genuinely evidenced, and §5 prepares the
diagnostics that would populate the rest.

---

## Defects — evidenced

### BUG-001 — capture vault composes a persisted key with OS path semantics

| Field | Value |
|---|---|
| Affected functionality | Attendance biometric capture storage and retention deletion |
| Current production impact | **UNKNOWN — requires runtime/infrastructure verification** |
| Reproduction status | **REPRODUCED** — 4 failing tests, `apps/web/tests/unit/capture-vault.spec.ts` |
| Evidence source | Local test run 2026-09-08; source read of `captureVault.ts` and `lib/jobs/retention.ts` |
| Severity | **SEV-3** — degraded, conditional. Escalates to **SEV-2** if `SPEC-0005/CL-001` returns a non-zero backslash count |
| Risk class | **R4** |
| Affected users/tenants | Any tenant whose captures were written by a Windows-hosted process. **Count unknown** |
| Security impact | Biometric data retained past its retention window; a deletion sweep reports success having deleted nothing |
| Data impact | Punch row deleted, encrypted capture orphaned in the bucket with its only index removed |
| Root cause status | **CONFIRMED** — `pathFor` uses `path.join`; `objectKey` normalises with the *running* host's `path.sep` |
| Fix status | **NOT IMPLEMENTED** — blocked at R4 gates |
| Test status | 4 tests failing, deliberately not weakened |
| Staging status | not deployed |
| Production deployment status | not deployed |

**Why SEV-3 and not SEV-2.** The defect only produces a bad key on a
Windows-hosted writer; on POSIX `pathFor` already emits `/`. For a
containerised Linux deployment the expected number of affected rows is zero and
the fix is preventive. That is stated as the honest reading, not as
reassurance — it is exactly what `CL-001` exists to settle.

### BUG-002 — `npm run openapi` invokes a script that does not exist

| Field | Value |
|---|---|
| Affected functionality | OpenAPI specification generation (developer tooling) |
| Current production impact | **NONE** — not on any runtime path |
| Reproduction status | **REPRODUCED** — `package.json` declares `tsx scripts/generate-openapi.ts`; the file is absent |
| Evidence source | Repository inspection; already registered as `EVC-006` |
| Severity | **SEV-4** |
| Risk class | R1 |
| Affected users/tenants | none — developers only |
| Security impact | none |
| Data impact | none |
| Root cause status | **CONFIRMED** — the script was never added, or was removed without updating `package.json` |
| Fix status | **NOT STARTED — deliberately** |
| Test status | no test covers it |
| Staging / production | not applicable |

**Not fixed on purpose.** This is a registered evidence conflict, and
`docs/sdd/SDD_WORKFLOW.md` is explicit: *"A specification may cite an `EVC` but
may not close one."* Whether the script should be written or the entry removed
is a human decision about intent, not a defect an agent should resolve by
picking whichever is cheaper.

### BUG-003 — `npm run format:check` cannot pass on a CRLF checkout

| Field | Value |
|---|---|
| Affected functionality | `npm run verify` gate 3; local developer workflow on Windows |
| Current production impact | **NONE** — CI runs Linux with LF, where the gate passes |
| Reproduction status | **REPRODUCED** — `npm run format:check` flags **870 files**, including `tsconfig.json`, `vitest.config.mts` and others nobody has touched |
| Evidence source | Local run 2026-09-08; `.prettierrc` declares no `endOfLine`, so Prettier defaults to `lf`, while `core.autocrlf=true` gives the worktree CRLF |
| Severity | **SEV-4** |
| Risk class | R1 |
| Affected users/tenants | none — Windows contributors only |
| Security impact | none |
| Data impact | none |
| Root cause status | **CONFIRMED** — the same CRLF root cause class as RC-1, in a gate rather than a test |
| Fix status | **NOT STARTED — deliberately** |
| Test status | none |
| Staging / production | not applicable |

**Not fixed on purpose.** The obvious remedy is one line — `"endOfLine": "auto"`
in `.prettierrc` — but it changes a repository-wide CI gate for every
contributor and sits inside no approved specification. `CLAUDE.md` requires
work that grows beyond an approved scope to stop and raise a record rather than
widen quietly. It is raised here instead.

**Worth noting:** two files in the `SPEC-0004` diff now pass this check while
most of the repository does not, because rewriting them converted them to LF.
That is `REV-0003/CR-009`, and it has no effect on committed content —
`core.autocrlf` normalises to LF in the index either way.

### BUG-004 — webhook rate-limit test races a fixed-window boundary

| Field | Value |
|---|---|
| Classification | **LOCAL/CI-OBSERVED** — not production-observed |
| Affected functionality | `apps/web/tests/security/p2-regressions.spec.ts` → *"P2-5 … answers 429 once the window is spent"* |
| Current production impact | **NONE** — the limiter behaved exactly as specified |
| Reproduction status | **INTERMITTENT** — failed once in four seeded runs; passes in isolation, 17 of 17 |
| Evidence source | Closure run 2026-09-08: `expected 401 to be 429` |
| Severity | **SEV-4** |
| Risk class | R1 |
| Security impact | **None to the product.** But the test is a *security* assertion, so an unreliable result erodes confidence in a control rather than in the code |
| Data impact | none |
| Root cause status | **CONFIRMED** — `limits.webhook` is `max: 600, windowSeconds: 60`, keyed `rl:<key>:<floor(now/60000)>`. The test spends the budget with 600 sequential `consume()` round-trips; straddling the minute boundary starts a fresh counter, the final request finds budget, and the route falls through to signature checking → `401`. The direction of the failure is the tell |
| Fix status | **FIXED** — `SPEC-0006/CHG-001`. The 600-iteration `consume()` loop is replaced by a direct write of the limiter's counter for the current **and next** window, so the precondition holds however the clock falls. Two Redis operations instead of 600 round-trips |
| Test status | passes in isolation and in the full suite; assertions unchanged |
| Security check | The `429` and `retry-after` assertions are byte-identical. `consume()` refuses on `count > max`, so writing `max` is exactly the state 600 successful consumes produced, and the route's own increment is still the one that crosses the line |

**A hypothesis discarded, recorded so nobody re-tries it.**
`apps/web/tests/unit/cache-invalidation.spec.ts` calls `redis.keys()` and
deletes matches, which looked like cross-file interference. It is not: its
suffix is `randomBytes(6)` per run and every key it writes or deletes carries
that suffix. The webhook test's `integrationKey` is likewise random per run, so
no cross-file collision is possible.

### BUG-005 — suite exhibits load-sensitive intermittent failures

| Field | Value |
|---|---|
| Classification | **LOCAL/CI-OBSERVED** |
| Affected functionality | the product suite as a release gate |
| Current production impact | **NONE** directly |
| Reproduction status | **INTERMITTENT** — 2 of 4 seeded runs today produced one extra failure, **a different test each time** |
| Evidence source | Run 3: `BUG-004`. Run 4: `apps/web/tests/unit/prisma-config.spec.ts` → *"omits an empty SHADOW_DATABASE_URL…"*, **timed out at 30000 ms** (not an assertion failure) |
| Severity | **SEV-4** |
| Risk class | R1 |
| Security impact | indirect — see `BUG-004` |
| Data impact | none |
| Root cause status | **CONFIRMED for both instances.** `BUG-004`: fixed-window boundary. The second: `apps/web/tests/unit/prisma-config.spec.ts` calls `vi.resetModules()` then dynamically imports `prisma.config`, so that *case* pays the cold resolution of the `prisma/config` package — with 152 files in parallel, that alone exceeded the 30 s test budget. Neither is logic. The workstation was checked for contamination first: port 3000 free, two node processes, all four containers healthy |
| Fix status | **FIXED** — `SPEC-0006/CHG-001` and `CHG-002`. The second resolves `prisma.config` once in a `beforeAll`, so one-time setup is paid in setup. `hookTimeout` was already 60 s in `vitest.config.mts` and is **not** raised; no timeout changed, no retry, no sleep, no assertion touched |

**Why this is registered despite SEV-4.** A gate that intermittently reports an
extra failure needs a human to adjudicate every run. That is a
production-readiness problem even when no individual instance is a product
defect, and it is the reason the baseline below is stated as a range rather
than a number.

**Observed seeded baselines today:** `1914·4·2`, `1914·4·2`, `1913·5·2`,
`1913·5·2`. The four `RC-4` failures are constant across all four.

---

## Production-readiness blockers — not defects, but they gate release

| ID | Blocker | Evidence | State |
|---|---|---|---|
| `BLK-001` | **Backup and restore capability is contradicted by its own documents** | `EVC-005`, severity C3, **Release impact: BLOCKING**, status `OPEN`. See the investigation below | **OPEN — blocking** |
| `BLK-002` | **RLS rollout document contradicts the migrations and gates** | `EVC-004`, severity **C4**. See the investigation below — **local runtime evidence now favours one side** | **OPEN, evidence added** |
| `BLK-003` | **No authorized production or staging evidence access** | This workstream holds none | **OPEN** |
| `BLK-004` | **`SPEC-0004` is not converged** | `CONV-001`, `CONV-002`, `CONV-006` all `OPEN`; verdict `FAIL` | **OPEN** |
| `BLK-005` | **`RC-4` is unremediated and its R4 gates are undischarged** | `SPEC-0005` gates 1, 2, 3 and 5 all `UNRESOLVED` | **OPEN** |
| `BLK-006` | **Staging has configuration but no verified running instance** | `infra/docker-compose.staging.yml` and `infra/Caddyfile.staging` exist; whether a staging environment is running and reproduces production is **unverified from here** | **OPEN** |
| `BLK-007` | **`CONV-002` condition 4 — POSIX/Linux execution proof** | The gate-6 acceptance of the POSIX limitation is conditional: before production, a POSIX/Linux run must show both `0o600` mode assertions **executed** rather than counted as skips. `EVC-014` records CI-runs-Linux as `DOCUMENTED`, not measured | **OPEN — production gate** |
| `BLK-008` | **The regression suite is not a reliable release gate** | `BUG-004` and `BUG-005` both **FIXED** under `SPEC-0006`; closure requires three consecutive full-suite runs whose only failures are the four `RC-4` ones | **see the stability evidence below** |

`BLK-001` alone is sufficient to stop a production release: it is already
registered as release-blocking, and it is the one blocker that decides whether a
bad deploy is recoverable.

---

## EVC-004 — tenant isolation (C4): runtime evidence obtained

**Measured 2026-09-08** against the local test database, built from the same 65
migrations a deployment would apply:

```
[check-rls] 181 tenant-owned tables: RLS enabled, FORCED, and policied.
            7 bootstrap tables exempt.
```

Exit 0. This is direct runtime evidence for Evidence B — the migrations, the CI
`Tenant isolation` gate, `src/lib/startup-check.ts` and `src/lib/db.ts` all
describe RLS as enforced — and against Evidence A, `docs/RLS-ROLLOUT.md`, which
says RLS is not yet in force.

**What this settles:** the *code and migrations* do force RLS, on 181 tables,
verifiably. `docs/RLS-ROLLOUT.md` is stale.

**What it does not settle:** whether the **deployed** database has the same
state. That needs `BLK-003`, and it is item 11 on the diagnostics checklist
below.

**Recommendation:** resolve `EVC-004` on the evidence — correct or withdraw
`docs/RLS-ROLLOUT.md` — after confirming item 11 against production.
**A C4 tenant-isolation uncertainty must not be carried silently into
production.** This register does not close `EVC-004`: per
`docs/sdd/SDD_WORKFLOW.md` a specification may cite an evidence conflict but may
not close one, and the decision belongs to Application Security.

## EVC-005 — backup and restore (release-blocking): still blocked

What exists, verified in the repository:

| Asset | Present |
|---|---|
| `scripts/backup.sh`, `backup-ship.sh`, `backup-status.sh` | yes |
| `scripts/restore-verify.sh`, `test-backup-roundtrip.sh`, `install-backup-schedule.sh` | yes |
| six systemd units — backup, status, restore-verify, each with a timer | yes |
| CI step `Backup round trip` → `scripts/test-backup-roundtrip.sh` | yes |

**None of that answers the question.** `EVC-005` is a contradiction about
whether backups are *actually running and restorable in the deployed
environment* — `docs/OPERATIONAL-READINESS.md` says every item is unexecuted;
`docs/BACKUP-RECOVERY.md` says the round trip was verified. Machinery existing
in the repository is not evidence that it runs on the host.

**The eight facts needed, none obtainable from here:** backup mechanism in use;
timestamp of the last successful backup; retention; restore procedure; restore
permissions; restore target; RPO; RTO; and whether a restore has actually been
rehearsed.

**`BLK-001` therefore remains open and release-blocking.** Item 10 on the
checklist below (`scripts/backup-status.sh` on the host) settles most of it in
one read-only command.

## Local production-readiness signals actually measured

These are real, and they are good — but they are signals from a workstation,
not from production.

| Check | Result |
|---|---|
| `npm run build` | **PASS** — compiled in 36.4s, 86 static pages generated, exit 0 |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** — 0 errors, 122 warnings |
| `npm run format:check` | **FAIL** — `BUG-003`, environmental |
| Product suite | 1914 pass · 4 fail · 2 skip of 1920 |
| Playwright | 5 / 5, three cold starts |
| B2 / B3 / validator | 93/93 · 70/70 · 0 errors |

---

## Prepared production diagnostics — NOT EXECUTED

Per Part I: production access is **not** authorized, so the checklist is
prepared and stops here. Every item is read-only and none modifies a deployed
system.

**Authorizing role:** DevOps / Production Engineering
(`docs/sdd/HUMAN_APPROVAL_GATES.md` — owns deployment, infrastructure and
production access).

| # | Check | Command shape | Discloses |
|---|---|---|---|
| 1 | Deployed version | `docker compose -f infra/docker-compose.prod.yml ps --format json` on the host | image tag and container state |
| 2 | Service health | `curl -sS -o /dev/null -w '%{http_code}' https://<host>/api/health` | one status code |
| 3 | Container health | `docker compose ps` health column | per-service health |
| 4 | Error rate | Prometheus `sum(rate(http_requests_total{status=~"5.."}[15m]))` | one number |
| 5 | Response codes | Prometheus `sum by (status) (rate(http_requests_total[15m]))` | counts per status |
| 6 | Worker liveness | queue depth and last-completed timestamps per BullMQ queue | counts and timestamps |
| 7 | Recent errors | `docker compose logs --since 24h --tail 500 web \| grep '"level":50'` | error lines — **may contain identifiers; review before sharing** |
| 8 | Migration state | `prisma migrate status` against the deployed URL | applied/pending counts |
| 9 | Config presence | `docker compose config --services` plus a **names-only** env check | variable **names**, never values |
| 10 | Backup freshness | `apps/web/scripts/backup-status.sh` | timestamps and sizes — settles `BLK-001` |
| 11 | RLS in force | `node apps/web/scripts/check-rls.mjs` against the deployed URL | policy booleans — settles `BLK-002` |

**Constraints on execution.** Read-only. No writes, no restarts, no migrations,
no environment changes, no ad-hoc row edits. Item 7 is the only one that can
surface personal data; it should be filtered before it leaves the host, and no
output from any item should be pasted into this repository except the summary
figure it produces.

---

## Critical business flows — verification status

Part H asks which flows are currently broken in production. **None can be
answered from here.** The table records what is known and how each would be
verified, rather than guessing.

| Flow | Verified locally | Verified in production |
|---|---|---|
| Login / logout / session | **yes** — E2E suite signs in and out on every run | **no** |
| Password reset | partly — covered by the e2e suite's outbox flow | **no** |
| MFA | partly — the harness enables and restores an authenticator | **no** |
| Workspace creation and access | **yes** — the wizard runs in every E2E run | **no** |
| Navigation and core CRUD | partly — unit and integration suites | **no** |
| Critical API routes | **yes** — four are probed for readiness every run; the suite exercises more | **no** |
| Background jobs / retention | partly — `BUG-001` is a known defect in the capture path | **no** |
| Storage / file flows | partly — capture vault unit tests, 4 failing | **no** |
| Audit / event logging | partly — unit coverage | **no** |
| AI assistant guardrails | **yes** — `assistant-guardrails` security suite | **no** |
| HR / workspace functionality | partly — permission and tenant suites | **no** |

**The right-hand column is the finding.** Nothing in it can change without
`BLK-003` being lifted.
