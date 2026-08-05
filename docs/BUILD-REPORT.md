# Build and test report — 2026-08-03

## Passing checks

- Prisma schema formatting, validation and client generation passed.
- PostgreSQL migration `20260803200000_workspace_hrms_commercial_saas` deployed
  successfully after the baseline and platform-foundation migrations.
- Unified seed completed successfully and created HRMS, Sales, Business and
  Enterprise plans with normalized module and limit records.
- TypeScript: `npm run typecheck` passed.
- Optimized Next.js 16.2.12 build passed and generated 65 application pages plus
  the dynamic API route tree.
- Focused identity, client-IP and telephony signature regression suite: 3 files,
  9 tests, all passed.
- Unified acceptance suite: 1 end-to-end scenario passed. It exercises owner and
  company login, two companies, duplicate slug rejection, same-workspace HR/Sales
  data, cross-company denial, module-only workspaces, limits, audit, suspension,
  session revocation and RLS denial.
- `npm ci` completed with 0 reported vulnerabilities during setup.

## Python test result

Not applicable to the unified runtime. The customer application no longer starts
or authenticates against the preserved Python HRMS service; core HRMS tables and
routes are implemented in the shared Next.js/PostgreSQL application.

## Release status

The requested architecture and executable acceptance scenario are present. It is
not labeled fully production-ready until the deployment-specific RLS connection,
mandatory owner MFA, real billing/providers and operational recovery gates listed
in `KNOWN-LIMITATIONS.md` are completed.
