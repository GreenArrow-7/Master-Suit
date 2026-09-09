# Validator test results

Command: `node --test tools/sdd/tests/validator.test.mjs`
Runner: Node 24.18.0 built-in test runner. No test dependency was added.
Platform: Windows 11. Linux behaviour is expected to match (`NFR-002`) but was
not executed here — `UNKNOWN — requires runtime/infrastructure verification`.

## Result

**54 of 54 pass. 0 fail.**

| Group | Tests | Result |
|---|---|---|
| Valid fixtures and CLI behaviour | 8 | pass |
| Invalid fixtures, one rule each | 32 | pass |
| Security tests | 4 | pass |
| Regression | 1 | pass |
| Repository self-check and diff-aware | 3 | pass |
| Argument safety | 1 | pass |

Note on the runner: `node --test tools/sdd/tests/` with a trailing directory
path failed to resolve on this platform, so the suite is invoked by file. The
same form is used in `tools/sdd/README.md` and in the CI workflow.

## Two defects found and fixed during verification, and one scope change

This is the value of Step 18: the tool was run against the specification that
produced it, and both layers were wrong in different places.

**Validator defect — `SDD-V030` could never fire.** The known-identifier set
was built from every artefact *including* the traceability matrix, so the
matrix vouched for its own references. A phantom reference was therefore
always "known". Fixed in `tools/sdd/lib/validate.mjs` by excluding the
traceability artefact from that set. The test for `SDD-V030` failed before the
fix and passes after, which is the only acceptable evidence that a rule works.

**Artefact defects in `SPEC-0001` itself.** Three tasks cited no requirement
(`SDD-V026`) and several document references were unqualified (`SDD-V040`).
The validator was right and the artefacts were wrong; `tasks.md` and `plan.md`
were corrected. No rule was weakened to obtain a pass.

**A stray control character in the test file.** The final documentation scan
reported `validator.test.mjs` as a binary file. Cause: the sort-key helper in
`UT-009` had been written with a literal NUL byte as its `join()` separator.
The test passed either way, but the file was unreadable to line-based tools.
Replaced with a visible separator; a check across `tools/` now confirms zero
control characters in any file. Found by the scan, not by the suite, which is
why the scan runs over source as well as documentation.

A later scope change, `CHG-001`, added the CI workflow and two tests
(`UT-008`, `UT-009`) covering text output and JSON sort order, taking the
suite from 52 to 54.

Recorded as `CONV-002` and `CONV-003` in the specification's convergence
report.

## Full test list

```text
✔ IT-001/002/003 valid fixtures validate with no findings
✔ UT-001 discovery finds every fixture specification
✔ UT-003 JSON output is deterministic across runs
✔ UT-008 text output names rule, severity, location and message
✔ UT-009 JSON findings are sorted by spec, then rule, then artefact
✔ UT-006 a missing specs root is a tooling failure, not a pass
✔ UT-007 every finding carries a known rule id
✔ UT-004/005 exit codes are 0 on clean and 1 on error
✔ SDD-V001 bad directory name
✔ SDD-V002 spec id does not match the directory
✔ SDD-V003 duplicate SPEC number
✔ SDD-V004 malformed manifest
✔ SDD-V005 unsupported schema version
✔ SDD-V006 unknown risk level
✔ SDD-V007 unknown lifecycle state
✔ SDD-V008 declared artefact missing from disk
✔ SDD-V008 path traversal in an artefact path is rejected
✔ SDD-V009 required artefact missing for the risk level
✔ SDD-V011 spec id disagrees with the manifest
✔ SDD-V012 risk disagrees with the manifest
✔ SDD-V013 status disagrees with the manifest
✔ SDD-V014 duplicate requirement identifier
✔ SDD-V016 broken qualified reference
✔ SDD-V017 open clarification while implementing
✔ SDD-V018 illegal lifecycle transition
✔ SDD-V019 status does not equal the final history entry
✔ SDD-V020 R4 implementing without a human implementation approval
✔ SDD-V021 structurally incomplete approval record
✔ SDD-V022 an AI actor cannot satisfy a human-required gate
✔ SDD-V023 R4 without a threat model
✔ SDD-V024 missing test plan
✔ SDD-V025 missing tasks artefact
✔ SDD-V026 task cites neither a requirement nor a decision
✔ SDD-V027 requirement with no test coverage
✔ SDD-V028 security requirement without a security test
✔ SDD-V029 acceptance criterion without a verification mapping
✔ SDD-V030 traceability references an identifier that does not exist
✔ SDD-V032 CONVERGED with an open convergence finding
✔ SDD-V033 invalid convergence verdict
✔ SDD-V034 RELEASED without a release approval
✔ SDD-V035 evidence-conflict reference that does not exist
✔ SDD-V036 a specification must not mark a conflict resolved
✔ SDD-V037 duplicate change-record identifier
✔ SDD-V039 R0 must not have a specification directory
✔ SDD-V038 R1 carrying a heavy artefact is a warning, not an error
✔ SDD-V040 broken repository document reference
✔ ST-002 the tool contains no dynamic execution construct
✔ ST-003 a pathological line does not cause catastrophic backtracking
✔ ST-004 artefact content is not echoed into findings
✔ ST-001 a traversing artefact path is reported without reading the target
✔ REG-001 the validator writes nothing
✔ IT-005/006 the repository own SDD artefacts validate cleanly
✔ IT-004 diff-aware mode reports rather than guesses
✔ an invalid --base is refused as a tooling failure
```

## Evidence Sources

E1: `tools/sdd/tests/validator.test.mjs`, `tools/sdd/lib/validate.mjs`.
E3: the run above.
E4: `specs/SPEC-0001-sdd-verification-enforcement/test-plan.md`,
`convergence.md`.
