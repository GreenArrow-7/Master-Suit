# Two more pickers that could not hold a second choice on a phone, and a test for the whole class

## What

Yesterday's fix replaced one `<select multiple>` — the employee picker in
`WorkspaceRecordForm` — because iOS renders a multiple select as the one-column
picker wheel, which cannot express more than one choice. It did not ask where
else the pattern appeared. It appeared twice more:

- **Sales → Automatic assignment** (`RulesPanel.tsx`): the "People" and "Only
  leads from these sources" pickers.
- **Administration → Teams** (`TeamsPanel.tsx`): the "Members" picker.

Both are now checkbox groups using the classes the first fix added. And
`tests/unit/no-multiple-select.spec.ts` fails on any `<select multiple>` in
`src`, so there is no fourth one to find later.

The defect report is rewritten around what the reporter actually asked for:
which build their phone runs, which backend it talks to, which commit is
deployed, and a per-defect status on three axes — code fixed, fix delivered,
journey repeated on the device.

## Why

The first fix treated the shared component as the root cause. The root cause is
the control, and two screens built their own.

Neither is cosmetic. A distribution rule that can only ever name one person
changes who new leads are handed to, silently — the rule looks saved and
assigns everything to whoever was tapped last. A team that can only ever hold
one member is the same problem with TEAM data scope behind it, which decides
who can see whose records.

The test exists because this defect is invisible to everyone who develops the
application. On a desktop a multiple select works perfectly. Nothing fails, no
console warns, and the only way to notice is to hold an iPhone. Two instances
shipped that way; a static check is cheaper than a third.

## Where

- `apps/web/src/app/(workspace)/[workspaceSlug]/sales/allocation/RulesPanel.tsx`
  — both pickers. The "People" group keeps the `picked` state the per-person
  turn inputs are built from, now toggled per checkbox.
- `apps/web/src/app/(workspace)/[workspaceSlug]/admin/teams/TeamsPanel.tsx` —
  the members group, with `defaultChecked` from the team being edited.
- `apps/web/tests/unit/no-multiple-select.spec.ts` — new.
- `docs/qa/DEFECTS-2026-11-09.md` — rewritten; see below.

No server contract changed: both submit paths already read their values with
`FormData.getAll`, which collects repeated checkbox names exactly as it collected
a multiple select's.

## Behaviour

- Both screens show a scrolling list of checkboxes with 44px touch targets, and
  an empty note — "Nobody to assign to yet.", "No sources configured yet.",
  "Nobody to add yet." — where the list is empty, instead of an empty control.
- Editing a team arrives with its current members ticked.
- Nothing about saving, validation or permissions changed.

## Verified

- `tests/unit/no-multiple-select.spec.ts` passes, and **fails on the old
  markup** — confirmed by restoring `TeamsPanel.tsx` from `HEAD` and re-running,
  which reported that file as the single offender.
- Full unit suite: **1406 passed, 2 skipped, 0 failed** (81 files).
- `tests/e2e/hr-modules.spec.ts -g "people module"` — **1 passed (44.0s)**,
  run against a disposable `leadflow_test` database at 126 migrations with its
  own Redis, all providers `mock`, and the application connecting as a
  `NOBYPASSRLS` role owning no tables. This is the journey whose heading
  assertion broke yesterday; it now runs end to end, department creation and
  every downstream step included.
- `npx tsc --noEmit` and `npx prettier --check` clean.
- **In a browser at 375×812, by mouse, against a seeded database:** on
  **Administration → Teams**, two members ticked in the New team form and the
  team created — it comes back as `Members: Amina Al Rashid, Anton Novak`, two
  rows, which is the journey the old control could not complete on a phone. Each
  `.lf-choice` measures exactly 44px tall, the list scrolls inside its 220px box,
  and the page does not scroll sideways. On **Sales → Automatic assignment**,
  both groups render with their legends, `select[multiple]` count is 0, and the
  empty sources list shows "No sources configured yet." rather than a dead
  control. The two test teams were deleted afterwards.

## Left open

- **The blank screen (D-01) is still not reproduced and still not fixed.** It
  needs the affected phone; the four-step operator test is in the report. One
  new data point, recorded because it is the first direct observation of the
  leading hypothesis and not because it settles anything: creating the team
  above produced `POST /api/v1/teams → 200` followed by
  `GET …/admin/teams?_rsc=… → net::ERR_ABORTED`. The write landed and the
  `router.refresh()` payload fetch was aborted. Here it cost only a stale list,
  on a local connection, on a screen with no `router.push()` racing it — so it
  is not the blank screen, and must not be reported as its cause. It does show
  the abort is real rather than theoretical.
- **These fixes are not deployed.** PR #239 is green at `872d75d5` and unmerged;
  production runs `1f98183b` from 5 November. Because the iOS app is a WebView
  over `one.youhan.in`, that — not the phone — is why the reporter still sees
  every defect. No new iOS build is needed for any of them.
- **The iOS build labelled "staging" was compiled against production**
  (`MOBILE_SERVER_URL: https://one.youhan.in` in the build's own log, because
  `IOS_STAGING_URL` held that value on 15 October). Testing on that build has
  been testing on production. Not a code change; the owner's call.
- **The app's version string disagrees with Xcode's** — `0.1.0-dev-poc` in the
  user agent against `MARKETING_VERSION 1.2.0` — so support cannot identify a
  build from the server side.
- **Branches still cannot be created**, and **what a lead must carry** is still
  undefined. Both unchanged from yesterday.
- `changes/PROJECT.md` is unchanged: nothing here makes it wrong.
