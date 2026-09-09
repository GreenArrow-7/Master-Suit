# SPEC-0006 — Change record

## CHG-001

**Change:** Replace the 600-iteration `consume()` loop in the webhook
rate-limit test with a direct write of the limiter's window counters.

**Reason:** `BUG-004`. The loop's duration was the precondition's weakness. The
limiter uses a fixed window keyed `rl:<key>:<floor(now / 60000)>`; 600
sequential round-trips can straddle a minute boundary, which starts a fresh
counter, leaves budget available, and lets the request through to signature
checking — `401` instead of `429`.

**Requested by:** the agentic engineering team, under `BLK-008`.

**Change type:** `MINOR CLARIFICATION` — test mechanics only. The behaviour
asserted is identical before and after, and no requirement, product file or
security control changes.

**Affected requirements:** none. `SEC-001` of this specification restates the
invariant that must not move.

**Affected plan:** none.

**Affected tests:** `apps/web/tests/security/p2-regressions.spec.ts`, one case.

**Security impact:** **none, and this was checked rather than assumed.** The
assertions — `429` and a `retry-after` header — are byte-identical. The
precondition is still "the budget for this window is exhausted"; only how it is
established changed. `consume()` refuses on `count > max`, so writing `max` is
exactly the state 600 successful consumes produced, and the route's own
increment remains the one that crosses the line. Both the current window and
the next are written, so the precondition holds however the clock falls.

**Migration impact:** none.

**Compatibility impact:** none.

**Risk change:** none. `R1`.

**Approval required:** author, per `R1` in `docs/sdd/RISK_TO_PROCESS_MATRIX.md`.

**Approval status:** author-recorded. **The human code review has not
happened.**

**Date:** 2026-09-08

---

## CHG-002

**Change:** Resolve `prisma.config` once in a `beforeAll` hook in the
prisma-config test.

**Reason:** `BUG-005`. The first case timed out at 30 s during a full-suite
run. It was not asserting slowly — `vi.resetModules()` plus a dynamic import
made that case pay the cold resolution of the `prisma/config` package, and with
152 files in parallel that cost alone exceeded the test budget. It never
reproduced in isolation.

**Requested by:** the agentic engineering team, under `BLK-008`.

**Change type:** `MINOR CLARIFICATION` — one-time setup moved into setup.

**Affected requirements:** none.

**Affected plan:** none.

**Affected tests:** `apps/web/tests/unit/prisma-config.spec.ts`, one hook added.

**Security impact:** none.

**Migration impact:** none.

**Compatibility impact:** none. Both cases still call `shadowUrlFor`, which
still calls `vi.resetModules()` and re-imports, so each still reads a freshly
evaluated config. Neither assertion changed.

**Risk change:** none. `R1`.

**Approval required:** author, per `R1`.

**Approval status:** author-recorded. **The human code review has not
happened.**

**Date:** 2026-09-08

---

## What was deliberately not done

Neither fix uses any of the prohibited routes. Stated explicitly because the
instruction that prompted this work listed them:

| Prohibited | Used? |
|---|---|
| change expected `429` to `401` | no — the assertion is untouched |
| disable or skip a test | no |
| add a sleep | no |
| add a retry | no |
| raise a timeout | no — `hookTimeout` was already 60 s in `vitest.config.mts` and is unchanged |
| remove a rate-limit assertion | no |
| mock away the functionality under test | no |
| change product code | no — the diff is entirely under `apps/web/tests/` |

The limiter's own design needed no change to be testable deterministically, so
no product-code risk classification was required.
