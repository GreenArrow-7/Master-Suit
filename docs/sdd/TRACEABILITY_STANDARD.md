# Traceability Standard

`NORMATIVE — engineering process requirement.`

## The chain

```text
Requirement → Plan decision → Task → Implementation → Test → Result
```

Every link is explicit and machine-checkable by eye. Traceability exists to
answer two questions without reading the whole change: *is everything the
specification asked for actually built and proven*, and *is anything built
that the specification never asked for*.

## The matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-002` | `TASK-003` | `src/services/leads/createLead.ts` | `UT-004`, `IT-002` | pass / fail / not run |

Rules for the cells:

- **Requirement** — the identifier, not a paraphrase.
- **Plan decision** — the `AD-` that shaped it, or "none" where the
  implementation follows an existing pattern with no decision to make.
- **Task** — the `TASK-` that delivered it.
- **Code** — the file, and the symbol where it is not obvious. Not a line
  number.
- **Test** — the test identifiers from the test plan, and the spec file or
  test name where they live once written.
- **Result** — the actual observed outcome, with the date. "Expected to pass"
  is not a result.

## Checks the matrix must be able to fail

A traceability review looks for each of these and reports them by name:

1. A requirement with no task.
2. A requirement with no test.
3. A `SEC-` requirement with no security verification. A unit test that
   happens to touch the area does not discharge a security requirement; a
   `ST-` test that proves the boundary does.
4. A task with no requirement and no approved technical rationale.
5. Implementation outside the allowed scope of any task.
6. A test that asserts something no requirement states.
7. An acceptance criterion with no verification.
8. An architecture change with no `AD-` behind it.
9. A `TH-` threat with no `CTRL-` control, or a control with no verification.
10. A clarification decision that never reached the specification.

## The anti-gaming rule

Do not fabricate traceability by linking artefacts that are merely adjacent. A
test listed against a requirement it does not exercise is worse than an
acknowledged gap, because the gap is now invisible. If a requirement has no
real coverage, write "none" and let the review see it.

The same applies to code cells: naming the file the change happens to touch,
rather than the code that implements the requirement, defeats the purpose.


## Machine checks

The validator mechanises the checks a matrix must be able to fail: a
requirement with no test (`SDD-V027`), a security requirement with no security
verification (`SDD-V028`), a task citing no requirement (`SDD-V026`), an
acceptance criterion with no mapping (`SDD-V029`), and a reference to an
identifier that does not exist (`SDD-V030`). It cannot detect a link that is
real but meaningless, so the anti-gaming rule above stays a human
responsibility.

## Proportionality

- **R2** — a light matrix: requirement, task, test, result. Plan-decision and
  code columns may be omitted where the plan is short.
- **R3 and above** — the full matrix.
- **R4 and R5** — the full matrix plus a separate security view listing every
  `SEC-`, its `TH-`/`CTRL-` mapping, and its `ST-` verification, so a security
  reviewer can read the boundary without reading the feature.

## When the matrix and reality disagree

Traceability is evidence, not decoration. If the matrix says a test covers a
requirement and the test does not, the matrix is wrong and is corrected before
convergence. A convergence verdict rests on the matrix, so a matrix that
flatters the work invalidates the verdict.

## Authority / References

- `AGENTS.md` §5, §8
- `docs/sdd/ARTIFACT_AUTHORITY.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`
- `docs/sdd/IDENTIFIER_STANDARD.md` — qualified reference form
- `specs/templates/TRACEABILITY_TEMPLATE.md`,
  `specs/templates/CONVERGENCE_TEMPLATE.md`
