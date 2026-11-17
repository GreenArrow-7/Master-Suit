# The offline-retry test asserts that one call is written, not which refusal the loser gets

## What

`tests/integration/mobile-api.spec.ts` fired two call-log requests carrying the
same `Idempotency-Key` through `Promise.all` and required the pair to be exactly
`[200, 409]`. On a loaded CI runner both came back `200` and `verify` failed.
The test now asserts that exactly one call was written, and that the request
which did not do the write is either refused with 409 or answered with a
replayed 200 carrying `idempotent-replay: true` and an identical body.

## Why

Both answers are correct, and which one you get is a matter of scheduling:

- 409 while the first request is still running — the in-flight guard.
- a replayed 200 once the first has finished — the 24-hour replay.

`Promise.all` starts two promises; it does not hold the first open until the
second has begun. When the runner is busy enough, the first completes before
the second is dispatched, and the second is a replay rather than a collision.
The old assertion encoded the machine's timing rather than the product's
promise, so it was green on a developer's machine and red in CI for reasons
that had nothing to do with the change under test.

The promise worth testing is the one the offline queue depends on: **a retry
never writes a second call.** That holds whichever way the two land, and the
new assertion still fails if two calls are written or if a second
non-replayed 200 is issued.

## Where

- `apps/web/tests/integration/mobile-api.spec.ts` — the race test's assertion
  and its name, with a comment recording why the timing is not asserted.

## Behaviour

No change to the application. `handler.ts` already returns 409 for a key still
in flight and a replayed 200 after it completes; both were always correct.

## Verified

`npx vitest run tests/integration/mobile-api.spec.ts` — 29 passed, run three
times. `tsc --noEmit` and `prettier --check` clean.

## Left open

Idempotent replay is not atomic — `docs/` records that writes which must never
double carry their own guards — and this test covers the call log only. Whether
every other route taking an `Idempotency-Key` holds under the same race is not
tested anywhere.
