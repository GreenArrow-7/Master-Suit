# One visible sales section for a workspace that owns Sales CRM and Real Estate

## What

A workspace entitled to both products saw two sections over one set of rows,
and two sidebar entries both reading **Leads** — `/sales/leads` and
`/realty/leads`, the same leads. Sales CRM is now the single visible sales
section; Real Estate stands down beside it, as Lead Eagle already does.

Navigation only. One model file plus its test. No route, permission,
entitlement or page changed.

## Why

An audit walked the application as a Sales Agent, Sales Manager and
Organization Admin against a seeded workspace and found the duplicate rows in
every role's sidebar. The owner's decision, 18 November: Sales CRM is the single
visible sales section, and the separate Real Estate section comes out of the
sidebar **only once every unique destination has a home**.

## Where

- `src/lib/nav/workspaceNav.ts`
  - `SectionDef.unlessModule` — a whole section is not offered when another
    section already carries every one of its destinations. Tab-level
    `unlessModule` says "this screen is filed elsewhere"; this says "this
    product section is filed elsewhere", which is the single decision actually
    being made rather than 25 look-alike ones.
  - `NavTab.andModule` — shown only when the workspace ALSO holds this module.
    `module` is any-of; this is the and. It grants nothing: the tab keeps its
    own `module` and permission, and the route still refuses independently.
  - The Real Estate section takes `unlessModule: S`.
  - Three screens Real Estate owns outright are rehomed under
    `module: R, andModule: S` — **Brokerage Overview** (`realty/dashboard`) into
    Home › My Workspace, **Properties** (`realty/properties`) and **Off-Plan**
    (`realty/projects?possession=…`) into Properties › Property Inventory.
  - 22 Sales tabs gain the `realty/` path as an alias, and 17 keep the
    `lead-eagle/` aliases the Real Estate section used to carry, so an old
    bookmark still lights the right row.
- `tests/unit/nav-sales-realty-merge.spec.ts` — **new**.

## Behaviour

- **Sales + Real Estate**: 9 sections → 8, 22 sidebar rows → 16, 112 tabs → 90
  for an organisation administrator; 7 → 6, 17 → 13, 55 → 44 for an agent. No
  two sidebar rows share a label.
- **Sales only, Real Estate only, Lead Eagle only**: byte-identical, every role.
  A Real-Estate-only customer does not have to buy Sales CRM to reach their
  tools.
- Every URL still works and still resolves to a sidebar row. `/realty/leads`
  lights **Leads**, `/realty/requirements` lights **Property Inventory**,
  `/realty/dashboard` lights **My Workspace**.
- Nothing is unlocked. A Sales-only workspace never sees the rehomed tabs; a
  role without `projects:VIEW` never sees Properties.

## Verified

`tests/unit/nav-sales-realty-merge.spec.ts` — 19 assertions; **8 fail on the old
code**. They cover the dropped section, the absence of duplicate row labels,
Real-Estate-only and Lead-Eagle-only staying as they are, the three rehomed
screens, the preserved lead-eagle aliases, eight old bookmarks resolving to a
row, and three ways a rehomed tab must stay hidden.

The destination check is the one that makes this safe: for each of **12 role ×
entitlement combinations**, every href and alias offered before the change is
still offered after. It found a real regression while this was being written —
suppressing the section also dropped the `lead-eagle/` aliases it carried, which
would have left a Sales + Real Estate + Lead Eagle workspace with bookmarks that
lit no row. Those aliases moved to the surviving Sales tabs.

`tests/unit/workspace-nav.spec.ts`, `realty-routes.spec.ts`,
`lead-eagle-routes.spec.ts`, `nav-permissions.spec.ts`: **784 pass, unmodified**
— including the screen-coverage guard, satisfied because the Sales tabs now
carry the `realty/` aliases.

`npx tsc --noEmit` reports no error in `src/`.

**Not verified:** no screenshot of the result. The production build cannot
complete on this tree (a Next.js security nudge stops it) and `next dev` enters
a Fast Refresh loop that makes the sign-in form unusable, so the before/after
evidence here is the navigation model's own output, not a rendered sidebar.

## Left open

- A rendered check of the new sidebar at 375, 768 and 1280, once the app can be
  served again.
- The duplicate **Teams** tabs in Settings, the Performance fan-out across eight
  tabs, and the mobile lead-list header stack — all found by the same audit,
  all deliberately out of this change.
- `REAL_ESTATE`-only and `LEAD_EAGLE`-only workspaces still render a one-tab
  **CRM** section, because `My Tasks` carries no module. Pre-existing, untouched.
