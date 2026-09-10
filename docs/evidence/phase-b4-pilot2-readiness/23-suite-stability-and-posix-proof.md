# Regression-suite stability and POSIX security proof

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Covers | `BLK-008` (`BUG-004`, `BUG-005`) and `BLK-007` |
| Specification | `SPEC-0006`, `R1`, `VERIFYING` |

---

## BLK-008 — regression-suite stability: **CLOSED**

### Three consecutive full-suite runs, no code change between them

| Run | Total | Pass | Fail | Skip | Exit |
|---|---|---|---|---|---|
| 1 | 1920 | **1914** | 4 | 2 | 1 |
| 2 | 1920 | **1914** | 4 | 2 | 1 |
| 3 | 1920 | **1914** | 4 | 2 | 1 |

Run 1 duration 163.84 s. Exit 1 is expected and correct — the four `RC-4`
failures are real and are not suppressed.

**The failing set is identical across all three runs**, and contains nothing
else:

```
3 × capture-vault > storing a capture > returns the same relative path shape…
3 × capture-vault > reading a capture > still reads a capture written before…
3 × capture-vault > retention > deletes what is past the window and keeps…
3 × capture-vault > retention > keeps an object the listing could not date
```

Four distinct tests, each failing in each of three runs. **No random fifth
failure.** `BLK-008` is closed on that evidence.

For contrast, the four runs *before* the repair: `1914·4·2`, `1914·4·2`,
`1913·5·2`, `1913·5·2` — with a **different** fifth test each time.

### BUG-004 — how it was repaired

The test exhausted a 600-request budget with 600 sequential `consume()`
round-trips. The limiter uses a fixed window keyed
`rl:<key>:<floor(now / 60000)>`, so a loop that straddles a minute boundary
starts a fresh counter — the request then finds budget, the limiter correctly
allows it, and the route falls through to signature checking and answers `401`.

Replaced by writing the counter directly, for the **current and the next**
window, so the precondition holds however the clock falls. Two Redis operations
instead of 600 round-trips.

**The security invariant is untouched.** The assertions — `429` and a
`retry-after` header — are byte-identical. `consume()` refuses on
`count > max`, so writing `max` reproduces exactly the state 600 successful
consumes produced, and the route's own increment remains the one that crosses
the line. That is still precisely what the case proves.

### BUG-005 — how it was repaired

`vi.resetModules()` plus a dynamic import meant the **first case** paid the
cold resolution of the `prisma/config` package. With 152 files in parallel that
cost alone exceeded the 30-second test budget. It was a timeout, not an
assertion failure, and it never reproduced in isolation.

`prisma.config` is now resolved once in a `beforeAll`. One-time setup is paid in
setup. `hookTimeout` was already 60 s in `vitest.config.mts` and is **not**
raised. Both cases still call `shadowUrlFor`, which still resets modules and
re-imports, so each still reads a freshly evaluated config, and neither
assertion changed.

### What was deliberately not used

| Prohibited route | Used? |
|---|---|
| change expected `429` to `401` | no |
| disable, skip or delete a test | no |
| add a sleep | no |
| add a retry | no |
| raise a timeout | no |
| remove a rate-limit assertion | no |
| mock away the functionality under test | no |
| change product code | no — the diff is entirely under `apps/web/tests/` |

The limiter needed no change to be testable deterministically, so no
product-code risk classification was required.

---

## BLK-007 — POSIX/Linux security proof: **CLOSED**

Obtained locally rather than deferred to CI. A minimal Linux environment was
built inside `node:24-bookworm` — the two entrypoint scripts, the two config
files and the spec, LF-normalised **in the copy only**, with `vitest@4.1.10`
installed. The Windows worktree was mounted read-only and is unmodified; no
line-ending change was committed.

```
Linux x86_64 · node v24.20.0
✓ alertmanager-entrypoint.sh > writes the relay password into a file readable by nobody else   25ms
✓ prometheus-entrypoint.sh  > writes the scrape token into a file readable by nobody else       7ms
Test Files  1 passed (1)
      Tests  20 passed (20)
```

| Case | Platform | Executed | Result |
|---|---|---|---|
| *writes the relay password into a file readable by nobody else* | Linux x86_64, node v24.20.0 | **YES** | **PASS** |
| *writes the scrape token into a file readable by nobody else* | Linux x86_64, node v24.20.0 | **YES** | **PASS** |

**20 passed on Linux; Windows reports 18 passed and 2 skipped.** The two extra
are exactly these. `CONV-002` condition 4 — *production release requires proof
from a POSIX/Linux execution environment* — is **met**, and the two Windows
skips are now a documented platform limitation with the property proved
elsewhere rather than an unverified claim.

`EVC-014`'s CI-runs-Linux assertion is no longer the only support for this; it
remains `DOCUMENTED` for CI specifically, which no longer matters here.

---

## Appendix — the earlier partial attempts, kept

The first two attempts failed, and both failures were informative.

The requirement is that the two POSIX-only cases **EXECUTE and PASS** on
Linux — not skip, and not merely "CI uses Linux". Here is exactly what was
obtained and what was not.

### Evidence 1 — the cases execute on Linux

`node:24-bookworm`, vitest run of `apps/web/tests/unit/observability.spec.ts`:

```
Tests  20 failed (20)
```

**20 tests, where Windows reports 18 with 2 skipped.** That is direct evidence
that `itPosix` resolves to `it` on Linux and both mode assertions run there.
`EVC-014`'s claim moves from `DOCUMENTED` to observed on this point.

They then **failed for an environmental reason, not a product one**: the
bind-mounted Windows checkout carries CRLF, so `sh` refuses the entrypoint
scripts. Confirmed directly:

```
infra/prometheus-entrypoint.sh: 14: set: Illegal option -
```

That is `set -eu\r`. The same CRLF root-cause class as `RC-1`, this time
breaking a shell script rather than a text scan.

### Evidence 2 — the asserted property holds on Linux

The scripts were run in the same Linux image from a CR-stripped copy — the host
worktree was mounted read-only and not modified:

```
Linux x86_64 · node v24.20.0
/out1/smtp-password  mode=600
/out2/metrics-token  mode=600
```

`0600` on both files. That is exactly what the two cases assert
(`statSync(f).mode & 0o777 === 0o600`).

### Why the third attempt worked

The first two attempts tried to reproduce the whole repository inside the
container. Copying `apps/web` across a Windows bind mount ran for ten minutes at
0.3% CPU and was killed.

The spec imports only `node:child_process`, `node:fs`, `node:os`, `node:path`
and `vitest` — no path alias, no Prisma, no native dependency. So the third
attempt copied three things (the spec, `infra/`, and nothing else) and installed
one package. It completed in under a minute.

**The lesson worth keeping:** "run it on Linux" did not need the repository on
Linux. It needed the two shell scripts and vitest.
