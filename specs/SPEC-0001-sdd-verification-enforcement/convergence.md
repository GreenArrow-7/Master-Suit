# SPEC-0001 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Risk | `R3` |
| Prepared by | AI agent, under `AGENTS.md` §7 |
| Date | 2026-09-07 |
| Recommended verdict | PASS |
| Accepted by | _pending_ — R3 requires a reviewer to accept |

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | Yes. 21 requirements, all traced to a task and code |
| 2 | Every acceptance criterion is verified | Yes. 7 of 7 |
| 3 | Every security requirement is verified by a security test | Yes. `SEC-001` to `SEC-005` each have an `ST-` test |
| 4 | All required tests pass; failures explained | Yes. 54 of 54 after two defects were fixed, see `CONV-002` and `CONV-003` |
| 5 | No task left incomplete without a decision | Yes. 12 of 12 `DONE` |
| 6 | No behaviour implemented that no requirement asked for | Yes |
| 7 | No undocumented architecture change | Yes. 8 `AD-` decisions, all traced |
| 8 | No undocumented dependency change | Yes. No manifest or lock file was touched |
| 9 | Migration matches the plan | Not applicable. No migration |
| 10 | Documentation updated where the change made it untrue | Yes. `specs/README.md` no longer claims no specification exists |
| 11 | No new evidence conflict introduced | Yes. The register is unchanged; all 14 remain as Phase A left them |
| 12 | Known limitations recorded with owners | Yes, in the evidence package |
| 13 | Residual risk accepted by the right role | `TH-005` accepted by Application Security |
| 14 | Rollback is written down and feasible | Yes. Delete `tools/sdd/`, `sdd.config.json` and the added documents |
| 15 | Applicable items of `AGENTS.md` §8 hold | Yes for the applicable subset; the application build and test suites are untouched and were not re-run because nothing in `apps/` changed |

## Findings

### CONV-001

**Check:** 6, unrequested behaviour and scope.
**Finding:** CI enforcement, listed in the Phase B2 brief, was not built. Any
file under `.github/workflows/` is R5 by `docs/RISK_CLASSIFICATION.md`, and the
authorisation for this work explicitly excluded infrastructure approval.
**Evidence:** `CL-005`, `AD-008`, `docs/sdd/CI_ENFORCEMENT.md`;
`git status` shows `.github/` unchanged.
**Impact:** The validator is local-only until a human applies the workflow.
Nothing else in the specification depends on it.
**Recommendation:** Obtain approval and apply the prepared workflow.
**Resolution:** The requester authorised the change in writing on 2026-09-07.
Applied under `CHG-001` as a scope change, with the specification returning
`CONVERGED -> IMPLEMENTING -> VERIFYING -> CONVERGED` rather than being edited
in place. `.github/workflows/sdd-validate.yml` now exists and no other
workflow was touched.
**Status:** `RESOLVED`
**Owner:** DevOps / Production Engineering

### CONV-002

**Check:** 4, tests.
**Finding:** `SDD-V030` did not fire on a phantom traceability reference. The
known-identifier set was built from every artefact including the traceability
matrix, so the matrix vouched for its own references and the rule could never
fail.
**Evidence:** `tools/sdd/tests/validator.test.mjs`, the `SDD-V030` case, which
failed before the fix and passes after.
**Impact:** A real gap in the tool, found by dogfooding it against its own
specification. Exactly what Step 18 of the brief exists to catch.
**Recommendation:** Fixed in `tools/sdd/lib/validate.mjs` by excluding the
traceability artefact from the known set. The validator layer was the wrong
layer, so the validator was corrected rather than the artefact.
**Status:** `RESOLVED`

### CONV-003

**Check:** 4, tests.
**Finding:** Three tasks cited no requirement, and several document references
were written unqualified, so `SDD-V026` and `SDD-V040` fired against this
specification's own artefacts.
**Evidence:** The first validator run over `SPEC-0001`.
**Impact:** None to the tool. The artefacts were genuinely defective; the
validator was right.
**Recommendation:** Fixed in `tasks.md` and `plan.md`. The artefact layer was
the wrong layer, so the artefacts were corrected rather than the rules.
**Status:** `RESOLVED`

## Unrequested behaviour

None. Every file created traces to a task, and every task to a requirement or
an approved decision. CI enforcement, initially out of scope at the gate
recorded in `CL-005`, was brought into scope by `CHG-001` under change control
rather than added quietly to a converged specification.

## Verification summary

| Check | Command | Result |
|---|---|---|
| Validator tests | `node --test tools/sdd/tests/validator.test.mjs` | 54 of 54 pass |
| Valid fixtures | `node tools/sdd/cli.mjs validate --all --root tools/sdd/tests/fixtures/valid` | PASS, 0 findings, exit 0 |
| Repository artefacts | `node tools/sdd/cli.mjs validate --all` | PASS, 0 errors, exit 0 |
| Determinism | two consecutive JSON runs | byte-identical |
| Read-only | tree hash before and after | unchanged |
| Performance | `validate --all`, three runs | 90, 86, 81 ms |
| Performance | full test suite | 7.1 s |
| Application checks | build, typecheck, lint, vitest | not run; nothing under `apps/` changed |
| CI workflow steps, locally | both job commands | pass; first run on a branch not yet performed |

## Verdict

**PASS.** Every requirement is implemented and verified. All three findings
are `RESOLVED`; none remains open or accepted. `CONV-001`, the deferred CI
gate, was closed by `CHG-001` after explicit authorisation.

An AI agent prepared this report and recommends this verdict. At R3 a reviewer
accepts it. The agent does not mark its own work converged.
