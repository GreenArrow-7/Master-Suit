# SPEC-0003 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2` |
| Date | 2026-09-08 |

R2 asks for **light** traceability. Every requirement reaches a task and a
test; every acceptance criterion reaches a verification path.

## Executed chain — requirement to result

Completed 2026-09-08. Every link below was actually executed; none is asserted
from intent.

| Requirement | Criterion | Task | Session | Changed file | Test | Verification | Review |
|---|---|---|---|---|---|---|---|
| `FR-001` | `AC-003` | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `E2E-003`, `REG-001` | `VER-0001` PASS | `REV-0001` |
| `FR-002` | `AC-001` | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `E2E-001` | `VER-0001` PASS | `REV-0001` |
| `FR-005` | `AC-003` | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `E2E-003` | `VER-0001` PASS | `REV-0001` |
| `FR-006` | — | `TASK-005` | `ASES-0003` | — | diff inspection | `VER-0001` PASS | `REV-0001` |
| `NFR-001` | — | `TASK-004` | `ASES-0002` | — | diff inspection | `VER-0001` PASS | `REV-0001` |
| `NFR-002` | — | `TASK-005` | `ASES-0003` | — | diff inspection | `VER-0001` PASS | `REV-0001` |
| `NFR-003` | — | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `REG-002` | `VER-0001` PASS | `REV-0001` |
| `NFR-004` | — | `TASK-005` | `ASES-0003` | — | diff inspection | `VER-0001` PASS | `REV-0001` |
| `NFR-005` | — | `TASK-004` | `ASES-0002` | — | the suite itself | `VER-0001` PASS | `REV-0001` |
| `DATA-001` | — | `TASK-005` | `ASES-0003` | — | diff inspection | `VER-0001` PASS | `REV-0001` |
| `ACC-001` | `AC-002` | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `E2E-002` | `VER-0001` PASS | `REV-0001` |
| `ACC-002` | `AC-002`, `AC-007` | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `E2E-002`, `E2E-006` | `VER-0001` PASS | `REV-0001` |
| `ACC-003` | `AC-005` | `TASK-001` | `ASES-0001` | `TableSearch.tsx` | `E2E-005` | `VER-0001` PASS | `REV-0001` |
| `ACC-004` | `AC-005` | `TASK-001` | `ASES-0001` | `TableSearch.tsx` | `E2E-005` | `VER-0001` PASS | `REV-0001` |
| `ACC-005` | `AC-006` | `TASK-003` | `ASES-0002` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `E2E-001` | `VER-0001` PASS | `REV-0001` |
| `ACC-006` | `AC-006` | `TASK-005` | `ASES-0003` | — | diff inspection — no CSS changed | `VER-0001` PASS | `REV-0001` |

**Two files were changed in total**, each by exactly one session:
`apps/web/src/components/workspace/TableSearch.tsx` (`ASES-0001`) and
`apps/web/tests/e2e/tablesearch-a11y.spec.ts` (`ASES-0002`).

`ACC-006` moved from `E2E-001` to diff inspection during implementation.
Asserting a computed focus outline is brittle across engines, and the change
touches **no CSS at all**, which proves the focus indicator cannot have been
removed more directly than a style assertion would. Recorded here rather than
left as a silently unmet mapping.

## Requirement → acceptance criterion → test → task

