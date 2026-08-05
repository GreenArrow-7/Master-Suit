# Master SaaS

Master SaaS is one customer-facing Next.js application with a Platform Owner
control plane and tenant-isolated HRMS and Sales CRM modules. The copied source
applications remain available for reference, but the Windows setup and startup
scripts run only the unified application and its PostgreSQL, Redis and MinIO
dependencies.

## Product hierarchy

```text
Platform Owner
  Workspaces / companies
    Company administrator
      People / HRMS
      Sales CRM
      Employees and workspace users
```

Every HR and Sales row belongs to the same canonical workspace ID. A shared
platform identity can have one or more workspace memberships; company roles and
module access are membership-scoped. Platform owners create companies, select a
plan, enable HRMS and/or Sales, set limits, and suspend or archive workspaces.

## Windows quick start

Docker Desktop must be open and its Linux engine must be ready.

```powershell
cd "C:\Users\admin\Downloads\Master App\master-saas"
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Open only `http://localhost:3000/login`. The local Platform Owner email is
`owner@masterapp.local`; the password is the value entered during first setup.

If startup reports that port 3000 is occupied, close the earlier Sales Lead Flow
development terminal or process and run `start.ps1` again. The launcher will not
silently move this application to another port.

Stop the unified web process with:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop.ps1
```

## Repository layout

```text
master-saas/
  apps/web/       Unified web, APIs, workers and Prisma schema
  apps/hrms/      Preserved legacy source reference; not started for customers
  docs/           Architecture, security, acceptance and operations evidence
  setup.ps1       First-time local provisioning
  start.ps1       One-app Windows launcher
```

See `docs/ACCEPTANCE-REPORT.md` for verified scenarios and
`docs/KNOWN-LIMITATIONS.md` before any production deployment.
