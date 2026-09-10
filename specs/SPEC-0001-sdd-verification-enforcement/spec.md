# SPEC-0001 — SDD verification and enforcement

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0001` |
| Title | SDD verification and enforcement |
| Status | `CONVERGED` |
| Risk | `R3` |
| Owner | Solution Architect |
| Created | 2026-09-07 |
| Last updated | 2026-09-07 |
| Supersedes | none |
| Superseded by | none |

## Problem

Phase B1 defined the Spec-Driven Development rules as prose. Nothing checks
that anyone follows them. A specification can be missing its threat model, an
identifier can be duplicated, a lifecycle status can contradict its own
history, and an AI agent can write an approval record naming itself — and the
repository would not notice. Rules that only exist in documentation decay
silently, and the first evidence of decay is usually an incident.

## Goal

A deterministic, local-first validator that reads the SDD artefacts in this
repository and reports structural and process violations by stable rule
identifier, so that compliance is a machine-checkable fact rather than a
claim.

## Background and context

Phase A documented the system; Phase B1 defined the process. This
specification governs Phase B2, which converts B1's rules into repository
controls. The repository is brownfield: substantial application work predates
SDD entirely, and an uncommitted UI redesign is in the working tree. Any
enforcement that retroactively invalidates that work is unacceptable.

Existing conventions this must respect: Node 24 in CI and locally, Node ≥22
declared by `apps/web/package.json`, `#!/usr/bin/env node` for repository
scripts, no YAML, Markdown or JSON-schema library anywhere in the dependency
set, and `node --test` available without any addition.

## Scope

- A machine-readable process metadata contract (`sdd.json`) per specification
  directory, and its schema.
- Stable validation rule identifiers with severities.
- A validator implementation under `tools/sdd/` using the Node standard
  library only.
- A command-line interface with text and JSON output and defined exit codes.
- Diff-aware validation that reports whether changed application files are
  associated with a declared specification.
- Test fixtures, valid and invalid, and automated tests over them.
- An enforcement standard, an exception process, and a transition policy.
- A security review and a performance measurement of the validator.

## Out of scope

- **CI workflow integration was originally out of scope** and was brought into
  scope by `CHG-001` after the requester authorised it explicitly. A dedicated
  non-production workflow now exists at `.github/workflows/sdd-validate.yml`.
  No other pipeline was touched. See `CL-005` and `change-record.md`.
- Any change to application source, tests, dependencies, schema, migrations
  or runtime configuration.
- Judging the *quality* of a specification, plan or threat model. The
  validator checks structure and presence; adequacy stays human review work.
- Retroactively manufacturing specifications for pre-SDD work.
- A real product feature pilot.

## Actors

| Actor | Interaction |
|---|---|
| Engineer | Runs the validator locally before requesting review |
| AI agent | Runs the validator before implementation, after implementation and before claiming convergence; may explain findings but is never the validator |
| Reviewer | Uses validator output as input to human review, not as a substitute for it |
| CI (future) | Runs the validator on a branch, once the R5 gate is passed |

## User stories

As an engineer, I need the repository to tell me which SDD artefact is
missing or malformed, so that I find out before a reviewer does.

As a reviewer, I need to know that structural compliance was checked
mechanically, so that my attention goes to judgement rather than checklists.

As a release authority, I need assurance that an AI agent cannot structurally
satisfy a gate that requires a human.

## Functional requirements

- `FR-001` — The validator must discover every specification directory under
  the configured specs root without following symbolic links outside it.
- `FR-002` — The validator must parse each specification's `sdd.json` and
  report a distinct finding when the file is absent, unparseable, or of an
  unsupported schema version.
- `FR-003` — The validator must evaluate every rule defined in
  `docs/sdd/VALIDATION_RULES.md` and emit a finding carrying that rule's
  identifier and severity.
- `FR-004` — The validator must offer `validate --all` and
  `validate --spec <SPEC-NNNN>`, and must support `--format text` and
  `--format json`.
- `FR-005` — The validator must exit 0 when no ERROR finding exists, 1 when
  any ERROR finding exists, and 2 when the validator itself cannot run.
- `FR-006` — JSON output must be deterministic: stable field set, findings
  sorted by specification identifier, then rule identifier, then artefact, and
  no timestamps.
- `FR-007` — The validator must offer a diff-aware mode that reports whether
  changed application files are associated with a declared specification, and
  must report UNKNOWN rather than guessing when association cannot be
  established deterministically.
- `FR-008` — Text output must name, for each finding, the rule identifier,
  severity, specification, artefact and a human-readable message.

## Non-functional requirements

- `NFR-001` — The validator must use the Node.js standard library only. No
  dependency may be added to any manifest or lock file.
- `NFR-002` — The validator must produce identical findings on Windows and
  Linux, including under a CRLF working copy.
- `NFR-003` — The validator must be deterministic: the same inputs produce
  byte-identical JSON output.
- `NFR-004` — Validation of the repository's current SDD artefacts must
  complete fast enough not to discourage routine local use. No numeric
  threshold is set here; see `CL-004`.

## Security requirements

- `SEC-001` — The validator must treat every artefact it reads as untrusted
  input. It must not use `eval`, `new Function`, dynamic `import()` of
  repository content, shell execution of artefact values, or string
  interpolation into a command.
