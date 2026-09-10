# SPEC-0004 — Security example

Synthetic fixture for validator tests. Sample content only.

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0004` |
| Risk | `R3` |
| Status | `IMPLEMENTING` |

## Functional requirements

- `FR-001` — A sample export must include only permitted rows.

## Security requirements

- `SEC-001` — A caller outside the owning group must receive no rows.

## Acceptance criteria

- `AC-001` — An outside caller sees no rows.
