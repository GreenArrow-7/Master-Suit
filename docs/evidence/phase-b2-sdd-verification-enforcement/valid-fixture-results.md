# Valid fixture results

## Fixtures

Three canonical valid specifications live at
`tools/sdd/tests/fixtures/valid/specs/`. All content is synthetic; no real
credential, path or product data appears in any of them.

| Fixture | Risk | Status | Artefacts | Exercises |
|---|---|---|---|---|
| `SPEC-0001-lightweight-example` | R1 | IMPLEMENTING | `spec.md` only | The lightweight single-directory model |
| `SPEC-0002-normal-example` | R2 | CONVERGED | spec, plan, test plan, tasks, traceability, convergence | The normal path through to convergence |
| `SPEC-0003-security-example` | R4 | IMPLEMENTING | above plus clarifications and threat model | Security-sensitive work with a human implementation approval |

## Result

```text
$ node tools/sdd/cli.mjs validate --all --root tools/sdd/tests/fixtures/valid
No findings.
result=PASS  errors=0  warnings=0
exit 0
```

**All three pass with zero findings of any severity**, which is the stronger
claim: not merely no errors, but nothing to report at all. A valid fixture
that produced warnings would mean the warning thresholds are wrong.

## What each fixture proves

- **R1** proves the lightweight model validates without a plan, test plan,
  tasks, traceability or convergence, so the process stays usable for small
  changes.
- **R2** proves the full artefact chain resolves end to end: requirement to
  task to test to traceability to a convergence verdict.
- **R4** proves the security path: a threat model with a threat, a control
  and a verification; a security requirement co-located with a security test;
  and a human implementation approval satisfying the gate.

## Regeneration

`node tools/sdd/tests/fixtures/build-fixtures.mjs` rewrites the three valid
fixtures from a single source of truth. Invalid fixtures are not stored; they
are produced at test time by copying this tree and introducing exactly one
defect, so each failure is attributable to that defect alone.

## Evidence Sources

E1: `tools/sdd/tests/fixtures/valid/**`, `build-fixtures.mjs`.
E3: the `IT-001/002/003` test.
