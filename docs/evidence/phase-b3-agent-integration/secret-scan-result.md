# Documentation secret scan

**Phase:** B3 · **Date:** 2026-09-07
**Run:** last, after every other file in this phase was final. Re-run after
the convergence and remediation pass, and again after the governance closure
pass.

## Result

**No secret value was found in any file this phase produced.**

## Scope

Every file B3 created or modified:

- the seven agent standards under `docs/sdd/`
- the three JSON schemas under `docs/sdd/schemas/`
- the three record templates under `specs/templates/`
- `tools/sdd/lib/agent.mjs` and `tools/sdd/tests/agent.test.mjs`
- the agent fixture tree
- the whole of `specs/SPEC-0002-agent-integration-controlled-execution/`,
  including the three execution records
- all 36 files in this evidence package
- the additive sections of `AGENTS.md` and `CLAUDE.md`

Added by the convergence pass and covered by the re-run:

- `change-record.md` (`CHG-001`, `CHG-002`) and the corrected `spec.md`
  approval section
- the two remediation sessions, their verifications and their reviews
  (`ASES-0002`, `ASES-0003`, `VER-0002`, `VER-0003`, `REV-0002`, `REV-0003`)
- the rewritten `ST-002` and the new `ST-009` in
  `tools/sdd/tests/validator.test.mjs`
- the attribution code in `tools/sdd/lib/agent.mjs` and its twelve tests
- `EVC-015` in `docs/EVIDENCE_CONFLICTS.md`
- five new evidence documents

Added by the governance closure pass and covered by the third run:

- `architecture-review-pack.md`, `human-code-review-pack.md`,
  `convergence-status-model-audit.md`
- the rebuilt decision table in `acceptance.md`
- the extended `EVC-015` audit and the security recheck appendix

## Patterns searched

Credential keywords (`api_key`, `secret`, `password`, `token`, `bearer`,
`private key`, PEM headers), connection-string schemes (PostgreSQL, Redis,
MongoDB, MySQL, AWS), and provider token shapes (Slack, GitHub, OpenAI-style,
JSON Web Token prefixes).

## Every match, and why each is not a secret

| Match | File | Why it is not a secret |
|---|---|---|
| "A secret may have been exposed" | `AGENT_STOP_PROTOCOL.md` | a stop condition |
| "Any credential, token or connection string" | `AGENT_EXECUTION_RECORD.md` | a prohibition |
| "Never a hostname carrying a secret, never a connection string" | `verification-record.schema.json` | a field description forbidding one |
| "secrets and deployment configuration are all untouched" | `change-boundary-checks.md` | a statement of what was not changed |
| "No secret is read, written, logged or referenced" | `security-review.md` | the finding itself |
| a well-known Unix password file path | `agent.test.mjs` | a **path-safety fixture**. It is passed to the path validator to confirm an absolute path is refused. The file is never opened |
| `tokens.css`, `tokens of context` | several | design tokens and context length. Unrelated to credentials |
| `secrets.txt`, `outside-secret.txt` | `validator.test.mjs` | **path-traversal fixture names**, pre-existing from B2. They name a file the validator must refuse to read, and no such file is ever created |

Eight categories of match, all prose about secrets, fixture path names, or an
unrelated use of the word. No value, no fragment of a value, no redacted placeholder standing in
for one.

## What was not opened

No `.env` file of any kind was read, copied, quoted or referenced during this
phase. No secret store was accessed. No production or staging system was
contacted.

## Why records cannot accumulate secrets over time

This is the structural half of the answer, and it matters more than a
point-in-time scan.

The verification record schema provides **no field** for captured command
output. It admits a command name and an exit code. `SPEC-0002/SEC-006` states
the reasoning: a repository artefact that copies logs will eventually copy a
credential, and a specification directory is more widely readable and
longer-lived than a CI log.

A scan proves this phase is clean. The schema is what keeps the next one
clean.

The governance closure pass added no executable code and no new field, so it
added no new way for a secret to enter an artefact.

One field was added during the convergence pass: `initialDigests`, holding a
SHA-256 per initially-changed path. A digest is derived from file content and
is not itself content, so it discloses nothing that reading the repository
would not. It cannot carry a credential, because it cannot carry anything but
sixty-four hexadecimal characters, `null`, or a fixed directory marker.
