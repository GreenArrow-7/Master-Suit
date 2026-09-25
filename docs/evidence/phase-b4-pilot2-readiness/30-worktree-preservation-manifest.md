# Local worktree preservation manifest

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Purpose | Prove the requester's uncommitted redesign work is intact before any release operation |
| Local HEAD | `a04c7e3762f0e8e959aa31294ae4139907c7066e` (`dev/yourhan-next`) |
| Remote `dev/yourhan-next` | `63daf3da3fff00366cee9680c520d955e427c0cf` |
| Relationship | siblings from `e620171` — diverged, NOT reconciled |

## `git status --short`

```
 M apps/web/src/app/(auth)/login/LoginForm.tsx
 M apps/web/src/app/(auth)/login/page.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/dashboard/page.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/layout.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadImport.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/[id]/LeadDetail.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page.tsx
 M apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/page.tsx
 M apps/web/src/app/globals.css
 M apps/web/src/app/icon.svg
 M apps/web/src/app/layout.tsx
 M apps/web/src/app/manifest.ts
 M apps/web/src/components/assistant/AssistantWidget.tsx
 M apps/web/src/components/auth/AuthShell.tsx
 M apps/web/src/components/brand/YouhanMark.tsx
 M apps/web/src/components/nav/CommandPalette.tsx
 M apps/web/src/components/nav/TopBar.tsx
 M apps/web/src/components/platform/SupportModeBanner.tsx
 M apps/web/src/components/ui/AiInsight.tsx
 M apps/web/src/components/ui/Badge.tsx
 M apps/web/src/components/ui/EmptyState.tsx
 M apps/web/src/components/ui/MetricCard.tsx
 M apps/web/src/components/ui/PageHeader.tsx
 M apps/web/src/components/ui/StageRail.tsx
 M apps/web/src/components/workspace/ColumnEditor.tsx
 M apps/web/src/components/workspace/ConfigurableGrid.tsx
 M apps/web/src/components/workspace/ListHeader.tsx
 M apps/web/src/components/workspace/MobileTabBar.tsx
 M apps/web/src/components/workspace/Pager.tsx
 M apps/web/src/components/workspace/WorkspaceSidebar.tsx
 M apps/web/src/components/workspace/WorkspaceTopBar.tsx
 M apps/web/src/lib/nav/workspaceNav.ts
 M apps/web/src/styles/tokens.css
 M docs/evidence/phase-b4-pilot2-readiness/20-production-defect-register.md
 M specs/SPEC-0006-regression-suite-stability/spec.md
?? apps/web/src/app/(workspace)/[workspaceSlug]/ai/
?? apps/web/src/lib/nav/modKey.ts
?? docs/evidence/phase-b4-pilot2-readiness/28-production-incident-discovery.md
?? docs/evidence/phase-b4-pilot2-readiness/29-ci-format-remediation.md
?? docs/evidence/phase-b4-pilot2-readiness/30-worktree-preservation-manifest.md
```

## Digests of every uncommitted path

`sha256` of the working-tree bytes. Recompute and compare to prove nothing was altered.

| SHA-256 | Path |
|---|---|
| `aa4bd3d7be099e4a` | `apps/web/src/app/(auth)/login/LoginForm.tsx` |
| `10bf0f2beade19b3` | `apps/web/src/app/(auth)/login/page.tsx` |
| `e7572cab173d0bf8` | `apps/web/src/app/(workspace)/[workspaceSlug]/dashboard/page.tsx` |
| `1e46f713e63bd3ca` | `apps/web/src/app/(workspace)/[workspaceSlug]/layout.tsx` |
| `9b760c3921f433e3` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx` |
| `1cc860eae11a5b64` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadImport.tsx` |
| `844648575c652096` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/[id]/LeadDetail.tsx` |
| `bdda62f94728aa11` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page.tsx` |
| `bf47e58192d717e6` | `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/page.tsx` |
| `32980b2743191145` | `apps/web/src/app/globals.css` |
| `b0376a9a61186c58` | `apps/web/src/app/icon.svg` |
| `65a0e7315beec9a8` | `apps/web/src/app/layout.tsx` |
| `9287de684ae33632` | `apps/web/src/app/manifest.ts` |
| `3aead0ecf525fddb` | `apps/web/src/components/assistant/AssistantWidget.tsx` |
| `9a387b1b3524cf53` | `apps/web/src/components/auth/AuthShell.tsx` |
| `27a4ec152235360a` | `apps/web/src/components/brand/YouhanMark.tsx` |
| `98c77ff3d35f54b1` | `apps/web/src/components/nav/CommandPalette.tsx` |
| `eddeb361dfdc8ce0` | `apps/web/src/components/nav/TopBar.tsx` |
| `ab82606900b1a7de` | `apps/web/src/components/platform/SupportModeBanner.tsx` |
| `606ef2c3ff8a13f2` | `apps/web/src/components/ui/AiInsight.tsx` |
| `49897327d1a1f9c9` | `apps/web/src/components/ui/Badge.tsx` |
| `631e3a198768682c` | `apps/web/src/components/ui/EmptyState.tsx` |
| `14ef20cc6b367ae0` | `apps/web/src/components/ui/MetricCard.tsx` |
| `0aa208e58aad9b40` | `apps/web/src/components/ui/PageHeader.tsx` |
| `b0ebf3865ecb2b98` | `apps/web/src/components/ui/StageRail.tsx` |
| `f1c548da4fc0b794` | `apps/web/src/components/workspace/ColumnEditor.tsx` |
| `d3fdea7b9c2b1b6d` | `apps/web/src/components/workspace/ConfigurableGrid.tsx` |
| `5b0100c0b5875be7` | `apps/web/src/components/workspace/ListHeader.tsx` |
| `0f9a3dc047a0aa9d` | `apps/web/src/components/workspace/MobileTabBar.tsx` |
| `725027c01865daed` | `apps/web/src/components/workspace/Pager.tsx` |
| `eefeaf879aeecd54` | `apps/web/src/components/workspace/WorkspaceSidebar.tsx` |
| `d79f0f434042d0c1` | `apps/web/src/components/workspace/WorkspaceTopBar.tsx` |
| `adfdebce1c666bb7` | `apps/web/src/lib/nav/workspaceNav.ts` |
| `49b3e9f3b40c5c6c` | `apps/web/src/styles/tokens.css` |
| `ab0d3f7a38ee1ead` | `docs/evidence/phase-b4-pilot2-readiness/20-production-defect-register.md` |
| `7ad03c8103cc7ab5` | `specs/SPEC-0006-regression-suite-stability/spec.md` |
| `ae92daf93d58f125` | `apps/web/src/app/(workspace)/[workspaceSlug]/ai/AiLanding.tsx` |
| `96a856f3726afa3b` | `apps/web/src/app/(workspace)/[workspaceSlug]/ai/page.tsx` |
| `11d56912f2b4af47` | `apps/web/src/lib/nav/modKey.ts` |
| `6d07d93b0706d82e` | `docs/evidence/phase-b4-pilot2-readiness/28-production-incident-discovery.md` |
| `312daa895e3571f6` | `docs/evidence/phase-b4-pilot2-readiness/29-ci-format-remediation.md` |
| `4caedb39446a0f20` | `docs/evidence/phase-b4-pilot2-readiness/30-worktree-preservation-manifest.md` |
