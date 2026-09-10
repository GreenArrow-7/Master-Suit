# specs/ — specification storage

`NORMATIVE — engineering process requirement.` Storage convention for
Spec-Driven Development artefacts. Created in Phase B1; extended in Phase B2
with the machine-readable manifest below. `SPEC-0001` governs the SDD
validator itself. **No specification for a product feature exists yet** — the
first product pilot is later Phase B work.

## Layout

```text
specs/
├── README.md                       this file
├── templates/                      the blank forms, never edited per-change
│   ├── SPEC_TEMPLATE.md
│   ├── CLARIFICATION_TEMPLATE.md
│   ├── PLAN_TEMPLATE.md
│   ├── THREAT_MODEL_TEMPLATE.md
│   ├── TEST_PLAN_TEMPLATE.md
│   ├── TASKS_TEMPLATE.md
│   ├── TRACEABILITY_TEMPLATE.md
│   ├── CONVERGENCE_TEMPLATE.md
│   ├── CHANGE_RECORD_TEMPLATE.md
│   ├── BUG_TEMPLATE.md
│   └── EMERGENCY_CHANGE_TEMPLATE.md
│
└── SPEC-NNNN-short-slug/           one directory per specification
    ├── spec.md                     what and why
    ├── clarifications.md           resolved ambiguity
    ├── plan.md                     how
    ├── threat-model.md             threats and controls
    ├── test-plan.md                how each requirement is proven
    ├── tasks.md                    bounded units of work
    ├── traceability.md             requirement → task → test → result
    ├── convergence.md              did everything actually align
    └── change-record.md            changes after approval
```


## Machine-readable manifest

Every specification directory from R1 upward also contains `sdd.json`, the
process metadata the validator reads: identifier, risk, lifecycle state,
artefact paths, status history, approvals and reviews. It never holds
requirements. Contract: `docs/sdd/MACHINE_CONTRACT.md`. Template:
`specs/templates/SDD_MANIFEST_TEMPLATE.json`.

Check a specification before asking for review:

```bash
node tools/sdd/cli.mjs validate --all
```

## Rules

**Stable paths.** A specification directory is created once and never moves.
Its status lives in the metadata block inside `spec.md`, not in its location.
Moving completed work to an `archive/` or `done/` directory breaks every
reference from tests, commits, other specifications and change records, which
is exactly what traceability is for. A specification that is `RELEASED`,
`CANCELLED` or `SUPERSEDED` stays where it is.

**Naming.** `SPEC-` plus four zero-padded digits, plus a lower-case hyphenated
slug: `specs/SPEC-0007-lead-export-scope/`. Numbers are allocated in order and
never reused. The slug may be corrected for a typo; the number may not change.

**One storage model, from R1 upward.** Every change above R0 lives in its own
`SPEC-NNNN-short-slug/` directory, whatever its size. R0 experiments need no
directory. There is no separate home for small changes, so no artefact is ever
orphaned outside a specification and every change is reachable by a stable
identifier.

**R1 directories are lightweight.** At R1 the directory typically holds a
short `spec.md` — problem, scope, how it will be checked — and a
`change-record.md` if anything moves after that. `plan.md`,
`threat-model.md`, `test-plan.md`, `tasks.md`, `traceability.md` and
`convergence.md` are not mandatory at R1.

**Only the artefacts the risk level requires.** A file that a risk level does
not require is simply absent, or present with a one-line "Not required at
R2 — see docs/sdd/RISK_TO_PROCESS_MATRIX.md". Do not create nine empty files
for a small change; the process has to stay usable.

**Escalation does not move anything.** If a change turns out to be riskier
than first classified, the same directory grows the artefacts its new level
requires. The path and the number never change.

**Templates are read-only in spirit.** Copy a template into the specification
directory and fill the copy. Improving a template itself is a documentation
change in its own right, and it does not retroactively alter specifications
already written from an earlier version.

**Nothing lives only in chat.** A decision that shaped the work belongs in
`clarifications.md` or in the specification text. Conversation is not an
artefact.

## Which document explains what

| Question | Document |
|---|---|
| How do I run the whole process | `docs/sdd/SDD_WORKFLOW.md` |
| How much process does this change need | `docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md` |
| Which artefact decides what | `docs/sdd/ARTIFACT_AUTHORITY.md` |
| What the statuses mean | `docs/sdd/SPEC_LIFECYCLE.md` |
| How identifiers work | `docs/sdd/IDENTIFIER_STANDARD.md` |
| What makes a good requirement | `docs/sdd/REQUIREMENT_STANDARD.md` |
| When to raise a clarification | `docs/sdd/CLARIFICATION_STANDARD.md` |
| What a plan must contain | `docs/sdd/PLAN_STANDARD.md` |
| How to prove alignment | `docs/sdd/TRACEABILITY_STANDARD.md` |
| Who approves what | `docs/sdd/HUMAN_APPROVAL_GATES.md` |
| Changing an approved spec | `docs/sdd/CHANGE_CONTROL.md` |
| A defect | `docs/sdd/BUG_WORKFLOW.md` |
| A live incident | `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md` |
| What the system currently is | `docs/SYSTEM_INVENTORY.md` and `docs/architecture/` |

## Authority / References

- `AGENTS.md` — engineering constitution
- `docs/sdd/` — the standards above
- `docs/evidence/phase-a-foundation/` — the accepted Phase A baseline this
  process sits on
