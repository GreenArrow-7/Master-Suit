# sharp 0.35.5 for a new advisory

**What.** `sharp`, which Next.js pulls in for image optimisation, moves from
0.35.4 to 0.35.5 in `apps/web/package-lock.json`, with its `@img/*` platform
packages. PR #130, and with it every PR stacked on it.

**Why.** CI's audit step (`npm audit --omit=dev --audit-level=high`) failed on
7 Oct on a new high advisory against sharp's bundled librsvg
(GHSA-wq5f-xc86-pv6w, fixed in 0.35.5). Nothing in the code changed; the same
step would fail on any branch until the lockfile moved, as with
[source-map-js](2026-10-06-source-map-js-advisory.md) the day before.

**Where.** `apps/web/package-lock.json` only — `npm update sharp`, within the
range Next.js asks for.

**Verified.** `npm audit --omit=dev --audit-level=high` reports 0
vulnerabilities; the lockfile diff touches only `sharp` and `@img/*`.

**Left open.** Nothing.
