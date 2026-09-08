# SPEC-0003 — Clarifications

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2` |
| Date | 2026-09-08 |

`clarifications.md` is required at R2 **only when the change is ambiguous**
(`docs/sdd/RISK_TO_PROCESS_MATRIX.md`). It is present because two genuine
product decisions cannot be settled from repository evidence.

Questions answerable from the repository are recorded as **resolved from
evidence** and are not put to a human. Questions that are UX policy are left
**OPEN**, because choosing them silently would be an agent setting product
behaviour.

---

## Resolved from repository evidence

### CL-R01 — Should `TableSearch` use `input type="search"`?

**It already does**, and it is correct. `type="search"` maps to the
`searchbox` role, which `apps/web/tests/e2e/ui-states.spec.ts` already relies on for a
different box. **No change.** No ARIA role is added over a correct native one.

**Status:** `INCORPORATED` · **Affects:** `ACC-001`

### CL-R02 — Where does the accessible name come from?

From a real `<label className="lf-label" htmlFor={id}>` bound by `useId()`.
This is native and already correct. **No `aria-label` or `aria-labelledby` is
added** — either would let the visible text and the accessible name drift.

**Status:** `INCORPORATED` · **Affects:** `ACC-002`

### CL-R03 — Does the component expose a label prop, and may consumers override it?

Yes: `label` defaults to `Search`. Five of six call sites pass a specific one;
`WorkspaceTable.tsx` passes none and gets the default. **Unchanged**, and
`AC-007` pins the default so the fallback keeps a usable name.

**Status:** `INCORPORATED` · **Affects:** `AC-007`

### CL-R04 — Is there an icon-only interactive control today?

**No.** The component renders one `<label>`, one `<input>`, one count `<span>`
and one message `<p>`. There is no button of any kind, so the icon-button
accessible-name requirement in the brief has nothing to attach to.

**Status:** `INCORPORATED`

### CL-R05 — Is the search debounced?

**No.** `onInput` calls `filter` directly. `FR-005` keeps it that way;
introducing a debounce would change behaviour this pilot is meant to preserve.

**Status:** `INCORPORATED` · **Affects:** `FR-005`

### CL-R06 — Is there a disabled or loading state?

**Neither exists.** No state needs exposing, so no `aria-disabled` or
`aria-busy` is added.

**Status:** `INCORPORATED`

### CL-R07 — Do all six consumers need identical semantics?

**Yes.** All six render the same component; five customise only `placeholder`
and `label`. The `columns` prop is **passed by none**. Semantics are therefore
a property of the component, not of any call site, and no consumer file needs
changing.

**Status:** `INCORPORATED` · **Affects:** scope — no consumer file is touched

---

## Open — product decisions, not evidence questions

### CL-001 — What should `Escape` do?

**Question:** should `Escape` clear the query and restore all rows, or do
nothing?

**Why it matters.** There is no clear control today, so emptying the box means
selecting and deleting the text — awkward with a keyboard. `Escape` is a
common convention for `type="search"` and some browsers already do it natively
for the built-in clear affordance, inconsistently.

Against: `Escape` is also used to dismiss overlays. `FilterSheet` and `Sheet`
exist in this codebase, and a consumer may one day render `TableSearch` inside
one, where a swallowed `Escape` would trap the user in the sheet.

**`FR-003` and `FR-004` are written on the assumption that `Escape` clears and
keeps focus.** If the decision goes the other way, both are withdrawn along
with `AC-004`, and the pilot narrows to `ACC-003`/`ACC-004` only.

**Options:** (a) clear and keep focus; (b) clear only when the input is
non-empty, otherwise let the event propagate; (c) do nothing.

**Recommended for consideration:** (b) — it gives the convenience without
swallowing `Escape` from a future enclosing sheet.

**Decision owner:** Product Owner · **Status:** `RESOLVED`

#### Decision — option (c), 2026-09-08, Product Owner (human)

**New `Escape` behaviour is explicitly out of scope for `SPEC-0003`.** The
pilot preserves whatever `Escape` does today, which — per the evidence in
`spec.md` — is nothing: the component has no `keydown` handler.

*Rationale, as given by the approver:* the first pilot is intended to improve
accessibility while minimising new product semantics. Adding an `Escape`
interaction would expand the behavioural contract rather than improve the
accessibility of the existing one.

**Withdrawn together, and preserved rather than deleted:** `FR-003`, `FR-004`,
`AC-004`, `E2E-004`, `TASK-002`, `AD-004`.

**Constraint carried into implementation:** no requirement, acceptance
criterion, task or test may require `Escape` to clear the search, move focus,
close anything, reset state or trigger any new action. No `Escape` test is
written, because there is no `Escape` behaviour to regress — asserting that a
key does nothing would assert the absence of a handler, not a behaviour.

### CL-002 — Should a visible clear button be added?

**Question:** should the pilot add a visible clear (`✕`) control?

**Why it matters.** It would make clearing discoverable for pointer and
keyboard users alike, and it is the conventional pattern. It also adds a
control to a component that currently has none, which brings its own
accessible-name and focus-order obligations, and touches visual design —
which `NFR-003` currently forbids.

**This specification assumes NO clear button** and is written accordingly. The
brief's `AC-004` about a clear control is therefore conditional and, as
written, applies to `Escape` instead.

**Options:** (a) no button — keep the pilot minimal; (b) add one, accepting
visual change and a wider scope.

**Recommended for consideration:** (a) for a first pilot. (b) is a reasonable
follow-on with its own specification.

**Decision owner:** Product Owner · **Status:** `RESOLVED`

#### Decision — option (a), 2026-09-08, Product Owner (human)

**No new clear or reset control is added.**

*Rationale, as given by the approver:* the pilot should improve the
accessibility of the existing `TableSearch` contract rather than introduce a
new product control.

*Conditional instruction from the approver:* "If an existing clear/reset
control exists in the actual component, its current behavior must be preserved
and made accessible where necessary."

**Evidence check performed against that condition.** `CL-R04` already
established, by reading the component in full, that `TableSearch` renders one
`<label>`, one `<input type="search">`, one count `<span>` and one message
`<p>`, and **no button of any kind**. The condition therefore does not
activate: there is no existing clear control to preserve or to make
accessible.

**No artefact change was required.** `SPEC-0003` was already written assuming
no clear button, so this decision confirms the existing text rather than
altering it. `NFR-003` stands unchanged.

*Note:* `<input type="search">` renders a native browser clear affordance in
some engines. That is user-agent chrome, not a component control, and the
component neither renders nor handles it. It is out of scope and untested.

---

## Effect on readiness

Both clarifications were **material**: `CL-001` determined whether `FR-003`,
`FR-004` and `AC-004` survive, and `CL-002` determined whether the scope stays
where it is.

**Both are now `RESOLVED` by a human Product Owner, 2026-09-08.** No material
clarification remains `OPEN`, which is the exit criterion for `CLARIFYING` in
`docs/sdd/SPEC_LIFECYCLE.md`.

The questions above are kept in full, with their options and the reasoning that
was put to the approver, so the record shows what was decided **and what was
rejected**. Nothing was deleted on being resolved.

| Clarification | Decision | Effect |
|---|---|---|
| `CL-001` | option (c) — descope | `FR-003`, `FR-004`, `AC-004`, `E2E-004`, `TASK-002`, `AD-004` `WITHDRAWN` |
| `CL-002` | option (a) — no button | none; the specification already assumed this |
