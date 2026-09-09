# SPEC-0007 — Tasks

| ID | Task | Scope | Status |
|---|---|---|---|
| `T-001` | Trace lead deletion UI → API → service → Prisma → RLS, and verify each layer on the deployed image | investigation | done |
| `T-002` | Trace workspace creation, wizard → route → transaction, and verify on the deployed image | investigation | done |
| `T-003` | Compare the production database's migrations, RLS policies and role grants against a disposable rebuild | investigation, read-only | done |
| `T-004` | Establish the deployed production SHA from runtime evidence | investigation, read-only | done |
| `T-005` | Add the bulk delete affordance to `LeadGrid` and both of its callers | `apps/web/src/app/(workspace)/.../leads/`, `.../smart-views/page.tsx` | done |
| `T-006` | Log rejections from the provisioning route; name rejected fields in the wizard | `apps/web/src/app/api/v1/platform/workspaces/route.ts`, `.../workspaces/new/NewWorkspaceForm.tsx` | done |
| `T-007` | `REG-001` in the e2e suite | `apps/web/tests/e2e/crm-lifecycle.spec.ts` | done |
| `T-008` | Rebuild the web image from the branch and re-run the reproduction against it | verification | done |
| `T-009` | Bounded mutation matrix to establish whether the failure is systemic | verification | done |
