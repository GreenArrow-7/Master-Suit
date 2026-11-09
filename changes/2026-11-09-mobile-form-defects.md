# Employees can be assigned on a phone, test roles stop accumulating, and a manager must be able to sign in

## What

Four defects reported from the field on 9 November 2026, fixed; two reports
answered without a code change; one — the P0 blank screen — investigated and
**not reproduced**, with the evidence and the operator test written down rather
than a speculative fix.

- A multi-choice field is a checkbox group, not `<select multiple>`. On iOS the
  latter opens the one-column picker wheel, so no more than one employee could
  ever be chosen and the field stayed at "0 items".
- The reporting-manager list, and the server behind it, now require an active
  login. Deleted and suspended accounts were being offered and accepted.
- The three end-to-end specs that write into the shared demo workspace tag what
  they create with `RUN_TAG`, and the teardown removes it. They were leaving one
  role and one work location per run in a workspace nobody deletes.
- Designations have a screen. They had a complete API and no interface, so the
  field on **Add user** could only ever read "Not set".
- Department, designation and branch say "None configured yet" with a setup
  link, instead of a dropdown holding nothing. Sub-source says whether it is
  waiting for a source or has none configured.

The full table — reproduction, root cause, fix, evidence, status — is in
[docs/qa/DEFECTS-2026-11-09.md](../docs/qa/DEFECTS-2026-11-09.md).

## Why

All of it came from one report with screenshots: an employee picker that would
not hold a selection, role and manager dropdowns full of rows from test runs,
three configuration dropdowns with no options, and a blank screen after saving.

Two of these are worse than they look. A manager who cannot sign in still
approves leave on paper only: a request routed to a suspended account waits with
nobody able to act on it. And the roles left behind by the test suite are not
cosmetic — they are grantable roles in a workspace somebody uses, which is a
role boundary nobody chose.

The blank screen is the one the reporter cares most about, and it is the one
left open. Both journeys were driven here at phone width and both completed
normally, so there is no root cause to fix yet. The service worker, a missing
page-level error boundary and a failed write were each ruled out; a
`router.push()` immediately followed by `router.refresh()`, a failed RSC fetch
in the WebView, and the absence of `global-error.tsx` were not. Guessing at one
of those and calling it fixed would have been worse than saying so.

## Where

- `apps/web/src/components/workspace/WorkspaceRecordForm.tsx` — the checkbox
  group, and the required rule for it, which a checkbox group carries no native
  version of. Five screens are built from this component.
- `apps/web/src/app/globals.css` — `.lf-choice-list`, `.lf-choice`,
  `.lf-empty-note`.
- `apps/web/src/app/(workspace)/[workspaceSlug]/people/users/new/page.tsx` — the
  manager list requires `membership.status === 'ACTIVE'`.
- `apps/web/src/services/identity/accounts.ts` — `setManager` refuses a
  non-active membership; the existing self-reference and loop checks are
  unchanged.
- `apps/web/src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts` —
  `assertManagerEligible` on the employee PATCH, so the rule holds for a request
  that never came from the form.
- `apps/web/src/app/(workspace)/[workspaceSlug]/people/departments/page.tsx` and
  `src/lib/nav/workspaceNav.ts` — designations beside departments.
- `apps/web/src/app/(workspace)/[workspaceSlug]/people/users/new/NewUserForm.tsx`
  and `src/components/forms/SourcePicker.tsx` — the empty states.
- `apps/web/tests/e2e/{business-journey,record-scope,daily-target-workflow}.spec.ts`
  and `tests/e2e/globalTeardown.ts` — the run marker and the cleanup.
- `apps/web/tests/hr/manager-eligibility.spec.ts` — new.

## Behaviour

- A multi-choice field shows a scrolling list of checkboxes with 44px touch
  targets, and "Nothing to choose from yet." when its list is empty. Submitting
  one with nothing ticked, where the field is required, says so instead of
  posting.
- Naming a manager whose login is not ACTIVE is refused with "That account is
  not active, so it cannot be a reporting manager." Reporting lines already
  recorded are left exactly as they are.
- An end-to-end run removes the roles and work locations it created in the
  shared workspace. Rows from earlier runs are **not** touched — see below.
- **Add user** shows "None configured yet" with a link to the setup page for
  departments and designations. Branch says the field can be left unset,
  because nothing in the product can create a branch.

## Verified

- `tests/hr/manager-eligibility.spec.ts` — 3 cases, green. Both refusal cases
  fail when the new check is removed, which was run to confirm it.
- Full vitest suite: 5089 passed, 2 skipped. Two failures, both pre-existing on
  `main` and unrelated: `tests/integration/google-calendar-sync.spec.ts` (422
  where 200 is expected) and a duplicate React key warning reproduced on an
  untouched page.
- `npx tsc --noEmit` clean; `npx prettier --check src tests` clean.
- In the browser at 375×812 against a seeded local database: two employees
  ticked, assigned, and both rows present as `ACTIVE`/`PRIMARY` in
  `HrEmployeeLocationAssignment`; no `select[multiple]` anywhere in the form; a
  designation created through the API appeared in Add user's list on reload.
- Lead creation and the tag edit both completed without a blank screen, which is
  the D-01 non-reproduction rather than a pass.

## Left open

- **D-01, the blank screen.** Not reproduced, no fix. The operator test that
  would settle it is four steps and needs the affected device; it is written out
  in the defect report.
- **Branches cannot be created.** No API, no screen, seed only — and the BRANCH
  data scope depends on them.
- **Rows already leaked.** The teardown fix stops new ones. If the suite was
  ever pointed at a customer workspace, what is already there needs an inventory
  before anything is removed, matched on the run marker and never on a name.
- **What a lead must carry.** Only a full name is required today. Whether a
  phone or an email should be, and at which stage, is a business rule that has
  not been written down.
- `changes/PROJECT.md` is unchanged: nothing here makes it wrong.
