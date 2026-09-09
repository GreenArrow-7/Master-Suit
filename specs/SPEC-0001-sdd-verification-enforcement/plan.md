# SPEC-0001 — Technical plan

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Risk | `R3` |
| Author | Solution Architect |
| Date | 2026-09-07 |

## Affected architecture

None of the application. A new top-level `tools/sdd/` component, plus
documentation under `docs/sdd/` and a repository configuration file
`sdd.config.json`. `docs/architecture/*` is unaffected because the validator
is not part of the running product.

## Existing patterns to reuse

- `#!/usr/bin/env node` and plain `.mjs` modules, matching
  `apps/web/scripts/*.mjs`.
- `node --test`, already available and used by no dependency.
- Rule-identifier-plus-severity reporting, matching the existing `EVC-`,
  `SEC-OBS-` and `GAP-` registers.

## Files and components likely affected

| Path | Change | Why |
|---|---|---|
| `tools/sdd/cli.mjs` | new | Entry point and argument handling |
| `tools/sdd/lib/*.mjs` | new | discover, manifest, markdown, lifecycle, traceability, approvals, diff, validate |
| `tools/sdd/rules/rules.mjs` | new | Rule table: id, severity, title |
| `tools/sdd/tests/*` | new | Node test-runner tests plus fixtures |
| `sdd.config.json` | new | Specs root, ignores, enforcement mode |
| `docs/sdd/MACHINE_CONTRACT.md`, `docs/sdd/VALIDATION_RULES.md`, `docs/sdd/ENFORCEMENT_STANDARD.md`, `docs/sdd/VALIDATION_EXCEPTIONS.md`, `docs/sdd/CI_ENFORCEMENT.md` | new | B2 documentation |
| `docs/sdd/schemas/sdd-manifest.schema.json` | new | Interoperability contract |
| `specs/templates/SDD_MANIFEST_TEMPLATE.json` | new | Template |
| `specs/README.md`, `specs/templates/SPEC_TEMPLATE.md`, and the governing documents under `docs/sdd/` | minimal edit | Reference `sdd.json` and validation |
| `AGENTS.md`, `CLAUDE.md` | minimal edit | Agent operating rule |

## Data model impact

None. No database, no schema, no migration.

## API impact

None.

## Frontend impact

None.

## Backend impact

None. The validator is not loaded by any application process.

## Integrations

None. No network access, no service calls.

## Authentication, authorization, tenant-isolation impact

None. The validator reads repository documents and holds no tenant context.

## Database and migration impact

None.

## Compatibility

Additive only. No existing file's behaviour changes. Pre-SDD application work
is unaffected because no rule binds it at ERROR severity (`AD-005`).

## Dependencies

None added. `NFR-001`.

## Concurrency and idempotency

Single process, read-only, idempotent.

## Error behaviour

Three exit codes: 0 clean, 1 validation failure, 2 tooling failure. A parse
failure inside an artefact is a finding, not a crash.

## Logging and observability

Findings to stdout in text or JSON. No log file, no metric, nothing redacted
because nothing beyond identifiers and paths is emitted (`SEC-003`).

## Security considerations

Summarised here, detailed in `threat-model.md`: untrusted input, path
containment, no dynamic execution, bounded regular expressions.

## Test strategy

Node test runner over synthetic fixtures, valid and invalid, asserting both
that valid input passes and that each invalid input fails with its specific
rule identifier. Detail in `test-plan.md`.

## Deployment implications

None. Nothing ships. CI integration is deferred (`CL-005`).

## Rollback and reversibility

Delete `tools/sdd/`, `sdd.config.json` and the added documents; revert the
documentation edits. No data, no migration, no runtime state.

## Operational impact

A new optional local command. No runbook change, no alert, no new failure mode
in production.

## Risks

The validator's own correctness is the risk: a false ERROR blocks legitimate
work, a false PASS gives unearned confidence. Mitigated by testing both
directions, by the exception process, and by advisory mode for the one rule
that touches pre-existing work.

## Alternatives considered

- **Parse `spec.md` only, no manifest.** Rejected: correctness would depend on
  Markdown formatting, and every heading rename would be a breaking change.
- **Add a JSON-schema library and validate declaratively.** Rejected:
  violates `NFR-001` for a check that is a few dozen lines of imperative code.
- **Put the validator in `apps/web/scripts/`.** Rejected: it is repository
  tooling, not application tooling, and `apps/web` carries a package manifest
  the work must not touch.
- **Make everything blocking immediately.** Rejected by `CL-003`.

## Technical decisions

### AD-001
**Decision:** `sdd.json` per specification directory, process metadata only.
**Reason:** Deterministic parsing without depending on prose formatting.
**Alternatives:** Markdown front-matter; parsing the metadata table.
**Trade-offs:** A second file that can drift, mitigated by cross-check rules.
**Requirements supported:** `FR-002`, `NFR-003`.

### AD-002
**Decision:** Node standard library only; no dependency added.
**Reason:** `NFR-001`, and `AGENTS.md` §6.
**Alternatives:** `ajv`, `js-yaml`, a Markdown parser.
**Trade-offs:** Hand-written parsing, kept deliberately simple and bounded.
**Requirements supported:** `NFR-001`.

### AD-003
**Decision:** Line-oriented parsing with anchored, bounded regular
expressions; no backtracking-prone constructs.
**Reason:** `SEC-005`, and the input is attacker-controlled in a pull request.
**Alternatives:** A full Markdown AST.
**Trade-offs:** Less structural awareness; sufficient for identifier and
reference extraction.
**Requirements supported:** `SEC-005`, `NFR-002`.

### AD-004
**Decision:** All artefact paths are resolved and then checked to remain
inside the specification directory; `..`, absolute paths and symlinks that
escape are rejected as findings.
**Reason:** `SEC-002`.
**Requirements supported:** `SEC-002`, `DATA-002`.

### AD-005
**Decision:** Two enforcement modes, `ADVISORY` and `ENFORCED`, in
`sdd.config.json`; the code-without-spec rule is WARNING during transition.
**Reason:** `CL-003`; the brownfield constraint.
**Requirements supported:** `FR-007`.

### AD-006
**Decision:** Findings sorted by specification, then rule, then artefact, then
message; no timestamps in output.
**Reason:** `FR-006`, `NFR-003` — diffable output and stable CI comparison.
**Requirements supported:** `FR-006`, `NFR-003`.

### AD-007
**Decision:** Approvals and reviews are separate arrays with an `actorType`
field, and human gates require `actorType: "human"`.
**Reason:** `SEC-004`, and B1's distinction between approval and review.
**Trade-offs:** The validator proves the record exists, not that a human made
it. Stated as a limitation rather than implied away.
**Requirements supported:** `SEC-004`.

### AD-008
**Decision:** CI workflow prepared as a proposal, not created.
**Reason:** `CL-005`; `.github/workflows/*` is R5 and infrastructure approval
was explicitly withheld.
**Requirements supported:** scope boundary.
