# SPEC-0003 — Change record

Changes made after the specification entered `APPROVED_FOR_IMPLEMENTATION`.
Historical approved intent is never erased; each entry says what changed, why,
and what it affects (`docs/sdd/CHANGE_CONTROL.md`).

## CHG-001

**Date:** 2026-09-08
**Type:** test-quality remediation
**Raised by:** `CONV-006` — `E2E-006` depended on a row count it did not
establish.
**Authorisation:** requested by the human directing Phase B4, who instructed
that the row-count assumption be treated as a test-quality issue and that
remediation be preferred over risk acceptance.

### The defect

`E2E-006` verifies `AC-007`: a consumer that passes no `label` exposes the
default accessible name `Search`. `WorkspaceTable` is the only such consumer,
and it renders `TableSearch` **only once its table has eight rows or more**
(`SEARCHABLE_FROM = 8`).

The case asserted against `/platform/audit`, whose row count comes from
accumulated platform audit events. It passed, but nothing in the suite
guaranteed the precondition: on a freshly reset database the page would render
no search box at all and the case would fail as though the component were
broken.

Every other `WorkspaceTable` consumer was examined for a guaranteed count.
`/platform/settings` renders five rows in one table and six in the other;
`/platform/system-health` renders four probes. Both are deterministic and both
are **below** the threshold, so neither shows a search box. No page in the
repository passes `searchable={true}`, which would force one.

### What changes

`TASK-006` is added. `E2E-006` moves to `/{workspace}/people/departments` and
**establishes** the state it needs: it creates eight departments through the
existing `POST /api/v1/workspaces/{slug}/hr/departments` endpoint, which the
departments page renders one-to-one, then asserts the search box is named
`Search`.

Eight is not incidental — it is `SEARCHABLE_FROM`, and the test says so.

### Why this endpoint

It is already part of the product and already used by the application's own
`WorkspaceRecordForm`. No dependency is added, no fixture file is introduced,
no test-only route is created, and the test no longer depends on any count it
did not create.

### What does not change

No requirement, acceptance criterion or product code is amended. `AC-007` is
verified more strictly than before, not differently. `TableSearch.tsx` is a
**prohibited path** for `TASK-006`: this change may not alter the component to
suit its test.

### Traceability

`CONV-006` → `CHG-001` → `TASK-006` → `E2E-006`
