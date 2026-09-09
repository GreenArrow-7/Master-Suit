# Playwright — second five-run confirmation

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Method | 5 consecutive runs of the SPEC-0003 suite, **no code changed** since `VER-0001` |
| Result | **4 of 5** |
| Record | `SPEC-0004/VER-0002`, session `ASES-0009`, role `TESTER` |

---

## Results

| Run | Result | Exit |
|---|---|---|
| 1 | 7 passed (1.5m) | 0 |
| 2 | 7 passed (1.4m) | 0 |
| 3 | 7 passed (1.5m) | 0 |
| **4** | **1 failed** | **1** |
| 5 | 7 passed (1.5m) | 0 |

Combined with the first confirmation (`VER-0001`, 5 of 5 on the same code):
**9 of 10 runs passed.** Ten runs do not establish a rate, and none is claimed.

## The failure

`beforeAll`, at `tests/e2e/helpers.ts:445`:

```
password settle failed: 404 <!DOCTYPE html> … <title>YOUHAN ONE</title> … 404 …
```

`POST /api/v1/workspaces/{slug}/identity/self/password-change` answered with the
**application's HTML not-found page**, not the API kernel's
`application/problem+json` envelope. An unmatched route, not a refusal — the
same class of failure as before the readiness fix, on a route the fix warms but
does not gate on.

No test body failed. All seven bodies were skipped because setup failed.

## Root cause — measured, not inferred

`warmApiRoutes` does two different things to two routes:

| Route | Treatment |
|---|---|
| `/api/v1/auth/login` | polled every 250 ms until its status is **not 404**, deadline 120 s |
| `/api/v1/workspaces/readiness-probe/identity/self/password-change` | requested **once**, status **discarded** |

**A discarded `404` is precisely the uncompiled-route signal the poll exists to
wait out.** The gate can therefore open while the second route is still
compiling, which is what run 4 hit.

### Measurement

A development server was started cold and each route requested once, as its
first ever request:

| Request | Status | Content type |
|---|---|---|
| `GET /api/v1/auth/login` | `405` | — |
| `GET /api/v1/workspaces/readiness-probe/identity/self/password-change` | **`401`** | `application/problem+json` |

**401, not 404.** `route()` throws `Unauthorized` at its authorisation step,
which runs *before* parameter validation and *before* `requireWorkspace`
resolves the slug — so the workspace is never looked up and its existence never
matters.

## A correction I owe

`VER-0001` and the `SPEC-0004` convergence report both state that the
dynamic-slug route *"returns a legitimate 404 for a workspace that does not
exist"*. **That is wrong**, and the measurement above is what shows it.

It is not a harmless slip. Believing that route's `404` was legitimate is
exactly why its status is discarded instead of polled — the incorrect
explanation is the direct cause of the remaining defect. The change made at the
time (gate on a route with no dynamic segment) was still an improvement, and the
first probe genuinely did hang and fail; only the reason was wrong.

## The remedy, not applied

Gate every warmed route on the same not-404 condition instead of gating one and
discarding the other. One line, in `tests/e2e/helpers.ts` — a file already
inside `TASK-008`'s allowed scope.

**It was not applied here.** `SPEC-0004` is `VERIFYING`; the control plane
refuses an `IMPLEMENTER` session in that state:

```
ERROR SDD-V043  SPEC-0004 · sdd.json
      Role IMPLEMENTER may not act while the specification is VERIFYING
```

Moving the status backwards to obtain a session would be routing around the
gate. Raised as `SPEC-0004/CONV-004` for human disposition instead.

## What was deliberately not done

- No retry, and `retries` remains `0`.
- No sleep, and no raised timeout.
- No assertion weakened, no test skipped, no run discarded.
- The passing first confirmation was **not** used to overrule the failing
  second one.

## Effect on pilot #2

Readiness criterion 6 — *"Playwright has no reproducible blocking
instability"* — was reported as met on one five-run check. It is now **not
met**, and `14-pilot2-readiness.md` is corrected accordingly.

This matters more than the failure rate suggests. The suite is the proposed
verification gate for pilot #2, and a `beforeAll` failure there is
indistinguishable from a genuine product regression.
