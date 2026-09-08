# Valid fixture results

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

The canonical valid fixture lives on disk at
`tools/sdd/tests/fixtures/agent/`. All content is synthetic. It describes a
sample export filter, not any YOUHAN ONE behaviour, and carries no credential
and no real path from the application.

## Shape

```text
tools/sdd/tests/fixtures/agent/
├── docs/EVIDENCE_CONFLICTS.md
└── specs/SPEC-0001-agent-example/
    ├── sdd.json            R4, IMPLEMENTING, three human approvals
    ├── spec.md             FR-001, SEC-001, AC-001
    ├── clarifications.md   CL-001
    ├── plan.md             AD-001
    ├── threat-model.md     TH-001, CTRL-001
    ├── test-plan.md        UT-001, ST-001, IT-001
    ├── tasks.md            TASK-001 with declared and prohibited scope
    ├── traceability.md
    └── execution/
        ├── ASES-0001.json  IMPLEMENTER, actor agent-alpha, COMPLETE
        ├── VER-0001.json   TESTER,      actor agent-beta,  PASS
        └── REV-0001.json   SECURITY_REVIEWER, actor agent-gamma, APPROVE
```

R4 was chosen deliberately: it is the lowest level at which a human
implementation approval is mandatory, so the fixture exercises the approval
check rather than skipping past it.

The three actor labels differ, which is what makes the separation-of-duty
tests meaningful rather than vacuous.

## Results

| Check | Command | Result |
|---|---|---|
| Structural validation | `validate --all --root <fixture>` | `No findings. result=PASS errors=0 warnings=0` |
| Implementer preflight | `agent preflight --role IMPLEMENTER --task TASK-001` | `PASS`, exit 0 |
| Reviewer preflight | `agent preflight --role SECURITY_REVIEWER` | `PASS`, exit 0 |
| Session and verification | `agent verify-session` | `PASS`, sessions 1, verification records 1 |
| Review | `agent review-check` | `PASS`, review records 1 |
| In-scope change set | `scopeFindings` on two in-scope paths | no findings |

Every valid case returns exit 0 and produces no finding of any severity. A
fixture that passed with warnings would be a weaker baseline, because a later
regression could hide inside the noise.

## Why one fixture rather than several

Every invalid case is produced by copying this tree into a temporary directory
and introducing exactly one defect. A failure is therefore attributable to
that defect and nothing else. Maintaining a second hand-written invalid tree
per rule would let the two drift apart, and a stale invalid fixture is worse
than none: it passes for the wrong reason.

`REG-101` confirms the on-disk fixture is unchanged after every read command
runs against it.
