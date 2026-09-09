# Cross-reference audit

## Path references

Every repository path referenced from a Phase B2 artefact, the SDD documents,
`tools/sdd/README.md`, `AGENTS.md` and `CLAUDE.md` was extracted and checked.

| Metric | Value |
|---|---|
| Distinct paths referenced | 62 |
| Broken references | **0** |

## The previously unresolved reference is now resolved

An earlier run of this audit recorded one intentional gap:
`.github/workflows/sdd-validate.yml`, cited as the path a then-unapplied
workflow would occupy. The workflow now exists, added under `CHG-001`, so the
reference resolves and the count is clean.

`validate --all` reports zero errors. Note that `SDD-V040` polices references
inside specification artefacts; references in `docs/sdd/` are checked by this
audit rather than by the validator.

The gap and its closure are both recorded, rather than the earlier state being
quietly overwritten.

## Identifier references

| Check | Result |
|---|---|
| Validation rule ids used in documentation | 41 |
| Rule ids defined in `tools/sdd/rules/rules.mjs` | 41 |
| Documented but undefined | 0 |
| Defined but undocumented | 0 |
| In-spec identifier prefixes used | 22 |
| Prefixes defined in `IDENTIFIER_STANDARD.md` | 22 |
| Orphans | 0 |

The validator enforces this class of integrity for specification artefacts
itself: `SDD-V016` for qualified references, `SDD-V030` for traceability
references, `SDD-V035` for evidence-conflict ids, `SDD-V040` for document
references. All four have passing negative tests.

## References into pre-existing registers

| Register | Cited in B2 | Modified by B2 |
|---|---|---|
| `EVC-NNN` — `docs/EVIDENCE_CONFLICTS.md` | `SPEC-0001` cites `EVC-014` in its manifest and risks | **No** |
| `SEC-OBS-NNN` | Referenced in the security review context | No |
| `GAP-<AREA>-NN` | GAP-CI-01, GAP-DEP-01 cited as unknowns | No |
| `R0`–`R5` | Throughout | No |

The evidence conflict register is unchanged. Its tally remains 9 OPEN, 3
PARTIALLY RESOLVED, 2 ACCEPTED DIFFERENCE, 0 RESOLVED, as Phase A left it and
Phase B1 preserved it. `SDD-V036` now mechanically prevents a specification
from marking a conflict resolved, with a passing negative test — the B1 rule
made structural.

## Two-way consistency

| Definition | Application | Consistent |
|---|---|---|
| `MACHINE_CONTRACT.md` fields | `sdd-manifest.schema.json`, `SDD_MANIFEST_TEMPLATE.json`, `manifest.mjs` | yes |
| `VALIDATION_RULES.md` | `rules.mjs` | yes, all 41 |
| `SPEC_LIFECYCLE.md` states | `lifecycle.mjs` | yes, all 14 |
| `HUMAN_APPROVAL_GATES.md` gates | `approvals.mjs`, schema enum | yes, all 9 |
| `RISK_TO_PROCESS_MATRIX.md` | `requiredArtifacts()` | yes |
| `ENFORCEMENT_STANDARD.md` severities | `rules.mjs` | yes |

## Evidence Sources

E1: path and identifier extraction across `specs/`, `docs/sdd/`, this
evidence package, `tools/sdd/README.md`, `AGENTS.md`, `CLAUDE.md`.
E3: `tools/sdd/tests/validator.test.mjs`.
E4: `docs/EVIDENCE_CONFLICTS.md`.
