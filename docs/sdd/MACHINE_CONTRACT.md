# Machine Contract

`NORMATIVE — engineering process requirement.` Introduced by Phase B2
(`SPEC-0001`). Defines the machine-readable process metadata that lets tooling
check compliance without parsing prose.

## The division of authority

| File | Authority over | Never holds |
|---|---|---|
| `spec.md` | Intended behaviour: requirements, acceptance criteria, scope | — |
| `sdd.json` | Process metadata: identifier, risk, lifecycle state, artefact paths, history, approvals, reviews | Requirements, acceptance criteria, or any statement of what the system must do |

`sdd.json` is **not a second specification**. If a behavioural statement
appears in it, that is a defect. The validator cross-checks the three fields
that exist in both places — identifier, risk, status — so drift is a finding
rather than a silent inconsistency (`SDD-V011`, `SDD-V012`, `SDD-V013`).

## Location

One `sdd.json` per specification directory, at
`specs/SPEC-NNNN-short-slug/sdd.json`. Required for every specification from
R1 upward. R0 work has no specification directory and therefore no manifest.

## Fields

```json
{
  "schemaVersion": 1,
  "specId": "SPEC-0001",
  "slug": "sdd-verification-enforcement",
  "kind": "change",
  "risk": "R3",
  "status": "IMPLEMENTING",
  "artifacts": {
    "spec": "spec.md",
    "clarifications": "clarifications.md",
    "plan": "plan.md",
    "threatModel": "threat-model.md",
    "testPlan": "test-plan.md",
    "tasks": "tasks.md",
    "traceability": "traceability.md",
    "convergence": null,
    "changeRecord": null
  },
  "statusHistory": [
    { "status": "DRAFT", "date": "2026-09-07" },
    { "status": "READY_FOR_PLAN", "date": "2026-09-07" }
  ],
  "approvals": [
    {
      "gate": "specification",
      "role": "Product Owner",
      "actorType": "human",
      "decision": "approved",
      "evidenceRef": "spec.md#approval",
      "date": "2026-09-07"
    }
  ],
  "reviews": [],
  "evidenceConflicts": []
}
```

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer | Currently `1`. An unsupported version is `SDD-V005` |
| `specId` | `SPEC-NNNN` | Must match the directory name (`SDD-V002`) |
| `slug` | lower-case hyphenated | Must match the directory suffix |
| `kind` | `change` · `bug` · `emergency` | Which workflow governs |
| `risk` | `R0`–`R5` | Must match `spec.md` metadata |
| `status` | a lifecycle state | Must match `spec.md` and the last history entry |
| `artifacts` | object | Relative paths, or `null` where not applicable |
| `statusHistory` | array | Ordered; only legal transitions (`SDD-V018`) |
| `approvals` | array | Gate records — see below |
| `reviews` | array | Review records — a different thing from approval |
| `evidenceConflicts` | array of `EVC-NNN` | Conflicts this specification cites |

Artefact paths are relative to the specification directory. A path that
resolves outside it is rejected, not followed (`SDD-V008`).

## Approval versus review

These are different records with different force, and the distinction is the
point of the whole model.

**Approval** — a gate decision from `docs/sdd/HUMAN_APPROVAL_GATES.md`.

```json
{
  "gate": "implementation",
  "role": "Application Security",
  "actorType": "human",
  "decision": "approved",
  "evidenceRef": "spec.md#approval",
  "date": "2026-09-07"
}
```

`gate` is one of `specification`, `architecture`, `security`, `dataModel`,
`implementation`, `convergence`, `release`, `emergency`, `residualRisk`.
`decision` is `approved`, `rejected` or `pending`.

**Review** — engineering review, which is not a gate.

```json
{
  "type": "code-review",
  "role": "Engineering Reviewer",
  "actorType": "human",
  "decision": "approved",
  "evidenceRef": "PR #123",
  "date": "2026-09-07"
}
```

A review never satisfies an approval gate, and the validator does not treat it
as one.

`actorType` is `human` or `ai`. **A gate that requires a human is satisfied
only by `actorType: "human"`.** A record with `actorType: "ai"` on such a gate
is an ERROR (`SDD-V022`), and so is its absence (`SDD-V020`, `SDD-V034`).

Personal names are not required. A role plus an `evidenceRef` is enough, and
is preferred, because a role survives staff changes and a name does not.

## What the validator can and cannot prove

It can prove that a structured record exists, that it names a human actor
type, and that it sits on the right gate.

