# SPEC-0003 — TableSearch keyboard and screen-reader accessibility

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0003` |
| Status | `CONVERGED` |
| Risk | `R2` |
| Author | AI, Planner role |
| Date | 2026-09-08 |

## Problem

`TableSearch` filters the rows already rendered on a list page. It is used at
six call sites across five files. Two things a keyboard or screen-reader user
needs are missing, and both are visible in the component source:

1. **The "nothing matched" message is never announced.** The row count sits in
   an `aria-live="polite"` region, but the `<p>` reading *"Nothing on this page
   matches. Clear the box to see every row again."* is outside any live region.
   A screen-reader user hears `0 of 42 shown` and is never told what to do.

2. **The live region is conditionally rendered.** `{count && (<span
   aria-live="polite">…)}` means the region does not exist in the DOM until the
   first keystroke. A live region inserted at the same moment as its content is
   unreliably announced across assistive technologies.

There is **no clear or reset control**, and no `Escape` handling: emptying the
box requires selecting and deleting the text. **Both are out of scope** —
`CL-002` option (a) and `CL-001` option (c), Product Owner, 2026-09-08. They
are described here as context for the component's current shape, not as
problems this pilot solves.

## Goal

Make `TableSearch` operable and comprehensible without a pointer and without
sight, changing nothing about what it filters or how it looks.

## Background and context

Evidence gathered 2026-09-08 by direct inspection.

| Fact | Evidence |
|---|---|
| Component path | `apps/web/src/components/workspace/TableSearch.tsx` |
| Props | `children`, `placeholder` (default `Search this list…`), `label` (default `Search`), `columns?: number[]` |
| Accessible name | a real `<label className="lf-label" htmlFor={id}>` with `useId()` — **native, correct** |
| Role | `<input type="search">` → `searchbox`. **Native, correct** |
| Keyboard handling | `onInput` only. No `Escape`, no `keydown` handler |
| Focus management | none; native input focus only |
| ARIA present | `aria-live="polite"` on the count span, conditionally rendered |
| Clear / reset control | **none exists** |
| Debounce | **none** — filters on every `onInput` |
| Disabled state | **none** |
| Loading state | **none** |
| Row hiding | `row.style.display = 'none'`, deliberately not `[hidden]` (documented: the mobile card layout's `display: block` beats `[hidden]`) |
| `columns` prop | **passed by no consumer** — all six call sites omit it |

**Call sites (6):** `admin/roles` ×2, `people/attendance` ×1,
`people/face-activity` ×2, `sales/people` ×1, and `WorkspaceTable.tsx` ×1.
`WorkspaceTable` passes **no `label`**, so it falls back to `Search`.

**Existing tests:** `TableSearch` has **none**. `apps/web/tests/e2e/ui-states.spec.ts`
exercises a *different* search — the server-side `?q=` box on the employees
page, whose name comes from `aria-label="Search employees"`. That file
establishes the house pattern `getByRole('searchbox', { name })` and confirms
`type="search"` maps to the `searchbox` role.

## Scope

`apps/web/src/components/workspace/TableSearch.tsx` and Playwright coverage for
it. Nothing else.

## Out of scope

Design-system refactors; other search components including the server `?q=`
boxes; general form-accessibility cleanup; any new accessibility dependency;
application-wide axe integration; layout or visual redesign; backend, API,
schema, authentication, authorization or tenant work; CSV or export work;
`PC-01`, `PC-03`, `PC-04`, `PC-05`.

Reaching any of these means the work has grown past this specification and
stops for a change record.

## Actors

A keyboard-only user; a screen-reader user; a sighted pointer user, whose
experience must not change.

## Functional requirements

- `FR-001` — Row filtering behaviour is unchanged: the same rows match, the
  same rows hide, and the `N of M shown` count reports the same numbers.
- `FR-002` — The search input is reachable and operable by keyboard alone.
- ~~`FR-003` — Pressing `Escape` while the input has focus clears the query and
  restores every row.~~ **`WITHDRAWN`** — `CL-001` option (c), Product Owner,
  2026-09-08. New `Escape` behaviour is out of scope.
- ~~`FR-004` — After `Escape` clears the query, focus remains on the search
  input.~~ **`WITHDRAWN`** — `CL-001` option (c), same decision.
- `FR-005` — Every value change continues to invoke the existing filter on the
  same event, with no debounce introduced.
- `FR-006` — **No new keyboard behaviour is introduced.** The component adds no
  `keydown` or `keyup` handler, and `Escape` continues to do exactly what it
  does today, which is nothing the component acts on.

## Non-functional requirements

- `NFR-001` — No new runtime or development dependency.
- `NFR-002` — No backend, API, schema or migration change.
- `NFR-003` — No material visual redesign. Existing `.lf-*` classes and design
  tokens only.
- `NFR-004` — No additional event handling beyond what the requirements need;
  in particular no listener attached per row.
- `NFR-005` — Verified on the browsers the existing Playwright configuration
  runs. **No claim is made about browsers that configuration does not
  exercise.**

## Security requirements

None. See *Security screening* below.

## Data and privacy requirements

- `DATA-001` — No change to what data is fetched, rendered or transmitted. The
  component filters rows already present in the DOM and issues no request.

## Observability requirements

None. The component logs nothing today and will continue to log nothing.

## Accessibility requirements

- `ACC-001` — The search input exposes the `searchbox` role through native
  `type="search"`. **No ARIA role is added**; the native semantic is already
  correct.
- `ACC-002` — The accessible name comes from the existing visible `<label>`
  element. **No `aria-label` is added**, so the visible text and the accessible
  name cannot drift apart.
- `ACC-003` — The status region announcing the result count is present in the
  DOM from first render, so an assistive technology observes it before its
  content changes.
- `ACC-004` — The "nothing matched" message is announced when it appears.
- `ACC-005` — No keyboard trap: focus can enter and leave by `Tab` and
  `Shift+Tab`.
- `ACC-006` — Visible focus indication is not removed or suppressed.

## Failure behaviour

Unchanged. The component has no error state and performs no I/O.

## Edge cases

- A query matching nothing → all rows hidden, count `0 of M`, message shown and
  announced.
- An empty or whitespace-only query → all rows shown, status region emptied but
  still present in the DOM.
- A consumer that passes no `label` (`WorkspaceTable`) → the default `Search`
  is the accessible name.

## Acceptance criteria

- `AC-001` — Given a user navigating by keyboard, when focus reaches
  `TableSearch`, then the search control receives focus and is operable without
  a pointer.
- `AC-002` — Given `TableSearch` is rendered, when inspected through the
  browser accessibility tree, then the input has role `searchbox` and an
  accessible name taken from its visible label.
- `AC-003` — Given a user types a query, when the value changes, then the
  existing filter runs and the same rows are shown and hidden as before.
- ~~`AC-004` — Given a query is present, when the user presses `Escape`, then the
  query is cleared, every row is restored, and focus remains on the input.~~
  **`WITHDRAWN`** — `CL-001` option (c), Product Owner, 2026-09-08.
- `AC-005` — Given a query matches no row, when the message appears, then it is
  inside a live region that existed before the message did.
- `AC-006` — Given focus is in the search input, when the user presses `Tab`
  and `Shift+Tab`, then focus leaves in both directions — no trap.
- `AC-007` — Given a consumer passes no `label`, when the input is queried by
  accessible name, then it is found as `Search`.

## Dependencies

None added. Playwright and Vitest are already present.

## Assumptions

- `A-001` — `type="search"` maps to the `searchbox` role in the browsers
  Playwright runs. **Evidence: `VERIFIED`** — `apps/web/tests/e2e/ui-states.spec.ts`
  already queries `getByRole('searchbox', …)` successfully.
- `A-002` — The E2E harness can run locally. **Evidence: `UNKNOWN — requires
  runtime/infrastructure verification`.** It needs `.env`, Docker PostgreSQL, a
  running application and `workers: 1`; none was exercised in B4.0.

## Open questions

**None remain.** `CL-001` and `CL-002` were material; both were `RESOLVED` by a
human Product Owner on 2026-09-08 and are recorded in full, with their rejected
options, in `clarifications.md`.

## Risks

- ~~Adding a `keydown` handler could interfere with a consumer's own key
  handling.~~ **No longer applicable** — `CL-001` option (c) removed all new
  keyboard handling from scope, so no `keydown` handler is added at all.
- Rendering the live region unconditionally changes the DOM slightly at rest.
  Mitigated by keeping it empty and visually hidden, so nothing moves on screen.

## Rollback and reversibility expectations

Implicit at R2, and in fact code-only. One component file and one test file; no
persisted state, no schema, no migration, no feature flag. Reverting the commit
restores previous behaviour exactly.

## Implementation constraints

Native HTML semantics preferred over ARIA. No component rewrite, no new
abstraction, no dependency. Existing `.lf-*` classes and tokens only.

## Evidence and existing-system references

- `VERIFIED` — `apps/web/src/components/workspace/TableSearch.tsx`, read in
  full 2026-09-08.
- `VERIFIED` — six call sites located by search; `columns` passed by none.
- `VERIFIED` — `TableSearch` has no existing test.
- `VERIFIED` — `apps/web/tests/e2e/ui-states.spec.ts` covers a different search box.
- `VERIFIED` — `@playwright/test ^1.51.1` present; `jsdom`,
  `@testing-library/react` and axe absent; `apps/web/vitest.config.mts` sets no
  `environment`, so the unit layer has no DOM.
- `DOCUMENTED` — live regions are announced more reliably when present before
  their content changes. Widely documented assistive-technology behaviour;
  **not measured here**.

## Approval

**Gate 1, specification approval. Status: APPROVED.**

`docs/sdd/RISK_TO_PROCESS_MATRIX.md` places R2 specification approval with the
**author**. The author of this specification is an AI, and `AGENTS.md` §7
forbids an agent granting itself an approval or treating its own confidence as
a gate passed. A human therefore had to approve it.

| Gate | Role | Actor type | Decision | Date |
|---|---|---|---|---|
| Specification approval | Product Owner | `human` | **APPROVED** | 2026-09-08 |

The approver recorded the reason explicitly: *"This approval satisfies only the
human approval necessary because the R2 specification author is an AI and may
not self-approve."*

**Scope of the approval — `SPEC-0003` only.** The approver enumerated what it
does **not** authorise, and that list is reproduced here because it bounds
every task in `tasks.md`:

> `PC-01`; CSV/export changes; new `Escape` behaviour; a new clear button;
> unrelated accessibility refactoring; authentication changes; authorization
> changes; tenant-isolation changes; backend/API changes; database changes;
> migrations; dependency additions/upgrades; staging deployment; production
> deployment; release approval; resolution of `EVC-016`.

The approval is *subject to* the two clarification decisions recorded in
`clarifications.md`, which are incorporated above.

**This approval does not discharge any later gate.** R2 still requires a human
code reviewer and a convergence acceptance; neither is satisfied by this
record.
