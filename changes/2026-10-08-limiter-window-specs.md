# Two more specs could fail when a limiter window turned mid-case

**What.** The two rate-limit reset cases of
`apps/web/tests/unit/cache-invalidation.spec.ts` and one case of
`apps/web/tests/security/dual-credential-auth.spec.ts` now pin `Date`, as #135
did for `ratelimit.spec.ts`. They are the two specs #135's entry left open.
PR #138, test files only.

**Why.** The limiter's windows are fixed slices of the wall clock
(`floor(Date.now() / windowMs)`), and both specs drove them on the real clock.
In cache-invalidation, a fifteen-minute boundary between spending the bucket and
expecting the refusal let the refusal through, and one between computing the
previous window and calling `clearLimit` made `clearLimit` drop the wrong two
keys. In dual-credential-auth, "attempts against either password spend one
per-account allowance" makes six sign-ins against the five-per-five-minutes
account limit, ten Argon2 verifications before the sixth; a boundary inside that
loop let the sixth through to the password check.

**Where.**

- `cache-invalidation.spec.ts` — a `beforeEach` in "rate-limit reset" pins
  `Date` one second into a 900 s window; an `afterEach` restores it.
- `dual-credential-auth.spec.ts` — the one case pins `Date` one second into a
  300 s window; its describe's `afterEach` restores it.

Only `Date` is faked (`toFake: ['Date']`); the Redis client and the counters'
TTLs keep the real clock. The rest of dual-credential-auth signs in with
authenticator codes and checks sessions, which a faked clock disturbs, so the pin
covers that one case, and the case reaches neither: five attempts stop at the
password, the sixth at the limiter. The lockout it can set, timed from the
pinned clock, it clears itself. Waiting out a window's last minute, as
`account-deletion-http.spec.ts` does, was the alternative; a pin cannot straddle
a boundary and costs no wait.

**Behaviour.** None for users.

**Verified.** Under a preload that runs `Date` a million times fast: the old
cache-invalidation spec fails both reset cases ("promise resolved { remaining: 1 }
instead of rejecting", "expected '99' to be null") and the new one passes 5/5;
the old dual-credential case, run alone with `-t`, answers the sixth attempt 401
instead of 429, and the new one passes. That case runs alone because the rest of
its file breaks on a fast clock by design. Twenty runs each, all green:
cache-invalidation on the real and the fast clock, the dual-credential case on
the fast clock, and the whole dual-credential file (38 cases) on the real clock.
Against throwaway Postgres and Redis containers. Prettier and eslint are clean.

**Left open.** No other spec spends a limiter bucket on the real clock. The same
shape on another clock: "enforces the per-tenant daily cap" in
`conversation-intelligence-flow.spec.ts` counts sessions since local midnight, so
a run crossing midnight between that case and the one before it gets past the
cap.
