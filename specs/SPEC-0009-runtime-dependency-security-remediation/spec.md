# SPEC-0009 — Sharp security floor hardening

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Slug | `runtime-dependency-security-remediation` |
| Risk | `R4` |
| Status | `READY_FOR_APPROVAL` |
| Owner | Application Security, with the application maintainer |
| Supersedes | — |
| Superseded by | — |

> **Scope narrowed 2026-09-09, revision 2.** This specification was written to
> remediate three production dependency advisories believed to be unowned. That
> premise was false: pull request `#48` already carried the remediation and CI
> proved it. See `EVC-022`. The three-package upgrade below is **delivered work,
> attributed to `#48`, and is not reimplemented here.** What remains is the one
> decision `#48` did not make: the `sharp` override floor.
>
> Revision 1 is preserved in git history rather than rewritten. The sections
> describing the upgrade are retained as *context*, marked delivered, because
> the remaining change cannot be judged without them.

## Problem

`npm audit --omit=dev --audit-level=high` failed as a CI gate
(`.github/workflows/ci.yml`, step 30, `Audit`) from 2026-09-08. Three production
dependencies carried advisories: two critical in `next`, one high in `sharp`,
one high plus three moderate in `nodemailer`.

**That part is fixed.** `#48` moved `next` `16.2.12` to `16.3.4`, `nodemailer`
`9.0.4` to `9.1.1` and `sharp` `0.35.3` to `0.35.4` — one line of
`apps/web/package.json` and 39 lockfile entries. Its CI run `34350379563`
concluded `success`.

**What is not fixed** is the mechanism holding `sharp` at the patched version.
`apps/web/package.json` carries an `overrides` block, and `overrides.sharp` is
`^0.35.0`. An `overrides` entry replaces the parent package's own declared
range, so it — not `next` — decides which `sharp` the tree resolves.

Measured in an isolated tree at `TASK-001`:

| `next` | `overrides.sharp` | resolved `sharp` | `npm audit --omit=dev` |
|---|---|---|---|
| 16.3.4 | `0.35.3` | **0.35.3** | **2 high** |
| 16.3.4 | `^0.35.4` | 0.35.4 | `found 0 vulnerabilities` |

`next@16.3.4` declares `sharp: ^0.35.4` itself, and the override overrode it.
The tree is correct today only because `^0.35.0` happens to resolve to the
highest matching version, which is currently 0.35.4. The floor the manifest
*guarantees* is 0.35.0 — a version `GHSA-rgj7-g3m4-5g8c` covers.

## Goal

Make the guaranteed floor equal the required floor, and change nothing else.

## Scope

- `apps/web/package.json` — the `overrides.sharp` value, one line.
- `apps/web/package-lock.json` — only if npm's deterministic resolution alters
  it. On the `#48` graph `sharp` is already 0.35.4, so the expected delta is the
  `overrides` mirror only, or nothing.

## Out of scope

- The `next`, `nodemailer` and `sharp` version upgrades. **Delivered by `#48`.**
- Every other entry in the `overrides` block. `postcss`, `nanoid`,
  `deepmerge-ts` and `mysql2` carry no current production advisory.
- Development-only advisories. The gate is `--omit=dev`.
- Dependabot or Renovate. That is the answer to *recurrence*, a different
  change.
- `.github/workflows/*`. The gate is correct and is not being weakened.

## Functional requirements

- `FR-001` — `overrides.sharp` in `apps/web/package.json` declares a floor at or
  above `0.35.4`.
- `FR-002` — The resolved `sharp` in `apps/web/package-lock.json` is at or above
  `0.35.4`.
- `FR-003` — `npm audit --omit=dev --audit-level=high` exits 0.
- `FR-004` — No package other than `sharp` changes resolved version. A change
  touching unrelated packages is a defect in the remediation, not an outcome of
  it.
- `FR-005` — `npm ci` reproduces the graph from the committed lockfile.

