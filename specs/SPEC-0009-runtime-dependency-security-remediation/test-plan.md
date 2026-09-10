# SPEC-0009 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |

> **Revision 2, 2026-09-09.** Narrowed with the specification. Revision 1's plan
> tested a three-package upgrade; that upgrade is delivered by `#48` and its
> evidence is `#48`'s CI, not this plan. What remains to prove is narrower and
> sharper: that the declared floor, rather than today's luck of resolution, is
> what holds `sharp` at a patched version.
>
> Identifiers are not reused for different meanings. `ST-007` and `UT-005` are
> new. `ST-003`, `UT-001` and `UT-003` are retained with their scope reduced to
> the narrowed change. `IT-002` is retired — image optimisation regression
> belonged to the `next` minor, which `#48` owns.

## Security

- `ST-001` verifies `FR-003`, `SEC-003`, `AC-001` — `npm audit --omit=dev
  --audit-level=high` exits 0 from the committed lockfile, with 0 high and 0
  critical.
- `ST-002` verifies `NFR-001`, `SEC-003` — No suppression was introduced: no
  audit ignore file exists, `.github/workflows/ci.yml`'s Audit step is
  unmodified, and no `overrides` entry pins a package *below* an advisory's
  fixed version.
- `ST-003` verifies `FR-001`, `FR-002`, `AC-002` — `overrides.sharp` in
  `apps/web/package.json` is `^0.35.4`, and the resolved `sharp` in
  `apps/web/package-lock.json` is at or above `0.35.4`. Asserted against both,
  because a declared range is a promise and a lockfile is a fact, and this
  change exists precisely because the two can disagree.
- `ST-007` verifies `SEC-001`, `AC-004` — **The declaration, not the lockfile,
  is what holds the floor.** In a scratch tree, force `overrides.sharp` below
  `0.35.4`, regenerate the lockfile, and assert that `npm audit --omit=dev`
  reports the `sharp` advisory `GHSA-rgj7-g3m4-5g8c`; then restore `^0.35.4`
  and assert it reports none. This is the only test that proves the change does
  anything at all, since on the current graph the resolved version is already
  correct. It runs entirely in a temporary directory and touches no manifest in
  the repository.
- `ST-004` verifies `SEC-002` — The existing authentication suite passes
  unchanged: sign-in, sign-out, session issue and revocation.
- `ST-005` verifies `SEC-002` — `tests/tenant` passes unchanged, including the
  row-level security cases.
- `ST-006` verifies `SEC-002` — `tests/security` passes unchanged, including
  platform-control-plane denial for a tenant-scoped account.

*(Revision 1's `ST-008`, proving the mail provider is inert, belonged to the
`nodemailer` upgrade and is retired with it. `#48` carries that risk.)*

## Unit and regression

- `UT-001` verifies `FR-004`, `AC-003` — The diff is confined: one line in
  `apps/web/package.json`, and no package other than `sharp` changing resolved
  version in `apps/web/package-lock.json`. Written because "the fix also quietly
  moved 300 other packages" is the failure mode a reviewer of a security change
  is least likely to catch by eye.
- `UT-003` verifies `OBS-001` — The audit result is recorded by severity before
  and after, so the before-and-after is evidence rather than recollection.
- `UT-004` verifies `DATA-001` — `npm run check:drift` reports no schema
  difference. The cheap proof that a manifest change did not touch the schema.
- `UT-002` verifies `FR-005` — `npm ci` from the committed lockfile reproduces
  the graph, with `sharp` at or above `0.35.4`.
- `UT-005` verifies `RISK-002` — Enumerate every `overrides` entry and assert
  that none of them declares a floor below a version covered by a current
  production advisory. Generalises `ST-003` so the next entry to acquire an
  advisory is caught by an existing test rather than rediscovered.
- `REG-001` verifies `AC-005` — The full suite has no failure that did not exist
  in the `TASK-001` baseline. Attribution is against that baseline, because
  `SPEC-0007`/`CONV-015` makes the persona suite intermittently red for an
  unrelated reason.

## Build

- `IT-001` verifies `NFR-002`, `AC-006` — `npm run build` succeeds.
- `IT-003` verifies `ASM-002` — The lockfile contains the Linux `@img/sharp-*`
  binaries CI resolves, at or above `0.35.4`, not only the Windows ones a local
  run touches.

## End to end

- `E2E-001` verifies `AC-005` — The client demonstration walkthrough passes:
  sign-in as the client login, Sales, HRMS, one unbroken session, tenant
  isolation, platform-admin denial, sign-out.

## Gates that must stay green

`npm run typecheck`, `npm run lint`, `node tools/sdd/cli.mjs validate --all`,
the SDD tooling suites, and the CI `verify` job.

## What is not tested, and why

- That no behaviour changed between `next` 16.2 and 16.3. Out of scope: that is
  `#48`'s change and `#48`'s CI answered it, `E2E` included, on run
  `34366512152`.
- Moderate and low advisories. On the `#48` graph there are none in production.
  The development-only ones are reported under `AC-007`, not fixed.
- That `sharp` 0.35.4 is itself free of undiscovered vulnerabilities. No test
  can prove that; the floor is a floor, not a guarantee.
