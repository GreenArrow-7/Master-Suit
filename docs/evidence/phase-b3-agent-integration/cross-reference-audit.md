# Cross-reference audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

Does the documentation agree with itself and with the code? Checked
mechanically where possible, by reading where not.

## Rule catalogue

| Direction | Result |
|---|---|
| Every rule in `tools/sdd/rules/rules.mjs` documented in `docs/sdd/VALIDATION_RULES.md` | 58 of 58 |
| Every identifier in the document implemented in code | 58 of 58, no orphans |

Both directions were checked. Checking one is the common mistake: it catches
undocumented rules and misses documented rules that do not exist.

## Document references

`SDD-V040` resolves every backticked document path in every specification
artefact, against the repository root and the specification directory. It
reports zero unresolved references.

During this phase it reported 22, then 5, then 2, then 0. Every reduction came
from writing a referenced document or qualifying a path that was genuinely
ambiguous. None came from removing a reference to avoid the check.

Two paths were qualified rather than removed:

| Was | Now | Why |
|---|---|---|
| a bare validator test file name | the full repository path | the bare name resolved nowhere |
| a bare agent standard file name | `docs/sdd/` prefixed | the same |

Both were artefact defects. A reference that names a file without saying where
it lives is not a reference.

## Identifier registers

`docs/sdd/IDENTIFIER_STANDARD.md` now documents `ASES`, `VER` and `REV`
alongside the existing prefixes, with their four-digit form and their location
under `execution/`. The `ID_RE` patterns in `tools/sdd/lib/agent.mjs` match the
documented form exactly.

No existing prefix was redefined, renumbered or given a new meaning.

## The seven agent standards

Each cross-references the others and each carries an *Authority / References*
section. Spot-checked for the failure mode that matters, a standard claiming
authority it does not have:

- `AGENT_ROLE_GATE_MATRIX.md` states in its first paragraph that
  `HUMAN_APPROVAL_GATES.md` and `RISK_TO_PROCESS_MATRIX.md` remain
  authoritative and that where it appears to differ, it is at fault.
- `AGENT_ROLE_MODEL.md` states the limits of what separate sessions buy,
  rather than leaving that to the evidence package.
- None of the seven redefines a risk level, a lifecycle state or a human gate.

## Constitution and operating guide

`AGENTS.md` gained one section, `CLAUDE.md` gained one section. Both are
additive. No existing rule in either was reworded, weakened or removed.

Both carry the two sentences the phase required, in the required sense: the
agent is not the human approver, and the agent is not its own independent
reviewer where separation is required.

## Conflicts found

None. No statement in the B3 documentation contradicts a Phase A document, a
B1 standard, a B2 rule, or the code.

`docs/EVIDENCE_CONFLICTS.md` gained no new entry, and none of its existing
fourteen was closed. Closing one would require production verification that
this phase did not and could not perform.
