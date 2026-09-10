# SPEC-0003 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2` |
| Date | 2026-09-08 |

Runner: `npx playwright test`, in `apps/web`. A new spec file is created under
`apps/web/tests/e2e/` by `TASK-003`.

## Tooling constraint, stated first

**Playwright only.** `jsdom`, `happy-dom`, `@testing-library/react` and axe are
absent, and `NFR-001` forbids adding them. `apps/web/vitest.config.mts` sets no
`environment`, so the unit layer has no DOM and cannot render a React
component.

Component-level unit tests are therefore **not available** for this work. Every
case below is an end-to-end browser assertion.

## What Playwright evidence is and is not

Playwright reads the browser's accessibility tree. That is **structural
browser evidence**: it shows what role and name a control exposes.

**No real screen reader is exercised, and none is claimed.** Whether NVDA,
JAWS or VoiceOver announces a live region in a given configuration is not
tested by these cases and is not asserted anywhere in this specification.

## Cases

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `E2E-001` | E2E | `FR-002`, `ACC-005` | The input receives focus by `Tab`, and `Tab` / `Shift+Tab` move focus away in both directions — no trap |
| `E2E-002` | E2E | `ACC-001`, `ACC-002` | `getByRole('searchbox', { name })` resolves; role and accessible name come from native markup |
| `E2E-003` | E2E | `FR-001`, `FR-005` | Typing a query hides non-matching rows and the count reads `N of M shown` |
| ~~`E2E-004`~~ | ~~E2E~~ | ~~`FR-003`, `FR-004`~~ | **`WITHDRAWN`** — `CL-001` option (c) removed `Escape` from scope |
| `E2E-005` | E2E | `ACC-003`, `ACC-004` | The status region is present before any query is typed, and the no-match message appears inside it |
| `E2E-006` | E2E | `AC-007` | A `WorkspaceTable`-rendered instance is findable by the default name `Search` |
| `REG-001` | REG | `FR-001` | Clearing the query restores exactly the original row count |
| `REG-002` | REG | `NFR-003` | The component still renders its label, input and children; no structural change beyond the status region |

**`E2E-004` is `WITHDRAWN`** — `CL-001` option (c), Product Owner, 2026-09-08 —
together with `FR-003`, `FR-004`, `AC-004`, `TASK-002` and `AD-004`.

**No replacement `Escape` test is written.** The approver's instruction was to
preserve existing `Escape` behaviour, and the evidence is that the component
has no `keydown` handler at all. A test asserting that `Escape` does nothing
would assert the absence of a handler rather than a behaviour, and would pass
just as well against a component that had been deleted. `FR-006` — that no new
keyboard behaviour is introduced — is verified by **inspection of the diff**
instead, and is listed as such below.

## Coverage by concern

**Keyboard** — `E2E-001` (Tab reachability, no trap). No Enter or Space case:
there is no button, so there is nothing to activate. No `Escape` case: `CL-001`
put new `Escape` behaviour out of scope and there is no existing behaviour to
regress.

**Focus** — `E2E-001` (can receive focus, and focus leaves in both directions).

**Accessibility semantics** — `E2E-002` (role, accessible name), `E2E-005`
(live region present before content, message inside it), `E2E-006` (default
name). No ARIA attribute is asserted that the implementation does not add;
`ACC-001` and `ACC-002` are satisfied by native markup, so the tests assert the
*outcome* rather than the presence of an attribute.

**Regression** — `E2E-003`, `REG-001`, `REG-002`. Filtering is the behaviour
this pilot must not break.

## Requirements verified without an automated test

Four requirements state what the change **does not** do. Each is verified by
inspecting the diff, and each is named here so it reaches the human code
reviewer rather than being quietly unverified.

| Requirement | Verification method | Owner |
|---|---|---|
| `NFR-001` | No new entry in `apps/web/package.json` or the lockfile | `TASK-004` |
| `NFR-002` | No file outside `apps/web/src/components/workspace/` and the new test is changed | `TASK-005` |
| `NFR-004` | Diff review: one `onInput` and no other event handler; no per-row listener | `TASK-005` |
| `NFR-005` | The Playwright suite is the evidence; the browsers it launches bound the claim | `TASK-004` |
| `DATA-001` | Diff review: the component still issues no request and reads no model | `TASK-005` |
| `FR-006` | Diff review: the component contains no `onKeyDown`, `onKeyUp`, `keydown` or `Escape` reference | `TASK-005` |

A test asserting the absence of a dependency would duplicate the lockfile, and
a test asserting no backend call would have no call to intercept. Naming them
is the honest coverage, not inventing assertions.

`FR-006` is in this table for the same reason. It states that a handler is
*absent*; the diff is the evidence, and `TASK-005` reports it to the human code
reviewer.

## Test data

An existing seeded list page with more than one row. `admin/roles` and
`sales/people` both render `TableSearch` and are reachable in the existing
harness. No new fixture, no production or staging data, no real personal data.

## Environment prerequisites

| Requirement | Evidence level |
|---|---|
| `@playwright/test` installed | **VERIFIED** — `^1.51.1` in devDependencies |
| Playwright configured with `testDir: ./tests/e2e` | **VERIFIED** — `apps/web/playwright.config.ts` read |
| `.env` present with platform-owner credentials | **UNKNOWN — requires runtime/infrastructure verification** |
| Local application running | **UNKNOWN — requires runtime/infrastructure verification** |
| Docker PostgreSQL reachable and seeded | **UNKNOWN — requires runtime/infrastructure verification** |
| `workers: 1` serial execution | **VERIFIED** — set in the Playwright configuration; every spec drives one shared database |
| `globalTeardown` cleans by run tag | **VERIFIED** — configured |

**No secret value is read, printed or referenced anywhere in this
specification.** `.env` is named as a requirement only.

**If the harness cannot run, that is a verification prerequisite and the work
is not verified.** A `PASS` will not be recorded for a suite that did not
execute.

## Out of scope for testing

Real screen-reader announcement; automated accessibility auditing (no axe);
browsers the existing Playwright configuration does not launch; visual
regression.