**It cannot prove a human genuinely made the decision.** Anyone who can commit
can write that record. The assurance that a human actually approved comes from
commit authorship, code review and branch protection, none of which this tool
provides. This limitation is deliberate, is recorded as `TH-005` in
`SPEC-0001`'s threat model with an accepted residual risk, and is repeated in
`docs/sdd/ENFORCEMENT_STANDARD.md`. Do not describe validator success as proof
of human approval.

## Schema and template

- Schema: `docs/sdd/schemas/sdd-manifest.schema.json` — an interoperability
  contract and documentation. The validator implements the checks directly
  rather than depending on a schema library, per `AD-002`.
- Template: `specs/templates/SDD_MANIFEST_TEMPLATE.json`.

## Authority / References

- `AGENTS.md`; `docs/RISK_CLASSIFICATION.md`
- `docs/sdd/SPEC_LIFECYCLE.md` — the states `status` may hold
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — the gates `gate` may name
- `docs/sdd/IDENTIFIER_STANDARD.md` — `SPEC-NNNN` form
- `docs/sdd/VALIDATION_RULES.md` — the rules that enforce this contract
- `specs/SPEC-0001-sdd-verification-enforcement/` — the specification that
  introduced it

## Specification approval versus implementation readiness

Added by `SPEC-0002/TASK-015`.

The approval record already distinguishes these, because `gate` is an
enumeration and `specification` and `implementation` are separate members.
**No machine-contract change was required**, and none was made: existing
`SPEC-0001` and `SPEC-0002` records validate unchanged.

```json
{ "gate": "specification",  "role": "Product Owner",       "actorType": "human", "decision": "approved" }
{ "gate": "implementation", "role": "Solution Architect",  "actorType": "human", "decision": "approved" }
```

At R3 the first is required and the second is not. At R4 and R5 both apply.
A record for one gate never satisfies the other; `SDD-V059` rejects a
`specification` requirement satisfied by any other gate.

The approval record carries no requirement text and no duplicated policy. It
records who decided what, and when. Which gates a risk level needs is stated
in `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, not inside the record.

**What this still cannot prove.** That the person behind `actorType: "human"`
made the decision. Anyone who can commit can write the record. The check makes
an omission visible; commit authorship, review and branch protection are what
provide assurance.

## Task scope and execution evidence

A task's `Allowed scope` governs the files it **changes**. It does not govern
the evidence its own execution **produces**, and until `SPEC-0002/CHG-008`
nothing distinguished the two.

The consequence was that no task could lawfully record its own result. It was
visible once — `SPEC-0002/ASES-0008` had to edit its specification's
`test-plan.md` to register the tests it was told to write, and the deviation
was recorded as `SPEC-0003/CONV-010` — and invisible everywhere else, because
`create-session` writes a session record into a specification directory that
almost no task declares, and never checked itself.

### The allowance

Within the session's **own** specification only, these are writable regardless
of the task's declared scope:

| Path | Why |
|---|---|
| `execution/ASES-*.json` | the session record |
| `execution/VER-*.json` | the verification record |
| `execution/REV-*.json` | the review record |
| `traceability.md` | the linkage the execution produced |
| `change-record.md` | the change the execution was authorised by |

**This is a closed enumeration, not a pattern.** Nothing else is covered, and
a path that merely resembles one of these is not covered either.

### What is deliberately excluded

| Path | Why it stays outside |
|---|---|
| `spec.md` | carries requirements and acceptance criteria |
| `plan.md` | carries approved technical decisions |
| `clarifications.md` | carries decisions a human made |
| `test-plan.md` | carries test **design**, not only test registration |
| `sdd.json` | carries approvals and the lifecycle state |
| `convergence.md` | carries a verdict |

The line is that the allowance covers artefacts which **record what happened**.
Anything that **states what should happen** is authoring, and a task does not
acquire the right to author by having run.

`test-plan.md` is the debatable one and is excluded on purpose. A task that
must update it declares it, which is what `TASK-020` ended up doing.

### Precedence

The allowance is evaluated **after** the prohibited list, so a task that
deliberately forbids its own execution directory — a review task, for
instance — has that honoured. An explicit prohibition always wins.

It never reaches another specification's directory.

### Effect on history

`SPEC-0003/CONV-010` remains a real deviation after this change. Half of it —
the `change-record.md` edit — becomes lawful; the `test-plan.md` half does not.
The model is fixed going forward and no historical record is retro-fitted to
comply with it.
