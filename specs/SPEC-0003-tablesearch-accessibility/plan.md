# SPEC-0003 — Plan

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2` |
| Date | 2026-09-08 |

R2 asks for a **short** plan: the mandatory sections present, a line or two
each.

## Approach

Change one file. Keep the native semantics that are already correct, add the
two that are missing, and add Playwright coverage using the harness that
already exists.

## Technical decisions

### AD-001 — Native semantics are kept; no ARIA role or label is added

`type="search"` already yields `searchbox`, and a real `<label htmlFor>`
already supplies the name. Adding `role="searchbox"` or `aria-label` would be
redundant at best and a drift risk at worst.
**Serves:** `ACC-001`, `ACC-002`

### AD-002 — The status region is rendered unconditionally

Move the count `<span>` out of `{count && …}` so the live region exists from
first render and is only its *content* that changes. The element stays empty
and visually unchanged when there is no query.
**Serves:** `ACC-003`

### AD-003 — The "nothing matched" message moves inside the same status region

Rather than adding a second live region. One region, one announcement; two
would race and could double-speak.
**Serves:** `ACC-004`

### AD-004 — ~~`Escape` is handled on the input only, via `onKeyDown`~~ `WITHDRAWN`

**`WITHDRAWN`** — `CL-001` option (c), Product Owner, 2026-09-08. New `Escape`
behaviour is out of scope, so no `keydown` handler is added and this decision
has nothing to decide. `FR-003` and `FR-004` are withdrawn with it.

Kept rather than deleted so the record shows the option was considered.

### AD-006 — The status region is visually hidden, and the visible text is not duplicated to assistive technology

**This refines `AD-003` and is a deliberate deviation from its literal
wording.** It is recorded here, and carried into the convergence report as a
finding for the human code reviewer, rather than taken silently.

`AD-003` says the no-match message "moves inside the same status region".
Implemented literally, the message would relocate from below the table to
beside the search input — a long sentence in a `--lf-text-xs` span inside a
wrapping flex row. That is a visible layout change, and `NFR-003` forbids a
material visual redesign. The two approved statements conflict.

**Resolution.** One live region, as `AD-003` requires, carrying both the count
and the message — but rendered with the existing `.lf-visually-hidden` utility
so nothing moves on screen. The two visible elements keep their current
positions and are marked `aria-hidden` so the same text is not presented twice
to assistive technology.

This satisfies `AD-003`'s stated intent — "One region, one announcement; two
would race and could double-speak" — and satisfies `NFR-003` exactly, with
zero visual change.

`.lf-visually-hidden` already exists in `apps/web/src/app/globals.css` and is
used in `ConversationInbox.tsx` and `LeadGrid.tsx`. It is a clip pattern, not
`display: none`, so its content is announced. **No CSS is added and
`globals.css` is not edited** — it is a prohibited path for `TASK-001`.
**Serves:** `ACC-003`, `ACC-004`, `NFR-003`

### AD-005 — No debounce, no new abstraction, no dependency

`FR-005` and `NFR-001` are constraints, not aspirations. The filter keeps
running on `onInput`.

## Affected files

| File | Change |
|---|---|
| `apps/web/src/components/workspace/TableSearch.tsx` | the only source file |
| a new Playwright spec under `apps/web/tests/e2e/` | **new**, created by `TASK-003` |

**No consumer file changes.** All six call sites render the component
unchanged, which `CL-R07` establishes.

## Data model impact

None. The component performs no I/O and reads no model.

## Security impact

None. See `spec.md` *Security screening* and `08` of the B4.0 evidence: no
authentication, authorization, tenant, secret, PII-handling, integration,
command-execution, file or database surface is touched.

## Deployment impact

None. No environment variable, no migration, no worker, no cache, no queue.

## Rollback

Code-only. Revert two files. No persisted state, no schema, no flag.

## Tests that will prove it

`test-plan.md`. Playwright only — `jsdom` and React Testing Library are absent
and `NFR-001` forbids adding them, so component-level unit testing is not
available for this work.

## Assumptions and unknowns

- The E2E harness needs `.env`, Docker PostgreSQL, a running application and
  `workers: 1`. Whether it currently runs here is **`UNKNOWN — requires
  runtime/infrastructure verification`**. This is a verification prerequisite,
  recorded in `test-plan.md`, not an assumed pass.
- Both clarifications are now `RESOLVED` by a human Product Owner, 2026-09-08.
  `CL-001` resolved to **option (c), descope `Escape`** — not the
  clear-on-`Escape` this plan originally assumed — so `AD-004`, `FR-003` and
  `FR-004` are `WITHDRAWN` and the plan is correspondingly smaller. `CL-002`
  resolved to **option (a), no clear button**, which is what the plan already
  assumed.