- `SEC-002` — The validator must not read outside the configured specs root
  and the repository documents it resolves references against. Path traversal
  in a manifest artefact path must be rejected, not followed.
- `SEC-003` — Validator output must not contain file contents beyond short
  identifiers and paths, so that a secret accidentally committed into an
  artefact is not amplified into CI logs.
- `SEC-004` — A gate that requires a human must not be satisfiable by a
  record whose actor type is `ai`.
- `SEC-005` — Regular expressions used to parse artefacts must not be subject
  to catastrophic backtracking on adversarial input.

## Data and privacy requirements

- `DATA-001` — The validator must be read-only with respect to the
  repository. It must not create, modify or delete any repository file.
- `DATA-002` — The validator must not read `.env` files, application data, or
  anything outside documentation and specification artefacts.

## Observability requirements

- `OBS-001` — Every finding must carry a stable rule identifier; no finding
  may be emitted as a bare string.
- `OBS-002` — The summary must state counts of errors and warnings and the
  overall result.

## Failure behaviour

An unreadable or malformed artefact produces a finding, never a crash. A
validator crash exits 2 and is distinguishable from a validation failure,
which exits 1. A missing specs root is a configuration failure, exit 2, not a
silent pass.

## Edge cases

Empty specs root; a directory that is not a specification; a manifest with
extra unknown fields; an artefact path pointing outside the directory; a
duplicate specification number across two directories; an identifier declared
twice in one document; a lifecycle history that is empty; a specification at
R0 that should have no directory at all.

## Acceptance criteria

- `AC-001` — Every valid fixture validates with zero ERROR findings.
  *(covers `FR-001`, `FR-002`, `FR-003`)*
- `AC-002` — Every invalid fixture produces the specific rule identifier it
  was built to trigger. *(covers `FR-003`, `OBS-001`)*
- `AC-003` — A fixture whose R4 approval record has actor type `ai` fails
  with the AI-self-approval rule. *(covers `SEC-004`)*
- `AC-004` — Exit codes are 0, 1 and 2 as specified. *(covers `FR-005`)*
- `AC-005` — Two consecutive JSON runs over the same inputs produce identical
  output. *(covers `FR-006`, `NFR-003`)*
- `AC-006` — This specification validates with zero ERROR findings.
  *(covers all)*
- `AC-007` — No dependency manifest or lock file differs after the work.
  *(covers `NFR-001`)*

## Dependencies

Node.js ≥22, present. The B1 documents under `docs/sdd/`, which define the
rules being mechanised.

## Assumptions

- The rules in B1 are internally consistent enough to mechanise. Where a rule
  turns out to be impossible or contradictory, it is recorded as a process
  defect and corrected minimally rather than worked around.
- Reviewers will treat validator output as a floor, not a ceiling.

## Open questions

See `clarifications.md`. `CL-001` through `CL-005` are all `ANSWERED` and
`INCORPORATED`; none is material and open.

## Risks

- The validator becomes a bureaucratic obstacle and is bypassed. Mitigated by
  the advisory transition mode and by keeping R1 lightweight.
- Enforcement retroactively invalidates pre-SDD work. Mitigated by the
  transition policy: structural rules bind actual SDD artefacts only, and
  code-without-spec is advisory.
- Open evidence conflicts touching this area: none. EVC-014, the
  Windows/Linux verification inconsistency, is adjacent and is why `NFR-002`
  exists.

## Rollback and reversibility expectations

Fully reversible. The work adds new files under `tools/`, `specs/` and
`docs/`, and edits documentation. Deleting `tools/sdd/` and the added
documents restores the previous state. No migration, no runtime change, no
deployment.

## Implementation constraints

- Node standard library only, as `NFR-001`.
- No file under `.github/`, `apps/`, `infrastructure/` or any manifest may be
  modified.

## Evidence and existing-system references

- `VERIFIED` — `apps/web/package.json` — `engines.node` is `>=22`; no YAML,
  Markdown or JSON-schema library is declared.
- `VERIFIED` — `.github/workflows/ci.yml` — CI uses Node 24.
- `VERIFIED` — repository root — `tools/` did not exist before this work.
- `VERIFIED` — `docs/RISK_CLASSIFICATION.md` — `.github/workflows/*` is R5.
- `DOCUMENTED` — `docs/sdd/*` — the B1 rules this validator mechanises.

Every requirement here **adds** behaviour in new files. None preserves,
changes or replaces existing application behaviour.

## Revision history

| Date | Change | By | Change record |
|---|---|---|---|
| 2026-09-07 | Created | Solution Architect | — |

## Approval

R3 requires specification approval by Product Owner or Solution Architect, and
architecture approval by Solution Architect because a new component is
introduced. R3 does not gate implementation on a separate human approval.

| Gate | Role | Decision | Date | Scope of what was approved |
|---|---|---|---|---|
| Specification approval | Product Owner | approved | 2026-09-07 | Phase B2 engineering tooling as scoped above |
| Architecture approval | Solution Architect | approved | 2026-09-07 | New `tools/sdd/` component, Node stdlib only |
| Security risk acceptance | Application Security | not required at R3 | — | Threat model produced voluntarily; residual risk in `threat-model.md` |
| Implementation readiness | — | not required at R3 | — | Gate applies at R4/R5 only |

CI integration is **not** approved and is out of scope. See `CL-005`.
