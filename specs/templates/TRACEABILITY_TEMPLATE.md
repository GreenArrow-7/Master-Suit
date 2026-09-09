# SPEC-NNNN — Traceability

> Copy to `specs/SPEC-NNNN-short-slug/traceability.md`.
> Rules: `docs/sdd/TRACEABILITY_STANDARD.md`.
> Do not fabricate links. A requirement with no real coverage is written as
> "none" so the review can see it.

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Risk | `R?` |
| Last updated | YYYY-MM-DD |

## Matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-002` | `TASK-003` | `path/file.ts` — `symbol()` | `UT-004`, `IT-002` | pass YYYY-MM-DD |
| `SEC-001` | `AD-001` | `TASK-002` | `path/file.ts` | `ST-001` | pass YYYY-MM-DD |

Cells hold identifiers and paths, not paraphrases. `Result` is an observed
outcome with a date, never "expected to pass".

## Acceptance criteria

| Criterion | Requirements covered | Verified by | Result |
|---|---|---|---|
| `AC-001` | `FR-001`, `SEC-001` | `E2E-001` | |

## Security view

> Required at R4 and R5, so a security reviewer can read the boundary without
> reading the feature.

| Security requirement | Threat | Control | Security test | Result |
|---|---|---|---|---|
| `SEC-001` | `TH-001` | `CTRL-001` | `ST-001` | |

## Gap checks

Run before requesting approval and again before convergence. Each answer is
yes, no, or the identifiers that fail it.

| Check | Result |
|---|---|
| Every requirement has at least one task | |
| Every requirement has at least one test | |
| Every `SEC-` requirement has a security verification | |
| Every task cites a requirement or an approved technical rationale | |
| No implementation outside an approved task's allowed scope | |
| No test asserts behaviour no requirement states | |
| Every acceptance criterion has a verification | |
| Every architecture change has an `AD-` | |
| Every threat has a control, or an accepted residual risk with an owner | |
| Every clarification decision reached the specification | |

## Notes

Explain any deliberate gap here, with who accepted it. A gap with an
explanation is a decision; a gap without one is an oversight.
