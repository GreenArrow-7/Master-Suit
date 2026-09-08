# CONV-012 — Playwright harness recurrence check

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Method | 3 consecutive runs of the SPEC-0003 suite, **no code changed between runs** |
| Result | **RECURRENCE OBSERVED — 2 of 3 runs failed** |
| Consequence | `CONV-012`'s acceptance condition is triggered |

---

## Results

| Run | Result | Failure point |
|---|---|---|
| 1 | **FAILED** | `beforeAll` — `password settle failed: 404` at `helpers.ts:370` |
| 2 | **7 passed** (1.2m) | — |
| 3 | **FAILED** | `beforeAll` — `POST /api/v1/auth/login 404` |

Across the whole day: **8 runs, 3 failures**, all in `beforeAll`, none in any of
the seven test bodies.

## The acceptance condition is triggered

`CONV-012` was accepted for pilot #1 by QA / Release Engineering on an explicit
condition:

> The instability must remain visible in the pilot retrospective. **If it
> becomes reproducible or materially worsens, it must be investigated rather
> than continually accepted.**

A 2-in-3 failure rate is reproducible. The condition has been met, and this is
reported rather than re-accepted.

## Corrected root cause

**My earlier hypothesis was wrong and is corrected here.** The first
investigation observed the platform owner with `mfaEnabled: false` and no
authenticator backup file, and inferred a defect in
`ensureOwnerAuthenticator` leaving MFA unset.

That was a **symptom, not the cause**. The evidence from these three runs shows
the real one:

| Run | HTTP evidence |
|---|---|
| 1 | `POST /api/v1/workspaces/{slug}/identity/self/password-change` → **404** |
| 3 | `POST /api/v1/auth/login` → **404** |

Two *different* API routes returned 404, and the response body is the
application's own Next.js 404 page — not an application error, and not an
authentication refusal. The MFA prompt never appeared in the earlier run
because the login request itself 404'd, so no session was ever established.

**These are routes that exist.** In run 3 the same `POST /api/v1/auth/login`
succeeded with `200` eleven times before returning `404` on the twelfth.

## Why a route that exists returns 404

The suite runs against `next dev` with Turbopack, which compiles a route on its
first request. `apps/web/playwright.config.ts` already documents the cost:

> These specs run against `next dev`, where a route is compiled on its first
> request. That cost roughly doubled — 13-22s per route, measured …

The failures are consistent with a request arriving while the dev server is
still resolving a route, and being answered by the catch-all 404 rather than
being held. The `webServer` readiness gate waits on `/login` only, so the API
routes the suite depends on are unwarmed when the first test starts.

**This is a harness and environment defect, not a product defect and not a
`SPEC-0003` defect.** No test body failed in any of the eight runs.

## What was deliberately not done

- **No retry was added.** `playwright.config.ts` sets `retries: 0` and states
  why: *"A retry turns an intermittent failure into a green run with a note
  nobody reads."* Adding one would mask exactly this.
- **No product code was touched.** The 404 comes from the dev server, not from
  a route handler.
- **No fix was applied at all.** `SPEC-0004` is blocked at gate 1, and a harness
  fix is outside its declared scope; it needs its own governed task.

## Candidate remediations, for whoever takes it

| | Approach | Note |
|---|---|---|
| **A** | Extend the `webServer` readiness gate to warm the API routes the suite uses before the first test | Smallest; addresses the cause directly |
| **B** | Run the suite against a production build rather than `next dev` | Removes on-demand compilation entirely; slower to start, closer to reality |
| **C** | Retry only `beforeAll` | Rejected here — it masks the signal, and the configuration forbids it |

**Not selected.** This is a QA / Release Engineering decision.

## Effect on pilot #2 readiness

Prerequisite 3 — *"CONV-012 harness-instability follow-up if recurrence
occurs"* — was conditional. **The condition has now occurred, so the item is
active and blocking.**

A suite that fails 2 runs in 3 during setup cannot serve as the verification
gate for pilot #2: a genuine product regression would be indistinguishable from
this.
