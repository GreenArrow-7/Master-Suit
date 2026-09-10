# Invalid fixture results

A validator tested only against valid input proves nothing. Every rule below
has a fixture built to violate exactly that rule, and the test asserts both
that the run fails and that the specific rule identifier is emitted.

## Method

Each invalid case copies the known-good fixture tree into a temporary
directory and introduces **one** defect. A failure is therefore attributable
to that defect rather than to fixture drift. Invalid fixtures are not stored
in the repository, which keeps roughly 150 near-identical files out of it while
keeping every case reproducible from `validator.test.mjs`.

## Results

**32 of 32 invalid fixtures fail with the expected rule.** All exit 1 except
the warning case, which is asserted to exit 0 and then to exit 1 under
`--strict`.

| Fixture | Expected rule | Result |
|---|---|---|
| Bad directory name | `SDD-V001` | fails as expected |
| Spec id does not match the directory | `SDD-V002` | fails as expected |
| Duplicate SPEC number across two directories | `SDD-V003` | fails as expected |
| Malformed `sdd.json` | `SDD-V004` | fails as expected |
| Unsupported schema version | `SDD-V005` | fails as expected |
| Unknown risk level | `SDD-V006` | fails as expected |
| Unknown lifecycle state | `SDD-V007` | fails as expected |
| Declared artefact missing from disk | `SDD-V008` | fails as expected |
| Path traversal in an artefact path | `SDD-V008` | fails as expected |
| Required artefact missing at R3 | `SDD-V009` | fails as expected |
| Spec id disagrees with the manifest | `SDD-V011` | fails as expected |
| Risk disagrees with the manifest | `SDD-V012` | fails as expected |
| Status disagrees with the manifest | `SDD-V013` | fails as expected |
| Duplicate requirement identifier | `SDD-V014` | fails as expected |
| Broken qualified reference | `SDD-V016` | fails as expected |
| Open clarification while implementing | `SDD-V017` | fails as expected |
| Illegal lifecycle transition | `SDD-V018` | fails as expected |
| Status not equal to the final history entry | `SDD-V019` | fails as expected |
| R4 implementing without a human implementation approval | `SDD-V020` | fails as expected |
| Structurally incomplete approval record | `SDD-V021` | fails as expected |
| R4 approval with `actorType: "ai"` | `SDD-V022` | fails as expected |
| R4 without a threat model | `SDD-V023` | fails as expected |
| Missing test plan | `SDD-V024` | fails as expected |
| Missing tasks artefact | `SDD-V025` | fails as expected |
| Task citing neither requirement nor decision | `SDD-V026` | fails as expected |
| Requirement with no test coverage | `SDD-V027` | fails as expected |
| Security requirement without a security test | `SDD-V028` | fails as expected |
| Acceptance criterion without a verification mapping | `SDD-V029` | fails as expected |
| Traceability referencing a phantom identifier | `SDD-V030` | fails as expected |
| `CONVERGED` with an open convergence finding | `SDD-V032` | fails as expected |
| Invalid convergence verdict | `SDD-V033` | fails as expected |
| `RELEASED` without a release approval | `SDD-V034` | fails as expected |
| Evidence-conflict reference that does not exist | `SDD-V035` | fails as expected |
| Specification marking a conflict resolved | `SDD-V036` | fails as expected |
| Duplicate change-record identifier | `SDD-V037` | fails as expected |
| R1 carrying a heavy artefact | `SDD-V038` | warns, exits 0; exits 1 under `--strict` |
| R0 with a specification directory | `SDD-V039` | fails as expected |
| Broken repository document reference | `SDD-V040` | fails as expected |

## The case that failed first, and why that matters

`SDD-V030` did not fire on its first run. The phantom reference was found in
the traceability matrix, and the matrix was part of the set the validator
consulted to decide what counted as a known identifier, so it vouched for
itself. The rule was inert.

The validator was fixed, not the fixture. Had the fixture been adjusted to
make the test pass, the rule would still be dead today and the failure would
have been invisible. This is the whole argument for testing the negative
direction.

## Cross-contamination

Where a single defect legitimately triggers more than one rule, the test
asserts the primary rule and tolerates the others. Two examples: an AI
approval on the implementation gate produces both `SDD-V022` and `SDD-V020`,
because there is genuinely no human approval; and changing a manifest risk
produces both `SDD-V006` and `SDD-V012`, because the manifest now disagrees
with `spec.md`. Both are correct behaviour, not noise.

## Evidence Sources

E1: `tools/sdd/tests/validator.test.mjs`.
E3: the run recorded in `validator-test-results.md`.
E4: `specs/SPEC-0001-sdd-verification-enforcement/test-plan.md`.
