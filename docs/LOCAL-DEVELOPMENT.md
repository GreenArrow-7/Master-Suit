# Local development

Prerequisites: Windows PowerShell, Node.js 22 or newer, and Docker Desktop with
the Linux engine running. Python is not part of the unified application runtime.

First-time setup installs Node dependencies, starts PostgreSQL, Redis and MinIO,
applies all Prisma migrations, and seeds the Platform Owner and subscription
plans:

```powershell
cd "C:\Users\admin\Downloads\Master App\master-saas"
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

For daily work:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Open `http://localhost:3000/login`. There is no customer-facing port 8000 and no
second HRMS login. Both modules use the same Next.js session and PostgreSQL
workspace. Runtime output is written under `.runtime`.

The application requires port 3000. If another local development server already
uses it, stop that server first; `start.ps1` intentionally fails instead of
choosing a different port.

Useful checks from `apps/web`:

```powershell
npm run typecheck
npm run build
npx vitest run tests/security/platform-identity.spec.ts tests/security/client-ip.spec.ts tests/security/telephony-signature.spec.ts
```
