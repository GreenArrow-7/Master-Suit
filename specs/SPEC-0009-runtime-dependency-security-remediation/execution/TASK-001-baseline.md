# TASK-001 — baseline

Read-only. No file in `apps/web` was modified; `apps/web/package.json` and
`apps/web/package-lock.json` were verified untouched before and after.

Executed 2026-09-09 at `bff8d08`, branch `claude/demo-tenant-sales-hrms-420a5f`.
Satisfies `OBS-001`.

## 0. Finding that precedes the rest

The first command of this task — `git fetch origin --prune` — returned
`* [new branch] fix/dependency-advisories-2026-09`. That branch is pull request
`#48`, and it already carries this specification's remediation. `UNOWNED-001`
is not unowned. Recorded as `EVC-022`. The baseline below is still worth
having, because it is the "before" half of the comparison `#48` has to be
judged against, but it is a baseline for a review, not for an implementation.

## 1. Declared dependencies (`apps/web/package.json`)

| Package | Declared | Kind |
|---|---|---|
| `next` | `16.2.12` | dependency, **exact pin** |
| `nodemailer` | `^9.0.4` | dependency |
| `sharp` | — | not declared; reaches the tree through `next` |
| `eslint-config-next` | `^16.3.0` | devDependency |
| `react` / `react-dom` | `^19.0.0` | dependency |

`overrides`: `postcss ^8.5.18`, `sharp ^0.35.0`, `nanoid ^3.3.17`,
`deepmerge-ts ^8.0.1`, `mysql2 ^3.24.3`. 19 dependencies, 18 devDependencies.

## 2. Resolved versions (`apps/web/package-lock.json`, lockfileVersion 3)

831 entries. `next` 16.2.12, `@next/env` 16.2.12, all 8 `@next/swc-*` 16.2.12,
`@swc/helpers` 0.5.15, `nodemailer` 9.0.4, `sharp` 0.35.3, 13 `@img/sharp-*`
0.35.3, 13 `@img/sharp-libvips-*` 1.3.2.

`next@16.2.12` declares `sharp: ^0.34.5`. The tree holds 0.35.3 because
`overrides.sharp` replaces that declaration.

## 3. `npm audit --omit=dev` — exit 1

`{"info":0,"low":0,"moderate":0,"high":2,"critical":1,"total":3}`

Including devDependencies: 5 moderate, 3 high, 1 critical, total 9 — matching
what CI prints.

## 4. Advisories

| Package | Advisory | Severity | Affected | Direct |
|---|---|---|---|---|
| `next` | `GHSA-p293-qw3h-jr36` | critical | `>=16.0.0 <16.3.3` | yes |
| `next` | `GHSA-2xp9-vwfh-vxw4` | critical | `>=16.0.0 <16.3.3` | yes |
| `sharp` | `GHSA-rgj7-g3m4-5g8c` | high | `<0.35.4` | no |
| `nodemailer` | `GHSA-2x7j-588g-ccc2` | high | `<9.1.0` | yes |
| `nodemailer` | `GHSA-8m3c-c648-2xjj` | moderate | `<=9.1.0` | yes |
| `nodemailer` | `GHSA-wmmp-3585-3rmp` | moderate | `<9.1.0` | yes |
| `nodemailer` | `GHSA-cc9r-2j5m-2m83` | moderate | `>=6.9.16 <9.1.0` | yes |

`GHSA-p293-qw3h-jr36` is unauthenticated RCE on Windows-hosted servers;
`GHSA-2xp9-vwfh-vxw4` is unauthenticated RCE in the Image Optimization API on
AVIF input. Both are reachable on the request path this application serves.

## 5. Severity counts

Production: 0 low, 0 moderate, 2 high, 1 critical. Every package rolls up at
its own worst advisory, so `nodemailer` reports as high.

## 6. Relationship to the CI `verify` failure

`.github/workflows/ci.yml` runs one job, `verify`, whose last step (30, `Audit`)
is `npm audit --omit=dev --audit-level=high`. `.github/workflows/deploy.yml`
refuses any commit whose `verify` check-run on that exact SHA is not `success`.

| Run | Branch | Failed steps |
|---|---|---|
| `34247053426` | `dev/yourhan-next` (`#46`) | **only** 30 `Audit` |
| `34350575449` | `fix/p0-lead-delete-affordance` (`#47`) | **only** 30 `Audit` |
| `34366499027` | `#47`, current head `c34b10f` | **only** 30 `Audit` |
| `34350379563` | `fix/dependency-advisories-2026-09` (`#48`) | none — `success` |
| `34366512152` | `rc/incident-2026-09-09` (`#49`) | none — `success`, `E2E` included |

