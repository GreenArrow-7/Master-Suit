# 04 — Product surface inventory

**Phase:** B4.0 · **Date:** 2026-09-08
**Method:** direct inspection of `apps/web`. Every figure below was counted
from the repository, not estimated.

## Scale

| | Count |
|---|---|
| Route pages (`page.tsx`) | **135** |
| API routes (`route.ts`) | **173** |
| Service domains under `src/services/` | **24** |
| Test files under `tests/` | **168** |
| Unit specs under `tests/unit/` | 31 |
| Playwright e2e specs | 16 |

## Route groups

| Group | Surface |
|---|---|
| `(auth)` | login, forgot/reset password, accept-invite, enrol-2FA, service-login |
| `(platform)` | platform admin: workspaces, users, plans, subscriptions, audit, AI usage, system health, settings |
| `(workspace)/[workspaceSlug]` | the product proper: dashboard, people, sales, admin, AI, notifications |

`people/` alone carries ~25 pages: attendance, check-in, compliance,
departments, documents, employees, face-activity, holidays, leave, lifecycle,
onboarding, offboarding, overtime, payroll, payslips, performance,
recruitment, reports, work-locations.

## Service domains

`accounts`, `automation`, `campaigns`, `clients`, `contacts`, `crm`, `dialer`,
`distribution`, `engagement`, `hr`, `identity`, `integrations`, `inventory`,
`leadership`, `leads`, `meta`, `money`, `opportunities`, `platform`, `shared`,
`sla`, `social`, `targets`, `visits`.

## Reusable component surface

`src/components/` — `assistant`, `auth`, `brand`, `communications`, `forms`,
`nav`, `platform`, `pwa`, `sales`, `ui`, `workspace`.

The bounded, shared components most relevant to a first pilot:

| Component | Usages | Character |
|---|---|---|
| `EmptyState` | **43 files** | Presentational; title, description, optional link |
| `TableSearch` | **6 files** | Client-side row filter over already-rendered rows |
| `Pager` | **4 files** | Server-rendered prev/next over `?page=N` |
| `ExportCsv` | **4 files** | Client-side Blob download of a server-built string |
| `ConfigurableGrid`, `FilterSheet`, `ColumnEditor`, `WorkspaceTable` | several | The list/grid machinery |

## Export machinery — two paths, and they have diverged

This is the single most notable finding of the inventory.

**Path A — server, hardened.** `src/lib/csv.ts` is a carefully built encoder:
RFC 4180 quoting, CRLF, a UTF-8 BOM for Excel, keyset-paged streaming, an
`EXPORT_MAX_ROWS` cap, an audit callback, and a **spreadsheet formula-injection
guard** with a numeric exemption so negative money still sums. It is covered by
`tests/unit/csv.spec.ts`, which pins each of those properties.

Used by exactly **two** files: `api/v1/exports/[resource]/route.ts` and
`services/leadership/reports.ts`.

**Path B — client, drifted.** Four HR pages each declare their own local copy:

```ts
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
```

Identical in all four: `people/attendance`, `people/compliance`,
`people/face-activity`, `people/work-locations`. Each quotes and doubles
embedded quotes — and none of them has the formula guard, the BOM, CRLF, or
ISO date handling.

The shared library's own docblock anticipates this exactly:

> "It was extracted from the lead export, which had these properties from the
> start; the report export written later did not, and quietly shipped without
> the formula-injection defence until the two were merged. These pin the
> properties so a third copy cannot drift again."

A third copy did drift. There are four.

## Test coverage character

Strong where it exists and unevenly placed. `tests/unit/` covers libraries and
pure functions well — CSV, grid columns, filter maps, where-merge, CSS tokens.
There are **no direct tests for the shared presentational components**:
`ExportCsv`, `TableSearch`, `EmptyState` and `Pager` have none.

`tests/e2e/ui-states.spec.ts` exercises empty and error states at the page
level through Playwright, which needs a running application.

## Bounded technical debt observed

1. Four drifted CSV encoders (above).
2. `TableSearch` — no Escape-to-clear; the "nothing matches" message is a plain
   `<p>` outside any live region, so a screen-reader user hears the count
   update but not the message.
3. `Pager` — `<nav aria-label="Pagination">` is correct, but the prev/next
   links carry no `rel="prev"` / `rel="next"`.
4. `ExportCsv` — `URL.revokeObjectURL(url)` is called synchronously on the line
   after `a.click()`, and the anchor is never attached to the document.
5. `EmptyState` — accepts an `icon` prop documented as rendering nothing.
   **Zero callers pass it**, so it is dead surface rather than a live defect.

Each is grounded in a file and a line. None was invented to fill a list.
