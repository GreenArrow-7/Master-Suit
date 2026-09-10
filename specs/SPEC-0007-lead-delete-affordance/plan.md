# SPEC-0007 — Plan

`R2`, so this is short by design (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`).

## Affected files

| File | Change |
|---|---|
| `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx` | `canDelete` prop, `deleteSelected` handler, bulk-bar button; one word of the shared failure message |
| `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/page.tsx` | pass `can(ctx, 'leads', 'DELETE')` |
| `apps/web/src/app/(workspace)/[workspaceSlug]/sales/smart-views/page.tsx` | the **second** `LeadGrid` caller — pass the same |
| `apps/web/src/app/api/v1/platform/workspaces/route.ts` | log rejections in `problem()` |
| `apps/web/src/app/(platform)/platform/workspaces/new/NewWorkspaceForm.tsx` | name the fields a `422` rejected |
| `apps/web/tests/e2e/crm-lifecycle.spec.ts` | `REG-001` |

Both `LeadGrid` callers were found by grep before implementing, per `AGENTS.md`
§1 — and the smart-views one is the reason: an administrator working from a
saved view is on the same grid and would otherwise still have had no delete.
The compiler confirmed it, because the prop is required rather than optional.
It is required deliberately: an optional `canDelete` would have let a third
caller ship silently without one.

## Data model

None. No migration, no schema change, no data backfill.

## Deployment

None. No environment variable, no compose change, no worker change, no cache or
queue change. The change is in the web image only.

## Security

No authorization, visibility, RLS, tenant-context or session code is touched.
The added control is a rendering condition over a permission the API kernel
asserts independently. Negative cases are in `test-plan.md` as `TC-004` and
`TC-005` and were run before the fix as well as after, so the boundary is shown
to have held throughout.

## Tests

`REG-001` (e2e) plus the manual matrix in `test-plan.md`. No new dependency is
added for testing: the repository has no component-render harness, and adding
one to assert a button is out of proportion — the affordance is a browser fact
and Playwright is where the repository already asserts browser facts.

## Rollback

`git revert` of the single commit. Nothing else to undo.
