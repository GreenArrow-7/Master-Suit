# SPEC-0009 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |

> **Revision 2, 2026-09-09.** Rebuilt for the narrowed scope. Rows whose
> requirement was delivered by `#48` are not carried forward as if this
> specification still owned them; they are recorded once, below, under
> *Delivered elsewhere*, so the attribution survives.

`Result` is empty throughout except for `TASK-001`: nothing else is
implemented, and a result column filled in before the work is a fabrication.

## Requirement matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-007` | `TASK-002` | `apps/web/package.json` | `ST-003` | — |
| `FR-002` | `AD-007`, `AD-008` | `TASK-002` | `apps/web/package-lock.json` | `ST-003` | — |
| `FR-003` | `AD-007` | `TASK-002` | — | `ST-001` | — |
| `FR-004` | `AD-008` | `TASK-002` | `apps/web/package-lock.json` | `UT-001` | — |
| `FR-005` | `AD-008` | `TASK-003` | `apps/web/package-lock.json` | `UT-002` | — |
| `NFR-001` | `AD-005` | `TASK-002` | — | `ST-002` | — |
| `NFR-002` | — | `TASK-003` | — | `IT-001` | — |
| `SEC-001` | `AD-007`, `AD-009` | `TASK-002` | `apps/web/package.json` | `ST-007` | — |
| `SEC-002` | — | `TASK-003` | — | `ST-004`, `ST-005`, `ST-006` | — |
| `SEC-003` | `AD-005` | `TASK-002` | — | `ST-001`, `ST-002` | — |
| `DATA-001` | — | `TASK-003` | no schema change | `UT-004` | — |
| `OBS-001` | — | `TASK-001`, `TASK-004` | — | `UT-003` | `TASK-001` executed; baseline recorded |

## Acceptance-criterion matrix

| Criterion | Requirements | Verified by |
|---|---|---|
| `AC-001` | `FR-003` | `ST-001` |
| `AC-002` | `FR-001`, `FR-002` | `ST-003` |
| `AC-003` | `FR-004` | `UT-001` |
| `AC-004` | `SEC-001` | `ST-007` |
| `AC-005` | `SEC-002` | `REG-001`, `E2E-001` |
| `AC-006` | `NFR-002` | `IT-001` |
| `AC-007` | `OBS-001` | reported in convergence |

## Threat matrix

| Threat | Controls | Verified by |
|---|---|---|
| `TH-001` | `CTRL-001`, `CTRL-002` | `ST-001`, `ST-002` |
| `TH-003` | `CTRL-004` | `ST-003` |
| `TH-004` | `CTRL-005` | `ST-004`, `ST-005`, `ST-006` |
| `TH-005` | `CTRL-006` | `ST-007` |
| `TH-007` | `CTRL-008` | `IT-003` |
| `TH-008` | `CTRL-009` | human gates |
| `TH-009` | `CTRL-010` | `UT-005` |

`TH-002` (a wrong `next` target) and `TH-006` (mail dispatched by the
`nodemailer` upgrade) are retired with the scope that carried them; both are
`#48`'s risks and `#48`'s CI addressed them.

## Delivered elsewhere

| Revision 1 requirement | Delivered by | Evidence |
|---|---|---|
| `next` 16.2.12 to 16.3.4 | `#48`, commit `00b484c` | CI run `34350379563` `success`; full gate incl. `E2E` on run `34366512152` |
| `nodemailer` 9.0.4 to 9.1.1 | `#48`, commit `00b484c` | same |
| `sharp` 0.35.3 to 0.35.4 resolution | `#48`, commit `00b484c` | same |
| Revision 1 `FR-006` (`npm ci` reproduces the fixed graph) | `#48` | retired here; re-proved for the narrowed graph by `UT-002` |

## Clarification disposition

| Clarification | Status | Affects |
|---|---|---|
| `CL-001` | closed — delivered by `#48` at 16.3.4 | out of scope |
| `CL-002` | closed — delivered by `#48`, lockfile only | out of scope |
| `CL-003` | **resolved — tighten to `^0.35.4`** | `FR-001`, `AD-007`; this is now the whole scope |
| `CL-004` | resolved — 0 production advisories remain at any severity | `AC-007` |
| `CL-005` | open — recommendation is no | out of scope |
| `CL-006` | **open — is the narrowed change still R4?** | every gate |

## Cross-specification dependency

| Specification | Relationship |
|---|---|
| `#48` / `EVC-022` | delivered the three-package upgrade this specification was created to perform; must be integrated into `dev/yourhan-next` before `TASK-002` |
| `SPEC-0007` | supplies the demonstration data `E2E-001` runs against; its `CONV-015` makes the persona suite intermittently red, which `REG-001` must account for when attributing failures |
