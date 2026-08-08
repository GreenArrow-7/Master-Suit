# Test Execution Report

**Date:** 2026-08-08
**Runner:** vitest 4.1.10 (`npm test` → `vitest.config.mts`)
**Environment:** Windows 11, Node ≥22, Postgres/Redis/MinIO in Docker (all healthy).
Tests use `.env.test`: database `master_saas_test`, Redis db **15** — isolated from the
development database and cache.

No test result below is inferred. Every number is from a run performed during this
assessment.

---

## Baseline (before any change)

```
Test Files  1 failed | 35 passed (36)
     Tests  3 failed | 480 passed (483)
  Duration  24.07s
```

**The 3 failures were investigated, not assumed.**

| Failing test | Assertion | Classification |
|---|---|---|
| `mfa-enrolment` › offers enrolment instead of demanding an impossible code | `expected 429 to be 200` | ENVIRONMENT |
| `mfa-enrolment` › issues a grant that is short-lived and marked as restricted | `expected null not to be null` | ENVIRONMENT (cascade of the above) |
| `mfa-enrolment` › accepts a real TOTP code and issues a full session | `expected 429 to be 200` | ENVIRONMENT |

Investigation path: 429 → suspected stale Redis state → scanned db0, found **zero** `rl:*`
keys, so the first hypothesis was **wrong** → found `.env.test` points at Redis **db15** →
scanned db15 and found `rl:login:ip:unknown:1984665 = 10, ttl=816`, exactly at the cap.

Cause: `TRUSTED_PROXY_CIDRS=none` in tests makes `clientIp()` return null, so every sign-in
across the suite shares one bucket (10 per 15 min). Repeated runs inside the window exhaust
it. **Not an application defect** — production refuses to boot in that configuration
(`lib/startup-check.ts`). Recorded as finding **F-02**.

Confirmed by clearing only that ephemeral counter and re-running the spec in isolation:
**9 passed (9)**.

---

## Final (after fixes)

```
Test Files  37 passed (37)
     Tests  487 passed (487)
  Duration  25.24s
```

| Metric | Value |
|---|---|
| Total tests | **487** |
| Passed | **487** |
| Failed | **0** |
| Skipped | 0 |
| Errors | 0 |
| Net new tests added | **+4** |
| Pre-existing tests broken | **0** |

### Supporting checks

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **PASS** — clean, no output |
| Lint | `npm run lint` | **PASS** — 0 errors, 108 pre-existing `no-explicit-any` warnings (untouched by this work) |
| Dependencies | `npm audit --omit=dev` | **0 vulnerabilities** |

---

## Tests added

**`tests/security/hr-overtime-scope.spec.ts`** — 4 tests covering finding F-01.

| Test | Pre-fix | Post-fix |
|---|---|---|
| TEAM approver cannot decide a claim outside their reporting line | **FAIL** | PASS |
| TEAM approver cannot see such a claim in the queue | **FAIL** | PASS |
| TEAM approver *can* decide their own report's claim (positive control) | PASS | PASS |
| ORGANIZATION approver decides anyone (HR unaffected) | PASS | PASS |

The two failures are the vulnerability proof — they failed against unmodified code because
the approval genuinely succeeded, returning `status: APPROVED` with a multiplier stamped on
an outsider's claim. The two positive controls prove the fix does not over-restrict.

**`tests/globalSetup.ts`** — infrastructure, not a test. Clears `rl:*` from the test Redis
before each run so rate-limit state cannot leak between runs. Verified by running the
previously-failing spec twice back-to-back: **9/9 then 9/9** (the second run previously
failed with 429).

---

## Suites not executed

| Suite | Reason |
|---|---|
| `tests/e2e/*` (Playwright) | Requires a running application and browser binaries; not launched this session |
| `tests/server/*` (`vitest.server.mts`) | Owns a server via its own `globalSetup`; not run |

Both are **NOT TESTED**, not "passing". They should be run before release.

---

## Test quality observations

- Fixtures create randomly-suffixed tenants and delete them in `afterAll` — no shared
  mutable state, and no risk to development data. Verified by reading
  `tests/helpers/fixtures.ts` before running anything that writes.
- The suite authenticates the way production does (real `PlatformSession` rows resolved by
  the real `resolveCtx`), not through a test-only shortcut.
- **Coverage gap that mattered:** every actor in `tests/hr/overtime.spec.ts` is built at
  `ORGANIZATION` scope, so the TEAM-scope authorization boundary had no coverage at all.
  That is precisely why F-01 survived into the working tree. Scope-boundary cases deserve a
  standing place in the HR suites — a permission granted at a scope should always be tested
  at the scope *below* the one that makes it permissive.