*(Revision 1's `FR-006`, requiring the `next` upgrade, is delivered by `#48` and
is retired rather than renumbered.)*

## Non-functional requirements

- `NFR-001` — No audit exclusion, ignore file or `--audit-level` change is added
  for the purpose of hiding an advisory.
- `NFR-002` — The application builds in the standalone production
  configuration.

## Security requirements

- `SEC-001` — The declared floor is not merely satisfied by today's resolution;
  it is enforced by the declaration, so a future `apps/web/package-lock.json`
  regeneration cannot resolve below it.
- `SEC-002` — Authentication, tenant isolation and authorization behaviour are
  unchanged. This change touches no source file.
- `SEC-003` — No advisory is resolved by suppression.

## Data and privacy requirements

- `DATA-001` — No schema change, no migration, no data movement.

## Observability requirements

- `OBS-001` — The audit result by severity is recorded before and after.

## Acceptance criteria

- `AC-001` — Given the committed manifests, when `npm audit --omit=dev
  --audit-level=high` runs, then it exits 0 with 0 high and 0 critical.
- `AC-002` — Given `apps/web/package.json`, when `overrides.sharp` is read, then
  it is `^0.35.4`.
- `AC-003` — Given the diff, when it is reviewed, then `apps/web/package.json`
  changes by one line and no package other than `sharp` changes resolved
  version.
- `AC-004` — Given a tree whose override is forced below `0.35.4`, when the
  lockfile is regenerated, then the audit reports the `sharp` advisory,
  demonstrating that the declaration is what holds the floor.
- `AC-005` — Given the change, when the full test suite runs, then there are no
  failures that did not exist at the `TASK-001` baseline.
- `AC-006` — Given the change, when `npm run build` runs, then it succeeds.
- `AC-007` — Given any production advisory that remains at any severity, when
  the work is reported, then it is listed explicitly rather than omitted.

## Dependencies

- **`#48` must be integrated into `dev/yourhan-next` first.** This change is
  meaningless against a tree where `sharp` is still 0.35.3, because the floor it
  declares would then force an upgrade rather than hold one — a different and
  larger change than the one specified here.
- `SPEC-0007` supplies the demonstration data the regression evidence uses. It
  is at `IMPLEMENTING` with `CONV-015` open; that finding is about test
  isolation, and attribution of any persona-suite failure must account for it.

## Assumptions

- `ASM-001` — Registry advisory metadata is authoritative for fixed ranges,
  verified per package rather than taken from `npm audit fix --force`.
- `ASM-002` — CI runs Linux; the lockfile carries every platform binary, and
  `TASK-001` confirmed the Linux `sharp` and `swc` entries present at the fixed
  versions.

## Risks

- `RISK-001` — A tightened floor can only fail *closed*: if a future `sharp`
  release were incompatible, resolution fails loudly rather than silently
  serving a vulnerable version. That is the intended failure mode.
- `RISK-002` — The floor is `sharp`-specific. The other four `overrides` entries
  share the same structural weakness and are deliberately not addressed; if one
  acquires an advisory, this finding recurs there. Recorded as a follow-up, not
  absorbed.

## Rollback

Revert the commit. One declaration line and at most a lockfile mirror; no
migration, no data movement, no configuration change.

## Revision history

| Date | Change | By | Change record |
|---|---|---|---|
| 2026-09-09 | Created for `UNOWNED-001` | Agent, PLANNER role | — |
| 2026-09-09 | Revision 2 — narrowed to the `sharp` override floor after `EVC-022` found the upgrade already delivered by `#48`. Human scope decision. Risk reassessed and retained at `R4` on different grounds; see `CL-006`. | Agent, PLANNER role | none required; no approval had been recorded, so change control had not begun |

## Approval

| Gate | Role | Decision | Date | Scope |
|---|---|---|---|---|
| Specification approval | Product Owner and Solution Architect | not recorded | — | — |
| Security risk acceptance | Application Security | not recorded | — | — |
| Implementation readiness | Solution Architect | not recorded | — | — |
