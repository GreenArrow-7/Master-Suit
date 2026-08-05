# Unified SaaS acceptance report — 2026-08-03

## Implemented hierarchy

```text
Platform Owner
  Create and inspect workspaces
  Create plans and assign subscriptions
  Enable HRMS and/or Sales
  Set user, employee and storage limits
  Suspend, reactivate, archive and revoke sessions

Company workspace (for example Manath Homes or Leadersfort)
  Company administrator
  Shared employees and workspace users
  People / HRMS
  Sales CRM
```

## Primary routes

Platform Owner:

- `/platform`
- `/platform/workspaces` and `/platform/workspaces/new`
- `/platform/workspaces/{workspaceId}`
- `/platform/plans`, `/platform/subscriptions`, `/platform/users`
- `/platform/audit`, `/platform/system-health`

Company workspace:

- `/{workspaceSlug}/dashboard`
- `/{workspaceSlug}/people`
- `/{workspaceSlug}/people/employees`, `/departments`, `/attendance`, `/shifts`
- `/{workspaceSlug}/people/leave`, `/holidays`, `/documents`, `/work-locations`
- `/{workspaceSlug}/sales/leads`
- `/{workspaceSlug}/sales/{opportunities|accounts|contacts|activities|tasks|calendar|calls|campaigns|reports}`
- `/{workspaceSlug}/admin/{company|users|roles|modules|subscription|integrations|security|audit}`

## Verified scenario

The automated acceptance test creates a Platform Owner, a normalized subscription
plan and two timestamped, isolated companies equivalent to Manath Homes and
Leadersfort. It then:

1. creates a plan with module and limit records, then creates the first workspace
   with HRMS and Sales, limits and a primary admin;
2. rejects its duplicate slug and rejects company-admin platform access;
3. logs in once as the company admin and verifies the workspace destination;
4. creates a Sales department, an employee with `sales_rep` access, and a lead
   owned by the employee's Sales identity;
5. proves department, employee and lead share one workspace ID;
6. proves the second company cannot read the first company's HR data;
7. uses the non-bypass application role to prove RLS returns zero foreign rows and
   rejects a cross-workspace insert with PostgreSQL error `42501`;
8. verifies HR-only and Sales-only entitlement denial;
9. suspends the company, revokes its session and verifies protected access becomes
   unauthorized, then reactivates it.

Result: **passed** (Vitest, 1 scenario, approximately 16 seconds).

## Database migration

`apps/web/prisma/migrations/20260803200000_workspace_hrms_commercial_saas/migration.sql`
adds the normalized commercial entities, membership roles, shared HRMS entities,
indexes, foreign keys and tenant RLS policies. It deployed successfully to the
local PostgreSQL container.
