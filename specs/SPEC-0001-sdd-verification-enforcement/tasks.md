# SPEC-0001 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Risk | `R3` |
| Date | 2026-09-07 |

## Task list

| ID | Purpose | Requirements | Status |
|---|---|---|---|
| `TASK-001` | Machine contract, schema, manifest template, config | `FR-002`, `AD-001` | `DONE` |
| `TASK-002` | Discovery and manifest loading with path containment | `FR-001`, `FR-002`, `SEC-001`, `SEC-002` | `DONE` |
| `TASK-003` | Artefact parsing: identifiers, references, sections | `FR-003`, `SEC-005` | `DONE` |
| `TASK-004` | Rule engine, findings, text and JSON output, exit codes | `FR-003`, `FR-005`, `FR-006`, `FR-008`, `SEC-003`, `OBS-001`, `OBS-002` | `DONE` |
| `TASK-005` | Lifecycle, approval and review validation | `FR-003`, `SEC-004` | `DONE` |
| `TASK-006` | Traceability and convergence validation | `FR-003` | `DONE` |
| `TASK-007` | Diff-aware validation | `FR-007` | `DONE` |
| `TASK-008` | Fixtures and automated tests | all acceptance criteria | `DONE` |
| `TASK-009` | B2 documentation set | `FR-003`, scope | `DONE` |
| `TASK-010` | Minimal B1 document updates | scope | `DONE` |
| `TASK-011` | Security review and performance measurement | `SEC-001`–`SEC-005`, `NFR-004` | `DONE` |
| `TASK-012` | CI workflow: prepared, then applied under `CHG-001` | `AD-008`, `CL-005` | `DONE` |

---

## TASK-001

**Purpose:** Define the machine-readable process metadata contract.
**Requirements:** `FR-002`, decision `AD-001`.
**Dependencies:** none.
**Allowed scope:** `docs/sdd/MACHINE_CONTRACT.md`,
`docs/sdd/schemas/sdd-manifest.schema.json`,
`specs/templates/SDD_MANIFEST_TEMPLATE.json`, `sdd.config.json`.
**Required tests:** `UT-002`.
**Security implications:** none directly; the schema constrains what the
validator will accept.
**Data and migration implications:** none.
**Definition of Done:** contract states what `sdd.json` may and may not hold;
schema and template agree with it.
**Status:** `DONE`

## TASK-002

**Purpose:** Discover specification directories and load manifests safely.
**Requirements:** `FR-001`, `FR-002`, `SEC-001`, `SEC-002`.
**Dependencies:** `TASK-001`.
**Allowed scope:** `tools/sdd/lib/discover.mjs`, `tools/sdd/lib/manifest.mjs`.
**Required tests:** `UT-001`, `UT-002`, `ST-001`.
**Security implications:** implements `CTRL-001`; no symlink following, every
artefact path contained within its directory.
**Definition of Done:** traversal cannot leave the specs root; a traversing
path is a finding, not a read.
**Status:** `DONE`

## TASK-003

**Purpose:** Parse artefacts for identifiers, references and sections.
**Requirements:** `FR-003`, `SEC-005`.
**Dependencies:** `TASK-002`.
**Allowed scope:** `tools/sdd/lib/markdown.mjs`.
**Required tests:** `ST-003`, and the identifier fixtures.
**Security implications:** implements `CTRL-003`; anchored bounded patterns,
line-oriented.
**Definition of Done:** no nested quantifiers; parsing is linear in input
size.
**Status:** `DONE`

## TASK-004

**Purpose:** Rule engine, findings model, output formats, exit codes.
**Requirements:** `FR-003`, `FR-005`, `FR-006`, `FR-008`, `SEC-003`,
`OBS-001`, `OBS-002`.
**Dependencies:** `TASK-002`, `TASK-003`.
**Allowed scope:** `tools/sdd/rules/rules.mjs`, `tools/sdd/lib/validate.mjs`,
`tools/sdd/cli.mjs`.
**Required tests:** `UT-003`–`UT-007`, `ST-004`.
**Security implications:** implements `CTRL-004`; findings never carry file
content.
**Definition of Done:** every finding has a rule identifier; JSON output is
deterministic and sorted; exit codes 0, 1, 2 behave as specified.
**Status:** `DONE`

## TASK-005