One red step, in last position, after every other gate had passed. Nothing else
in the pipeline is failing anywhere.

## 7. Full test suite

`npm run test` — **6 failed, 1986 passed, 2 skipped, of 1994**; 1 file failed of
157; 147s.

All six are in `apps/web/tests/security/demo-personas.spec.ts`. Re-run serially
with `--no-file-parallelism` alongside `tests/tenant`, `tests/permission` and
`tests/auth`: **72 files, 854 tests, all pass**. The failures are `CONV-015`
(`SPEC-0007`, OPEN) — the destructive reset racing the persona suite under file
parallelism — and are not dependency-related. Any post-upgrade comparison must
subtract them.

## 8. Build

`npm run build` — exit 0. Next.js 16.2.12 (Turbopack), compiled in 43s, full
route manifest emitted.

`npm run typecheck` — exit 0.

## 9. Auth and security

`tests/security`, `tests/tenant`, `tests/permission`, `tests/auth`, serial:
**854 passed, 0 failed**. Sign-in, session issue and revocation, platform-session
purpose enforcement, tenant isolation and role scoping all green.

## 10. Sales and HRMS demonstration

`tests/sales` and `tests/hr`, serial: **50 files, 774 tests, all pass**. The
`redis is down` and `antivirus: scan failed` lines in that output are deliberate
negative-path fixtures inside passing cases.

The temporary demonstration was not disturbed: it serves from `.next-prod`,
`next build` writes `.next`, and both `http://localhost:3100/login` and the
public tunnel answered HTTP 200 after the build.

## 11. Proposed graph, verified without implementing it

`apps/web/package.json` and `package-lock.json` from `#48` were copied into a
scratch directory and audited with `--package-lock-only`. Nothing in the
repository was written.

- **`npm audit --omit=dev` → `found 0 vulnerabilities`.** All severities zero.
- Lockfile delta against `dev/yourhan-next`: **39 entries changed, 0 added, 0
  removed**, 831 before and after. 26 `sharp`/`@img` (13 platform binaries
  0.35.3→0.35.4, 13 libvips 1.3.2→1.3.3), 9 `next` (`@next/env` + 8
  `@next/swc-*`), `@swc/helpers` 0.5.15→0.5.23, `next`, `nodemailer`, `sharp`.
- `apps/web/package.json` delta: **one line**, `"next": "16.2.12"` →
  `"16.3.4"`.
- Registry check: `next@16.3.2` and `next@16.3.3` both declare `sharp:
  ^0.35.3`; only `next@16.3.4` declares `^0.35.4`. 16.3.3 clears the two
  criticals but readmits the vulnerable `sharp`, so 16.3.4 is the correct
  target on the dependency constraint, independently of what `npm audit fix
  --force` suggests.
- `^9.0.4` admits `9.1.1` and `9.1.1` is the newest 9.x, so `nodemailer` needs
  no manifest change.
- Linux CI: `@img/sharp-linux-x64`, `-linux-arm64`, `-linuxmusl-*` and
  `@next/swc-linux-*` are all present in the lockfile at the fixed versions.

## 12. `CL-003` — measured, not argued

In a scratch tree holding `next@16.3.4` with `overrides.sharp` forced to
`0.35.3`, npm resolved `node_modules/next/node_modules/sharp` to **0.35.3** and
the audit reported **2 HIGH** — even though `next@16.3.4` declares `^0.35.4`.
The same tree with `overrides.sharp: ^0.35.4` resolves `sharp` 0.35.4 and
reports `found 0 vulnerabilities`.

An `overrides` entry outranks the parent package's own declared range. While the
override stands at `^0.35.0` it is the only thing setting the floor, and the
floor it guarantees is 0.35.0. `#48` does not change it.

## 13. Residual advisories on the proposed graph

Production, all severities: **zero**. There is no remaining moderate or low
production finding to dispose of.

Development-only, which the `--omit=dev` gate does not evaluate and this
specification places out of scope: `js-yaml` high (transitive), `vitest` and
`@vitest/mocker` moderate, `autocannon` and `hyperid` moderate, `uuid`
moderate — 1 high and 5 moderate. Unchanged by this remediation, and reported
rather than omitted per `AC-007`.
