# Phase B2 — SDD Verification and Enforcement evidence

**Verdict: PASS WITH KNOWN LIMITATIONS**

Captured 2026-09-07 at commit `f16ed67`, branch `dev/yourhan-next`.
Everything here was executed, not asserted.

Phase B1 wrote the rules. Phase B2 makes the repository able to check them.

## What was built

| Component | Detail |
|---|---|
| Machine contract | `sdd.json` per specification, plus a JSON Schema and a template |
| Rule catalogue | 41 rules, `SDD-V001`–`SDD-V041`, 38 ERROR and 3 WARNING |
| Validator | `tools/sdd/`, Node standard library only, ~1,400 lines across a CLI, eight library modules and a rule table |
| Tests | 54, Node built-in runner, no dependency |
| Fixtures | 3 valid specifications on disk; 32 invalid variants generated at test time |
| Documentation | Machine contract, validation rules, enforcement standard, exceptions, CI enforcement |
| Governing specification | `SPEC-0001`, R3, ten artefacts, `CONVERGED` |
| CI check | `.github/workflows/sdd-validate.yml`, read-only, no secrets, cannot deploy |

## What was verified

| Check | Result |
|---|---|
| Validator tests | **54 of 54 pass** |
| Valid fixtures, R1 / R2 / R4 | PASS, zero findings, exit 0 |
| Invalid fixtures | **32 of 32 fail with the expected rule** |
| Repository SDD artefacts | PASS, `errors=0`, exit 0 |
| Exit codes | 0 clean, 1 validation failure, 2 tooling failure |
| Determinism | two JSON runs byte-identical, no timestamps |
| Read-only | tree hash unchanged after runs |
| Security review | 12 concerns, no blocking defect, one accepted residual risk |
| Performance | 90 / 86 / 81 ms for `validate --all`; 7.1 s for the suite |
| Cross-references | all resolve; the previously intentional gap is closed now that the workflow exists |
| Application source changed | none |
| Dependencies changed | none |
| Migrations changed | none, 65 at HEAD and 65 in the tree |
| `.github/` | one file added, `sdd-validate.yml`; the three existing workflows unmodified |
| infra, scripts, environment files changed | none |
| Pre-existing UI redesign | 36 entries preserved |
| Secrets in B2 artefacts | none found |

## The three things worth knowing

**An AI cannot structurally self-approve.** Nine gates, all requiring
`actorType: "human"`. A record naming an AI actor is an ERROR with a passing
test. What this proves is that a record exists; it cannot prove a human made
the decision, and that limitation is stated in four documents rather than
implied away.

**The tool found a defect in itself.** Run against its own specification,
`SDD-V030` proved inert: the traceability matrix was vouching for its own
references. The validator was fixed, not the fixture. Separately the
specification's own artefacts failed `SDD-V026` and `SDD-V040` and were
corrected. In each case the layer that was wrong is the layer that changed.

**CI enforcement stopped at a gate, then passed it properly.**
`.github/workflows/*` is R5, and the original authorisation excluded
infrastructure approval, so the work stopped and reported. When the requester
authorised it explicitly, the change went through `CHG-001` as a scope change
with the specification returning `CONVERGED -> IMPLEMENTING -> VERIFYING ->
CONVERGED`, rather than being edited in place. A process that only works while
nothing changes is not a process.

## Three categories of blocker

- **Phase B2 blockers: none.**
- **Phase B3 prerequisites:** push so the CI job actually runs, confirm branch
  protection (GAP-CI-01), assign the six approval roles to people, add negative
  fixtures for four untested rules, choose a low-risk pilot.
- **Production-release blockers: unchanged from Phase A**, eleven runtime and
  infrastructure facts, none touched by B2.

## Package contents

`SUMMARY.md` · `current-commit.txt` · `repository-status.txt` ·
`phase-b2-files.txt` · `git-diff-stat.txt` · `b2-spec-audit.md` ·
`machine-contract-audit.md` · `validation-rule-audit.md` ·
`validator-test-results.md` · `valid-fixture-results.md` ·
`invalid-fixture-results.md` · `lifecycle-validation-audit.md` ·
`approval-validation-audit.md` · `traceability-validation-audit.md` ·
`convergence-validation-audit.md` · `diff-aware-validation-audit.md` ·
`security-review.md` · `performance-check.md` · `ci-enforcement-audit.md` ·
`transition-policy-audit.md` · `application-change-check.md` ·
`dependency-change-check.md` · `migration-change-check.md` ·
`infrastructure-change-check.md` · `cross-reference-audit.md` ·
`secret-scan-result.md` · `known-limitations.md` · `acceptance.md`

## Evidence Sources

E1: `tools/sdd/**`, `specs/SPEC-0001-sdd-verification-enforcement/**`, git at
commit `f16ed67`.
E3: `tools/sdd/tests/validator.test.mjs`.
E4: `docs/sdd/**`, `docs/RISK_CLASSIFICATION.md`,
`docs/evidence/phase-b1-sdd-foundation/`.
Unverified: everything in `known-limitations.md`.
