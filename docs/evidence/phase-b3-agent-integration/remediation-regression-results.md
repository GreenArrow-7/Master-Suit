# Full regression stack after remediation

**Phase:** B3 convergence · **Date:** 2026-09-07
**Machine:** Windows 11, Node v24.18.0

Every check the convergence pass required, run after the last code change.

## A. B2 validator tests

```bash
node --test tools/sdd/tests/validator.test.mjs
```

**56 of 56 pass.** The suite grew legitimately from 54 to 56: `TASK-011` added
two `ST-009` tests. No test was weakened, skipped or deleted.

## B. B3 agent tests

```bash
node --test tools/sdd/tests/agent.test.mjs
```

**48 of 48 pass.** Grew from 36 by the twelve attribution tests from
`TASK-012`.

## C. Valid fixtures

All pass. `validate --all` against the agent fixture tree reports no findings,
and the fixture is byte-identical afterwards (`REG-101`).

## D. Invalid fixtures

Every negative case still fails with its expected rule identifier. The mapping
is unchanged from `invalid-fixture-results.md`: seventeen rules, eighteen
cases, `SDD-V051` covered twice.

## E. `validate --all`

```text
No findings.
result=PASS  errors=0  warnings=0
```

**Zero blocking errors, zero warnings.**

## F. `SPEC-0001`

`result=PASS errors=0 warnings=0`

## G. `SPEC-0002`

`result=PASS errors=0 warnings=0`

## H. Preflight for the remediation sessions

| Command | Result |
|---|---|
| `agent preflight --role IMPLEMENTER --task TASK-011` | `PASS`, exit 0 |
| `agent preflight --role IMPLEMENTER --task TASK-012` | `PASS`, exit 0 |

Preflight also **refused** once during this pass, correctly: a duplicate
lifecycle entry produced `SDD-V018` and an unwritten evidence file produced
`SDD-V040`, and no session was authorised until both were fixed. The refusal
is part of the evidence, not an obstacle to it.

## I. Scope checks

| Session | Errors | Warnings |
|---|---|---|
| `ASES-0001` | 0 (was 34) | 25 review |
| `ASES-0002` | 0 | 25 review |
| `ASES-0003` | 0 | 25 review |

The warnings are `SDD-V052` on paths with no recorded digest. All three
sessions predate digest capture, which is `CONV-009`. Zero scope violations.

## J. Verification records

```text
agent verify-session --spec SPEC-0002
Sessions 3; verification records 3.
result=PASS  errors=0  warnings=0
```

## K. Independent reviews

```text
agent review-check --spec SPEC-0002
Review records 3.
result=PASS  errors=0  warnings=0
```

Separation holds: implementers `b3-implementer-session`,
`b3-remediation-allowlist`, `b3-remediation-attribution`; tester
`b3-remediation-tester`; reviewer `b3-independent-reviewer`. No actor reviewed
its own work.

## Historical records preserved

| Record | Result | Preserved |
|---|---|---|
| `ASES-0001` | `PARTIAL` | yes, unedited |
| `REV-0001` | `REQUEST_CHANGES` | yes, unedited |

Neither was rewritten to look successful. They are the record of what the
first session actually produced, and they are the evidence that the scope
control worked.

## Boundaries re-verified

| Check | Result |
|---|---|
| Application files changed by this pass | 0 |
| Pre-existing interface files | 34, untouched, unchanged in `git status` |
| Dependencies added, removed or upgraded | 0 |
| Infrastructure files changed | 0 — `.github/workflows/sdd-validate.yml` unmodified |
| Migrations created or run | 0 |
| Database connections opened | 0 |
| Production or staging access | none |
| Deployments | none |
| Commits, tags, pushes, merges | none; `HEAD` unchanged |
| Approvals fabricated | 0; the approvals array is empty |

## What is still not verified

The CI workflow has still never executed on GitHub, and branch protection
remains externally unverified. Neither was touched, and no claim is made about
either. See `ci-integration-audit.md`.