**Purpose:** Validate lifecycle history, approvals and reviews.
**Requirements:** `FR-003`, `SEC-004`.
**Dependencies:** `TASK-004`.
**Allowed scope:** `tools/sdd/lib/lifecycle.mjs`,
`tools/sdd/lib/approvals.mjs`.
**Required tests:** `ST-005`, `ST-006`, and the lifecycle fixtures.
**Security implications:** implements `CTRL-005`; `actorType: "ai"` can never
satisfy a human gate.
**Definition of Done:** illegal transitions, status-history mismatch, missing
approval and AI approval each produce their specific rule.
**Status:** `DONE`

## TASK-006

**Purpose:** Validate traceability and convergence structure.
**Requirements:** `FR-003`.
**Dependencies:** `TASK-004`.
**Allowed scope:** `tools/sdd/lib/traceability.mjs`.
**Required tests:** the traceability and convergence fixtures.
**Definition of Done:** phantom references, requirements without tests,
security requirements without security verification, open findings while
`CONVERGED`, and invalid verdicts each produce their specific rule.
**Status:** `DONE`

## TASK-007

**Purpose:** Diff-aware validation.
**Requirements:** `FR-007`.
**Dependencies:** `TASK-004`.
**Allowed scope:** `tools/sdd/lib/diff.mjs`, `tools/sdd/cli.mjs`.
**Required tests:** `IT-004`.
**Security implications:** git is invoked with a fixed argument array and
never through a shell; the base reference is validated before use.
**Definition of Done:** reports WARNING or UNKNOWN, never invents an
association; does not read untracked files destructively.
**Status:** `DONE`

## TASK-008

**Purpose:** Fixtures and automated tests.
**Requirements:** verifies `FR-003`, `FR-005`, `SEC-001` through `SEC-005`; every acceptance criterion.
**Dependencies:** `TASK-002`–`TASK-007`.
**Allowed scope:** `tools/sdd/tests/**`.
**Required tests:** this task delivers them.
**Definition of Done:** valid fixtures pass; each invalid fixture fails with
its expected rule; the suite runs under `node --test` with no dependency.
**Status:** `DONE`

## TASK-009

**Purpose:** B2 documentation.
**Requirements:** `FR-003`, `OBS-001` — every rule the validator emits must be documented.
**Allowed scope:** `docs/sdd/VALIDATION_RULES.md`,
`docs/sdd/ENFORCEMENT_STANDARD.md`, `docs/sdd/VALIDATION_EXCEPTIONS.md`,
`docs/sdd/CI_ENFORCEMENT.md`, `tools/sdd/README.md`.
**Definition of Done:** every rule the validator emits is documented with its
severity and rationale.
**Status:** `DONE`

## TASK-010

**Purpose:** Minimal updates to B1 documents so the manifest and the validator
are discoverable.
**Requirements:** `FR-002` — the manifest contract must be discoverable from the
documents that govern specifications; decision `AD-001`.
**Allowed scope:** `specs/README.md`, `specs/templates/SPEC_TEMPLATE.md`,
`docs/sdd/{IDENTIFIER_STANDARD,ARTIFACT_AUTHORITY,SDD_WORKFLOW,SPEC_LIFECYCLE,TRACEABILITY_STANDARD,HUMAN_APPROVAL_GATES}.md`,
`AGENTS.md`, `CLAUDE.md`.
**Definition of Done:** references added; B1's authority model unchanged; no
rule redefined.
**Status:** `DONE`

## TASK-011

**Purpose:** Security review and performance measurement of the validator.
**Requirements:** `SEC-001`–`SEC-005`, `NFR-004`.
**Allowed scope:** evidence package only.
**Definition of Done:** each threat's control is confirmed present; runtime
recorded, not asserted against an invented threshold.
**Status:** `DONE`

## TASK-012

**Purpose:** Prepare the CI workflow, and apply it once the R5 gate was passed.
**Requirements:** `AD-008`, `CL-005`, and change record `CHG-001` which
brought application into scope.
**Allowed scope:** `docs/sdd/CI_ENFORCEMENT.md`, and — added by `CHG-001` —
`.github/workflows/sdd-validate.yml` and no other file under `.github/`.
**Definition of Done:** the workflow exists, satisfies every stated safety
condition, and `.github/workflows/ci.yml` and
`.github/workflows/deploy.yml` are unmodified.
**Status:** `DONE`
