# The rate-limit spec failed when a window turned mid-case

**What.** `apps/web/tests/security/ratelimit.spec.ts` now pins `Date` for every
case, and its retry-after case checks the actual value. PR #135, test file only.

**Why.** "Cannot be starved — refused attempts do not extend the window" failed
in a full parallel `npx vitest run` on 7 Oct and passed alone: the third call
resolved `{ remaining: 1, resetAt: <the next minute> }` instead of a 429. The
limiter's windows are fixed slices of the wall clock (`floor(Date.now() /
windowMs)`), so when a window boundary passed between spending a bucket and
expecting the refusal, the refusal landed in a fresh window. Six of the file's
seven cases had that exposure, the two login cases on five-minute windows
included; only the TTL case did not. Separately, "reports a retry-after that
does not exceed the window" checked only that `retryAfter` was a number.

**Where.** The spec only. A file-level `beforeEach` fakes `Date` alone
(`toFake: ['Date']`) and sets it one second into a five-minute window, the same
idiom as the webhook case in `p2-regressions.spec.ts`. The Redis client and the
counters' TTLs stay on the real clock. No app code changed.

**Behaviour.** None for users.

**Verified.** Under a preload that runs `Date` a million times fast (one real
millisecond is about 17 minutes), the old file fails 6 of 7 cases and the new
one passes all 7. The spec ran green 20 times on the real clock and 20 times on
the fast one. The retry-after case fails on a limiter that reports milliseconds
(59000 received); the old assertion passed that limiter. Prettier and eslint
are clean.

**Left open.** Two other specs drive a fixed window on the real clock and can
flake the same way: `tests/unit/cache-invalidation.spec.ts` ("lets a throttled
key through again immediately", 900 s windows) and
`tests/security/dual-credential-auth.spec.ts` ("attempts against either
password spend one per-account allowance", 300 s). `account-deletion-http.spec.ts`
already waits out a window's last minute.
