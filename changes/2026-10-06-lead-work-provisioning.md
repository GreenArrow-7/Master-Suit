# A Real-Estate-only workspace could not take a lead; the Visits tab had no icon

**What.** Two defects found while testing Lead Eagle phase 1, fixed in #128.

**Why.**

- The New Workspace wizard created lead stages, activity types and task types
  only when Sales was ticked. A workspace created with Real Estate (or now Lead
  Eagle) and no Sales could not create its first lead — "Lead stage not found"
  — or log an activity. It went unseen because Real Estate was only ever tested
  on the seeded demo workspace.
- The phone tab bar's fourth Real Estate tab, Visits, had no icon since the
  module shipped (25 Sep): `ICONS` had no `visits` entry.

**Where.**

- `services/platform/provisioning.ts` `provisionLeadWork`: the starting lists,
  filled only where a list is empty. Called by
  `api/v1/platform/workspaces` (creation, for any module that works leads) and
  `api/v1/platform/workspaces/[workspaceId]` (when the editor switches one on).
- Migration `20261006000000_provision_lead_work`: repairs existing workspaces
  that work leads and have an empty list. A workspace's own lists are never
  touched; HR-only and cancelled-module workspaces are skipped.
- `components/workspace/MobileTabBar.tsx`: a map-pin icon for Visits.

**Verified.** `tests/tenant/provision-lead-work.spec.ts` (7 cases: the helper,
and the migration SQL run on this spec's workspaces only); the repair migration
applied through `prisma migrate deploy` on the rig; the e2e that creates a
Lead-Eagle-only workspace through the wizard and creates a lead.

**Left open.** Nothing. Releases from #128 on carry 94 migrations.