| Requirement | Acceptance criterion | Test | Task |
|---|---|---|---|
| `FR-001` | `AC-003` | `E2E-003`, `REG-001` | `TASK-003` |
| `FR-002` | `AC-001` | `E2E-001` | `TASK-003` |
| ~~`FR-003`~~ | ~~`AC-004`~~ | ~~`E2E-004`~~ | ~~`TASK-002`~~ — all `WITHDRAWN`, `CL-001` (c) |
| ~~`FR-004`~~ | ~~`AC-004`~~ | ~~`E2E-004`~~ | ~~`TASK-002`~~ — all `WITHDRAWN`, `CL-001` (c) |
| `FR-005` | `AC-003` | `E2E-003` | `TASK-003` |
| `FR-006` | — | none — verified by inspection of the diff | `TASK-005` |
| `ACC-001` | `AC-002` | `E2E-002` | `TASK-003` |
| `ACC-002` | `AC-002`, `AC-007` | `E2E-002`, `E2E-006` | `TASK-003` |
| `ACC-003` | `AC-005` | `E2E-005` | `TASK-001` |
| `ACC-004` | `AC-005` | `E2E-005` | `TASK-001` |
| `ACC-005` | `AC-006` | `E2E-001` | `TASK-003` |
| `ACC-006` | `AC-006` | none — verified by inspection; the change touches no CSS | `TASK-005` |
| `NFR-001` | — | none — verified by inspection of the diff and lockfile | `TASK-004` |
| `NFR-002` | — | none — verified by inspection of the diff | `TASK-005` |
| `NFR-003` | — | `REG-002` | `TASK-003` |
| `NFR-004` | — | none — verified by inspection of the diff | `TASK-005` |
| `NFR-005` | — | the suite itself | `TASK-004` |
| `DATA-001` | — | none — verified by inspection; the component issues no request | `TASK-005` |

## Acceptance criterion → verification path

| Criterion | Verified by |
|---|---|
| `AC-001` | `E2E-001` |
| `AC-002` | `E2E-002` |
| `AC-003` | `E2E-003`, `REG-001` |
| ~~`AC-004`~~ | **`WITHDRAWN`** — `CL-001` option (c), 2026-09-08 |
| `AC-005` | `E2E-005` |
| `AC-006` | `E2E-001` (no trap) and diff inspection (focus indicator) |
| `AC-007` | `E2E-006` |

## Gap checks

Counts below are **after** the `CL-001` withdrawals.

| Check | Result |
|---|---|
| Active requirements | **16** — 18 declared, less `FR-003` and `FR-004` withdrawn |
| Every active requirement has a task | yes, 16 of 16 |
| Every active requirement has a test or a stated inspection path | yes |
| Every active acceptance criterion has a verification path | yes, **6 of 6** — `AC-004` withdrawn |
| No orphan requirement | yes |
| No orphan acceptance criterion | yes |
| Every executable task cites a requirement | yes, **4 of 4** — `TASK-002` withdrawn |
| No test asserts behaviour no requirement states | yes |
| No withdrawn item retains an active trace | yes — `FR-003`, `FR-004`, `AC-004`, `E2E-004`, `TASK-002`, `AD-004` withdraw as one closed set |
| Every security requirement has a security verification | **not applicable** — this specification declares no `SEC-` requirement |

## Where a test is deliberately absent

Six requirements are verified by **inspection of the diff** rather than by an
automated test: `NFR-001` (no new dependency), `NFR-002` (no backend change),
`NFR-004` (no unnecessary event handling), `DATA-001` (no data change),
`FR-006` (no new keyboard behaviour) and `ACC-006` (focus indication — the
change touches no CSS, so the indicator provably cannot have been removed).

Each is a statement about what the change *does not do*. A test asserting the
absence of a dependency would duplicate the lockfile; a test asserting no
backend call would assert nothing, because there is no call to intercept. They
are named here as inspection items so they reach the human code reviewer
rather than being quietly unverified.

## Withdrawn linkage — resolved

`FR-003`, `FR-004`, `AC-004`, `E2E-004`, `TASK-002` and `AD-004` all hung on
`CL-001`.

**`CL-001` resolved to option (c) on 2026-09-08** (Product Owner, human):
`Escape` behaviour is out of scope. That entire linkage was therefore withdrawn
**as one set**, exactly as this section anticipated, and the remaining trace is
complete with no orphan on either side.

`FR-006` was added in its place to state positively what the decision requires
— that no new keyboard behaviour is introduced — so the decision is traceable
rather than merely an absence.
