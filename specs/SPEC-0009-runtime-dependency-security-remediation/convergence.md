# SPEC-0009 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |
| Prepared by | AI agent, CONVERGENCE_REVIEWER role |
| Date | 2026-09-09 |
| Recommended verdict | `PASS` |
| Accepted by | **not accepted** — gate 6 belongs to Application Security at R4 for security findings |

An agent prepared this and recommends a verdict. It is not an acceptance.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement implemented | **PASS** — `FR-001` to `FR-005`, `NFR-001`, `NFR-002`, `SEC-001` to `SEC-003`, `DATA-001`, `OBS-001` |
| 2 | Every acceptance criterion verified | **PASS** — `AC-001` to `AC-007` map to passing cases in `traceability.md` |
| 3 | Every security requirement has a security test | **PASS** — `SEC-001`→`ST-007`, `SEC-002`→`ST-004`/`ST-005`/`ST-006`, `SEC-003`→`ST-001`/`ST-002` |
| 4 | All required tests pass; failures explained | **PASS** — see below |
| 5 | No task left without a decision | `TASK-001` and `TASK-002` COMPLETE; `TASK-003` executed as part of the same verification; `TASK-004` is this document |
| 6 | No behaviour implemented that no requirement asked for | **PASS** — one declaration line |
| 7 | No undocumented architecture change | **PASS** — `AD-007` to `AD-010` |
| 8 | No undocumented dependency change | **PASS with one recorded metadata change** — see `fsevents` below |
| 9 | Migration matches the plan | **PASS** — plan said none; none |
| 10 | Documentation updated where this made it untrue | **PASS** — `EVC-023` addendum 2 corrects the checking rule this work falsified |
| 11 | No new evidence conflict introduced, or it is registered | **PASS** — `EVC-023` addendum 2 registered |
| 12 | Known limitations recorded with owners | **PASS** — `RISK-002` below |
| 13 | Residual risk accepted by the right role | **PENDING** — gate 6, Application Security |
| 14 | Rollback written down and feasible | **PASS** — revert one line; no migration, no data movement |
| 15 | `AGENTS.md` §8 items hold | **PASS** — failures reported with their output, nothing described as verified that was not run |

## What changed

| File | Change |
|---|---|
| `apps/web/package.json` | one line — `overrides.sharp` `^0.35.0` → `^0.35.4` |
| `apps/web/package-lock.json` | 0 packages added, 0 removed, 0 resolved versions changed; one stale metadata flag dropped, below |

## The `fsevents` metadata change, stated precisely

Reconciling the lockfile also removed `"dev": true` from `node_modules/fsevents`
(2.3.2).

**Does it affect production dependency classification? Yes, and this is the
honest answer rather than the comfortable one.** npm's non-dev entry count moves
from **320 to 321**. `fsevents` is now classified as reachable from the
production graph rather than dev-only, which means `npm audit --omit=dev` will
evaluate it from now on where previously it did not.

Three facts bound what that means:

1. `fsevents` is `"optional": true` and `"os": ["darwin"]`. It is not installed
   on Linux, which is what CI and every deployed environment run.
2. It carries no current advisory. The production audit reports 0 at every
   severity with the flag removed.
3. **The change is not caused by this specification.** Control test: reconciling
   the **unmodified** `apps/web/package.json` — `overrides.sharp` still
   `^0.35.0` — removes the same flag. It is pre-existing drift in the lockfile
   inherited from pull request `#48`, surfaced here because this is the first
   reconciliation since.

It was kept rather than reverted. Reverting would leave the committed lockfile
disagreeing with npm's own deterministic output, so the next person to run
`npm install` would see it reappear as an unexplained diff.

## Findings

### CONV-001 — `RISK-002` is a latent pattern, not four vulnerabilities

**Status:** `ACCEPTED_RISK` pending gate 6 · **Severity:** low · **Owner:**
Application Security

The other four `overrides` entries share the structural property that made the
`sharp` entry dangerous — an npm override replaces the parent's declared range,
so a floor below the resolved version is what the manifest actually guarantees:

| Entry | Declared floor | Currently resolved | Current production advisory |
|---|---|---|---|
| `postcss` | `^8.5.18` | 8.5.25 | none |
| `nanoid` | `^3.3.17` | 3.3.18 | none |
| `deepmerge-ts` | `^8.0.1` | 8.0.2 | none |
| `mysql2` | `^3.24.3` | 3.24.3 | none |

**None of these is a vulnerability.** No advisory covers any of them today, and
none is being described as exposed. What is true is that if one acquires an
advisory, the override would hold the tree below the fix and the audit would
report it as a problem in some other package's dependency — sending the next
reader to the wrong file, exactly as happened with `sharp`. `UT-005` enumerates
every entry and fails if any names a package under a current production
advisory, so the next occurrence is caught by an existing test.

### CONV-002 — this work falsified the formatting rule written an hour earlier

**Status:** `RESOLVED` · **Severity:** low

`EVC-023` addendum 1 established "run `prettier --check` against only the files
a change touches". This change's single-line `apps/web/package.json` edit failed that
check while being clean: `core.autocrlf=true` checks files out CRLF, and any
file Prettier has not itself rewritten fails regardless of content. Addendum 2
corrects the rule to read the file out of the index rather than off disk. No
defect in this change; a defect in the rule.

## Test results

| Test | Result |
|---|---|
| `ST-001` audit exits 0 | **PASS** — 0 critical, 0 high, 0 moderate, 0 low |
| `ST-002` no suppression | **PASS** — no ignore file; `.github/workflows/ci.yml` byte-identical to `origin/main` |
| `ST-003` floor declared and resolved | **PASS** — `^0.35.4` declared, 0.35.4 resolved |
| `ST-007` the declaration holds the floor | **PASS** — forced to `0.35.3`, sharp resolves 0.35.3 and the audit reports **2 high** including `GHSA-rgj7-g3m4-5g8c` |
| `UT-001` diff confined | **PASS** — 0 added, 0 removed, 0 version changes |
| `UT-002` `npm ci` reproduces | **PASS** — exit 0, sharp 0.35.4 |
| `UT-005` every override checked | **PASS** — 5 entries, none under a current advisory |
| `ST-004` `ST-005` `ST-006` unchanged behaviour | **PASS** — full suite 157 files, 1992 passed, 2 skipped, 0 failed |
| `IT-001` build | **PASS** — Next.js 16.3.4 |
| `UT-004` schema drift | not run — no schema file touched; `DATA-001` is satisfied by inspection |
| `IT-003` Linux binaries | **PASS** — every `@img/sharp-linux*` at 0.35.4 |

`B2` 91/93 and `B3` 69/70 remain the `EVC-020` Windows CRLF cases, untouched by
this work and not product failures.

## The comparison evidence, preserved

The measurement this specification exists for, retained so the decision can be
re-examined without re-running it:

| `next` | `overrides.sharp` | resolved `sharp` | `npm audit --omit=dev` |
|---|---|---|---|
| 16.3.4 | `^0.35.0` (before) | 0.35.4 | 0 vulnerabilities |
| 16.3.4 | `0.35.3` (forced) | **0.35.3** | **2 high** |
| 16.3.4 | `^0.35.4` (after) | 0.35.4 | 0 vulnerabilities |

The first and third rows are identical in outcome. That is the point: on the
current graph this change is invisible, and the second row is the only evidence
it does anything at all.

## Recommended verdict

**PASS.** One line, no resolved version moved, the audit gate green at every
severity, and the control the change installs demonstrated by breaking it.

Gate 6 at R4 for a security finding belongs to Application Security. Not
accepted by an agent.
