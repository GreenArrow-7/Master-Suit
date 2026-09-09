# SPEC-0002 — Technical plan

| Field | Value |
|---|---|
| Specification | `SPEC-0002` |
| Risk | `R3` |
| Author | Solution Architect |
| Date | 2026-09-07 |

## Affected architecture

None of the application. `tools/sdd/` gains one library module and a
subcommand group; `docs/sdd/` gains seven standards and three schemas;
`specs/templates/` gains three JSON templates.

## Existing patterns to reuse

The B2 finding model, rule catalogue, exit-code contract, safe path resolution
(`safeResolve`), manifest loading and CLI argument handling. Agent commands are
subcommands of the same CLI, not a second entry point.

## Files and components likely affected

| Path | Change | Why |
|---|---|---|
| `tools/sdd/lib/agent.mjs` | new | Session, verification and review records; preflight; scope; drift |
| `tools/sdd/cli.mjs` | edit | `agent` subcommand group |
| `tools/sdd/rules/rules.mjs` | edit | Rules `SDD-V042`–`SDD-V058`, appended |
| `tools/sdd/lib/discover.mjs` | edit | Repository-relative safe path helper reused by scope checking |
| `tools/sdd/tests/agent.test.mjs` | new | Agent tests, separate file |
| `tools/sdd/tests/fixtures/agent/**` | new | Synthetic agent fixtures |
| `docs/sdd/AGENT_*.md` (7) | new | Role model, session, execution record, gate matrix, handoff, context, stop |
| `docs/sdd/schemas/*.json` (3) | new | Session, verification, review |
| `specs/templates/*.json` (3) | new | Templates |
| `docs/sdd/VALIDATION_RULES.md` | edit | Document the new rules |
| `AGENTS.md`, `CLAUDE.md` | edit | Minimal integration |

## Data model, API, frontend, backend, integrations, authentication, authorization, tenant isolation, database and migration impact

None. No application surface is touched, no schema, no migration, no network
call, no service.

## Compatibility

Additive. B2 rules keep their identifiers and severities; new rules start at
`SDD-V042`. `validate --all` behaviour is unchanged, so an existing
specification without agent records still validates exactly as before.

## Dependencies

None added.

## Concurrency and idempotency

All agent commands are read-only except `create-session`, which writes one
record and refuses when preflight fails. Repeated runs are idempotent.

## Error behaviour

Exit 0 clean, 1 finding, 2 tooling failure. A malformed record is a finding.

## Logging and observability

Findings to stdout in text or JSON. No log file. Records carry no command
output beyond exit codes and test identifiers, so a secret in a test log
cannot reach an artefact.

## Security considerations

Summarised here, detailed in `threat-model.md`: untrusted records, path
containment including symlink escape, git reference validation, actor-type
forgery, self-review, and the drift race.

## Test strategy

Node built-in runner over synthetic agent fixtures: seven valid flows and
seventeen invalid ones, each asserting a specific rule.

## Deployment implications

None. CI integration deferred (`CL-005`).

## Rollback and reversibility

Delete the new files, revert the four edited ones. Nothing else changes.

## Operational impact

New optional local commands. No runbook change, no alert, no production
surface.

## Risks

Overclaiming independence is the main risk and is handled by wording
discipline rather than code. A secondary risk is scope rules so strict that
real tasks fail, mitigated by `CL-002` and by keeping scope checking advisory
in its reporting rather than mutating anything.

## Alternatives considered

- **A separate agent-control tool.** Rejected: two tools drift, and the
  session must reason about the same specification the validator does.
- **Glob or regular-expression scope patterns.** Rejected by `CL-002`; too
  easy to write a pattern that authorises everything.
- **Auto-repair of failing governance artefacts.** Rejected by `CL-004`; it
  would let an agent generate its own authorisation.
- **Trusting the session record's own claim of actor type.** Partially
  unavoidable, and stated as a limitation rather than designed away.

## Technical decisions

### AD-001
**Decision:** Agent commands are a subcommand group of the existing CLI, and
agent logic lives in one module, `tools/sdd/lib/agent.mjs`.
**Reason:** `NFR-004`; one tool, one rule catalogue, one finding model.
**Alternatives:** A separate binary.
**Trade-offs:** A larger CLI file; acceptable.
**Requirements supported:** `FR-010`, `NFR-004`.

### AD-002
**Decision:** Session, verification and review records are separate JSON files
under `specs/SPEC-NNNN-*/execution/`.
**Reason:** They are control artefacts with different lifetimes from the
specification, and separating them keeps `sdd.json` from becoming a log.
**Requirements supported:** `FR-002`, `FR-007`, `FR-008`.

### AD-003
**Decision:** Scope is exact paths and directory prefixes only, normalised and
resolved, with a case-insensitive collision check.
**Reason:** `CL-002`, `NFR-002`.
**Trade-offs:** Tasks must enumerate paths, which is more work and is the
point.
**Requirements supported:** `FR-004`, `FR-005`, `NFR-002`.

### AD-004
**Decision:** Drift is detected by comparing the session's recorded starting
commit and changed-path snapshot against the current state, and is reported as
requiring review.
**Reason:** `CL-003`; the working tree holds concurrent human work.
**Requirements supported:** `FR-006`.

### AD-005
**Decision:** Separation of duty is enforced structurally by comparing the
review record's actor against the session's actor, and by rejecting
`actorType: "ai"` on human-required gates.
**Reason:** `SEC-004`, `SEC-005`.
**Trade-offs:** Proves distinctness of a recorded label, not genuine
independence. Stated wherever it appears.
**Requirements supported:** `SEC-004`, `SEC-005`.

### AD-006
**Decision:** New rules are appended from `SDD-V042`; no existing rule is
renumbered, re-severed or removed.
**Reason:** `FR-009`; `docs/sdd/IDENTIFIER_STANDARD.md` forbids renumbering,
and `docs/sdd/ENFORCEMENT_STANDARD.md` §8 makes loosening a rule an R4 change.
**Requirements supported:** `FR-009`, `AC-007`.

### AD-007
**Decision:** git is invoked only through the existing `execFileSync` pattern
with a validated reference and a fixed argument array.
**Reason:** `SEC-003`.
**Requirements supported:** `SEC-003`, `FR-006`.
