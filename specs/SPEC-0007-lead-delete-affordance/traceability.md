# SPEC-0007 — Traceability

## Requirements

| Requirement | Implementation | Test | Bug |
|---|---|---|---|
| `FR-001` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx`, `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/page.tsx`, `apps/web/src/app/(workspace)/[workspaceSlug]/sales/smart-views/page.tsx` | `REG-001`, `TC-001`, `TC-002`, `TC-004` | `BUG-006` |
| `FR-002` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx` | `REG-001`, `TC-001` | `BUG-006` |
| `FR-003` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx`, `apps/web/src/app/api/v1/leads/[id]/route.ts` | `TC-003`, `TC-006`, `REG-001` | `BUG-006` |
| `FR-004` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx` | `TC-007` | `BUG-006` |
| `FR-005` | `apps/web/src/app/api/v1/platform/workspaces/route.ts` | `TC-012` | `BUG-007` |
| `FR-006` | `apps/web/src/app/api/v1/platform/workspaces/route.ts` | `TC-012` | `BUG-007` |
| `FR-007` | `apps/web/src/app/(platform)/platform/workspaces/new/NewWorkspaceForm.tsx` | `TC-012` | `BUG-007` |
| `SR-001` | unchanged — `apps/web/src/lib/api/handler.ts`, `apps/web/src/lib/security/rbac.ts` | `TC-004` | `BUG-006` |
| `SR-002` | unchanged — `apps/web/src/lib/security/visibility.ts`, `apps/web/src/lib/db.ts` | `TC-005`, `TC-011` | `BUG-006` |
| `SR-003` | unchanged — `apps/web/src/lib/api/handler.ts` | `TC-004` | `BUG-006` |
| `SR-004` | `apps/web/src/app/api/v1/platform/workspaces/route.ts` | `TC-012` | `BUG-007` |
| `FR-008` | `apps/web/src/app/(platform)/platform/layout.tsx`, `apps/web/src/app/no-platform-access/page.tsx` | `TC-015` | `BUG-007` |
| `FR-009` | `apps/web/src/app/(platform)/platform/layout.tsx` | `TC-016`, `TC-017` | `BUG-007` |
| `FR-010` | `apps/web/src/app/api/v1/tasks/[id]/route.ts`, `apps/web/src/app/(workspace)/[workspaceSlug]/sales/tasks/TaskRowActions.tsx`, `apps/web/src/app/(workspace)/[workspaceSlug]/sales/tasks/page.tsx` | `TC-014` | `BUG-009` |
| `OR-001` | `apps/web/src/app/api/v1/platform/workspaces/route.ts` | `TC-012` | `BUG-007` |

## Acceptance criteria

| Acceptance criterion | Verified by | Evidence |
|---|---|---|
| `AC-001` | `REG-001`, `TC-001`, `TC-002` | `convergence.md` |
| `AC-002` | `TC-004` | `convergence.md` |
| `AC-003` | `TC-005` | `convergence.md` |
| `AC-004` | `TC-012` | `convergence.md` |
| `AC-005` | `TC-008`, `TC-009`, `TC-010`, `TC-013` | `convergence.md` |
| `AC-006` | `TC-015`, `TC-016`, `TC-017` | `convergence.md` |
| `AC-007` | `TC-014` | `convergence.md` |
| `AC-008` | `TC-018`, `REG-002` | `bug-010.md` |
