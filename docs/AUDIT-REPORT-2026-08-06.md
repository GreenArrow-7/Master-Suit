# MASTER SAAS — FULL AUDIT REPORT

**Workspace:** `C:\Users\admin\Downloads\Master App\master-saas`
**Scope:** `apps/web` (Next.js 16 + Prisma 7 + PostgreSQL), `apps/hrms` (Python), `apps/face`
**Date:** 2026-08-06
**Reviewer role:** development / testing / security

---

## 0. What was actually run

| Gate | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ **PASS** (0 errors, 24,189 LOC) |
| Lint | `npm run lint` | ❌ **BROKEN** — `next lint` removed in Next 16; no ESLint/Biome/Prettier config exists at all |
| Format check | — | ❌ **DOES NOT EXIST** |
| Unit tests | `npx vitest run` | ⚠️ **6 files failed, 12 passed / 3 failed, 129 passed, 36 skipped** |
| Prod build (as shipped) | `npm run build` | ❌ **FAILS** — env validation rejects the committed `.env` |
| Prod build (real providers) | `EMAIL_PROVIDER=smtp … npm run build` | ✅ **PASS** in 12.7 s, 0 warnings |
| Dependency audit | `npm audit --omit=dev` | ⚠️ **1 high** (`fast-uri` GHSA-7p8r-x3mc-p8w7) |
| E2E | `playwright test` | ❌ **NO CONFIG, NO SPECS** — script is a stub |
| RLS proof | `vitest tests/tenant/rls.spec.ts` | ⚠️ **SILENTLY SKIPPED** (10 tests) |
| Python tests | — | ⏸ not run (service is orphaned — see §4.5) |

**Verdict: NOT production-ready.** The architecture is good — genuinely good in places — but there are six individually release-blocking defects, and the security test suite that should catch them proves nothing in its current state.

### Test-suite breakdown (per file)

| File | passed | failed | skipped |
|---|--:|--:|--:|
| `hr/antivirus.spec.ts` | 7 | | |
| `hr/attendance.spec.ts` | 25 | | |
| `hr/rules.spec.ts` | 15 | | |
| `hr/settings.spec.ts` | 12 | | |
| `integration/session-lifecycle.spec.ts` | | | 5 |
| `integration/unified-saas.spec.ts` | | | 1 |
| `permission/engagement-modules.spec.ts` | | 3 | |
| `permission/scope.spec.ts` | | | 10 |
| `security/client-ip.spec.ts` | 2 | | |
| `security/consent.spec.ts` | 8 | | |
| `security/platform-identity.spec.ts` | 3 | | |
| `security/telephony-signature.spec.ts` | 4 | | |
| `tenant/calls.spec.ts` | 6 | | |
| `tenant/isolation.spec.ts` | | | 10 |
| `tenant/rls.spec.ts` | | | 10 |
| `unit/*` | 13+ | | |

---

# PART 1 — CRITICAL (P0)

## P0-1 · Privilege escalation: any employee → Company Administrator

**`src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts:147-195`**

```ts
roleKey: z.string().min(2).max(50).default('employee'),   // ← attacker-controlled
...
let role = await tx.role.findFirst({ where: { tenantId: ctx.tenantId, key: input.roleKey } });
if (!role) { role = await tx.role.create({ ... rank: 100 ... }); }
const salesUser = await tx.user.create({ data: { ..., roleId: role.id } });  // ← no rank check
```

`roleKey` comes straight from the request body. If the named role already exists in the tenant, the new user is bound to it — **with no `assertMayAdministerRole` and no rank comparison.** `company_admin` is created at `rank: 10` by every workspace provisioning (`platform/workspaces/route.ts:141`).

**The chain:**
1. Any user with `hrms:CREATE` POSTs `{ roleKey: "company_admin", email: "me2@x.com", initialPassword: "…" }`.
2. They now have a Company Administrator account with a password they chose.
3. Log in as it. Full workspace control — users, roles, every HR document, every lead.

The role auto-created by this same route (line 171-172) grants `hrms` VIEW/CREATE/EDIT — so **every employee provisioned through this endpoint can perform the escalation.**

The correct guard already exists and is used everywhere else (`rbac.ts:73`, `roles.ts:206`, `accounts.ts:286`). This one route bypasses it.

**Fix**

```ts
// hr/[resource]/route.ts, case 'employees', before tx.user.create
const role = await tx.role.findFirst({ where: { tenantId: ctx.tenantId, key: input.roleKey } })
  ?? await createDefaultEmployeeRole(tx, ctx.tenantId, input.roleKey);
assertMayAdministerRole(ctx, role.rank, role.id);   // ← the missing line
```

Also gate the whole `case 'employees'` on `isHrAdmin(ctx)` — creating user accounts is a user-administration operation and belongs behind `users:MANAGE_USERS`, not `hrms:CREATE`.

---

## P0-2 · Password hashes and TOTP secrets served over the API

**`src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts:46-51, 55, 69, 103`**

```ts
case 'employees': return prisma.employeeProfile.findMany({
  include: { membership: { include: { platformUser: true, salesUser: { include: { role: true } } } }, ... },
});
```

`platformUser: true` in Prisma means **every scalar column**. `PlatformUser` carries:

```
passwordHash      String?
mfaSecret         String?
mfaRecoveryCodes  String[]
```

`User` carries the same three. The handler returns this object straight to `NextResponse.json()` — `api/handler.ts:109` — with no serialiser.

**So `GET /api/v1/workspaces/{slug}/hr/employees` returns the Argon2 hash, the TOTP shared secret and the unused recovery codes for every person in the workspace, to anyone holding `hrms:VIEW`** — i.e. every employee. A TOTP secret is not a hash: it lets the holder generate valid 2FA codes forever. This defeats MFA for the whole company.

Same leak on `attendance` (:51), `leave` (:55), `leave-pending` (:69), `location-assignments` (:103), and in `services/hr/{attendance,documents,leave,lifecycle,requests}.ts`.

`lib/security/fieldSecurity.ts` exists and does exactly the right thing — but it is wired into the **Sales** routes only (19 files). Zero HR routes use it.

**Fix (do both)**

```ts
// 1. Never return the model wholesale.
platformUser: { select: { id: true, fullName: true, email: true, avatarUrl: true, status: true } }
salesUser:    { select: { id: true, fullName: true, email: true, status: true, role: true } }
```

```ts
// 2. Belt and braces — global egress scrub in api/handler.ts step 5:
const SECRET_KEYS = new Set(['passwordHash','mfaSecret','mfaRecoveryCodes','tokenHash','keyHash','configEncrypted','signingSecretEnc']);
const result = scrub(await handler({...}));   // deep-delete SECRET_KEYS
```

`lib/security/audit.ts:27` already defines this list — reuse it. Then add a test asserting no API response body ever contains `passwordHash`.

---

## P0-3 · "Forgot password" writes to the wrong table

**`src/app/api/v1/auth/reset-password/route.ts:44-50`** writes to `User`:

```ts
prisma.user.update({ where: { tenantId, id: record.userId }, data: { passwordHash, ... } })
```

**`src/app/api/v1/auth/login/route.ts:40, 78`** authenticates against `PlatformUser`:

```ts
const user = await prisma.platformUser.findUnique({ where: { normalizedEmail } });
const ok = await verifyPassword(user.passwordHash, body.password);
```

Two different tables.

- **Functional:** the new password never works. The user is locked out of a working account with no support path.
- **Security:** this is the incident-response flow. A user whose password leaked resets it, is told "done", and **the leaked password still logs in.** `revokeAllSessions` (line 53) kills their session, so the attacker's session survives and the victim's doesn't.

`services/identity/accounts.ts:115-119` gets this right — it updates *both* tables in one transaction. The reset route was never updated to match.

**Fix**

```ts
await prisma.$transaction([
  prisma.user.update({ where: { tenantId: tenant.id, id: record.userId }, data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } }),
  prisma.platformUser.update({ where: { id: membership.platformUserId },  data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } }),
  prisma.passwordResetToken.update({ where: { tenantId: tenant.id, id: record.id }, data: { usedAt: now } }),
]);
```

**Better long-term:** drop `User.passwordHash` entirely. Two credential stores for one identity is the root cause and will produce this bug again. See P1-9.

---

## P0-4 · Row-Level Security is enabled in the database and completely bypassed at runtime

**`prisma/migrations/20260803230000_rls_full_coverage/migration.sql:63`**

```sql
CREATE POLICY tenant_isolation ON %I FOR ALL TO master_saas_app
  USING ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
```

The policy applies **`TO master_saas_app`** only.

**`apps/web/.env`**

```
DATABASE_URL=postgresql://leadflow:leadflow@localhost:5432/leadflow
```

The application connects as `leadflow` — the role that **owns the tables**. Postgres table owners bypass RLS unconditionally unless `FORCE ROW LEVEL SECURITY` is set, and it isn't. Even if it were, the policy doesn't name `leadflow`.

**Result: RLS provides zero protection to the running application.** The only thing between tenants is the Prisma extension in `db.ts` — one layer, in application code, where a forgotten `where` clause is a one-character mistake.

Worse, this is **false assurance**: `tests/tenant/rls.spec.ts` connects as `master_saas_app` via a *separate* `RLS_DATABASE_URL`, so the RLS suite would pass green while proving nothing about the process serving real traffic.

**Fix**

```sql
-- 1. Make ownership irrelevant (add to the catalog loop, per tenant-owned table)
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
```

```diff
- DATABASE_URL=postgresql://leadflow:leadflow@localhost:5432/leadflow
+ DATABASE_URL=postgresql://master_saas_app:${APP_DB_PASSWORD}@localhost:5432/leadflow
```

Keep migrations running as the owner via a separate `MIGRATION_DATABASE_URL`; web and worker processes must never use it. Add a boot assertion:

```ts
// lib/db.ts, once at startup
const [{ rolbypassrls }] = await prisma.$queryRaw`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
if (env.NODE_ENV === 'production' && rolbypassrls) throw new Error('Refusing to start: database role bypasses RLS.');
```

---

## P0-5 · Turning RLS on will break every write in the application

**`src/lib/db.ts:203-205`**

```ts
export function withTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return inTenantTx.run(true, () => prisma.$transaction(fn as any) as Promise<T>);
}
```

`inTenantTx.run(true, …)` tells the per-query wrapper **to stop setting `app.tenant_id`** (line 143) — but `withTx` never sets it itself. Only `withTenantTx` (line 211) does, and almost nothing calls it.

Under the real RLS role, `current_setting('app.tenant_id', true)` is `''` inside every `withTx` block, so `USING`/`WITH CHECK` evaluate to `NULL` → false. **Every insert and update inside `withTx` is rejected.** That includes workspace provisioning (`platform/workspaces/route.ts:72`), employee creation (`hr/[resource]/route.ts:167`), and workspace edits.

This is why P0-4 has gone unnoticed: the moment anyone switches the connection role, the product stops working. **The two defects hide each other. Fix them together or not at all.**

**Fix — collapse the two helpers into one**

```ts
export function withTx<T>(tenantId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return inTenantTx.run(true, () => prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  }));
}
```

Make `tenantId` required, delete `withTenantTx`, and let the type errors drive the migration. For platform-owner paths that legitimately cross tenants, add an explicit `withPlatformTx()` setting a documented `app.platform_admin` GUC with a matching bypass policy — never an unset context.

---

## P0-6 · The seed will provision production with a published password

**`prisma/seed/index.ts:20`**

```ts
const DEMO_PASSWORD = 'Meridian!Demo2026';
```

There is **no `NODE_ENV` guard, no confirmation prompt, no host check** anywhere in the 869-line seed. `npm run db:seed` pointed at a production `DATABASE_URL` creates dozens of real, active, `emailVerifiedAt`-stamped accounts sharing one password committed to the repository.

`scripts/check-test-data.mjs` exists but is only wired to `preflight`, not to `db:seed`.

**Fix**

```ts
// top of prisma/seed/index.ts
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'yes') {
  throw new Error('Refusing to seed demo data. Set ALLOW_DEMO_SEED=yes in a non-production environment.');
}
```

Generate `DEMO_PASSWORD` per-run with `randomBytes`, printing it once to stdout.

---

# PART 2 — HIGH (P1)

## P1-1 · Broken access control on 28 server-rendered pages, including every admin screen

**`src/lib/workspace-page.ts`** — the helper 46 of 65 workspace pages use — **performs no permission check whatsoever.**

```ts
export async function resolveWorkspacePage(workspaceSlug: string, module?: ProductModule) {
  const ctx = await resolveCtx(...);
  const workspace = await requireWorkspace(ctx, workspaceSlug, module);
  return { ctx, workspace };            // ← no assertPermission
}
```

Pages with **no** permission check (verified by grep):

| Page | What any authenticated employee can read |
|---|---|
| `admin/[section]` → `company` | Full company profile |
| `admin/[section]` → `roles` | Every role and its permission count |
| `admin/[section]` → `modules` | Module entitlements and expiry |
| `admin/[section]` → `subscription` | Plan, seat limits, storage, trial dates |
| `admin/[section]` → `security` | Whether MFA is enforced, workspace status |
| `admin/integrations` | Every configured integration, key name, auth method, sync errors |
| `people/employees` | The complete employee directory |
| `people/reports` | HR reporting |
| `people/departments`, `holidays`, `shifts` | HR configuration |
| `sales/people` | Full sales roster |
| `dashboard` | HR headcount, pending leave approvals, **and the subscription/billing panel** |

Plus `sales/{calendar, call-audits, dashboards, events, forms, landing-pages, reports, targets, page}`, `sales/{accounts,contacts,calls}/[id]`, `tasks`, `notifications`, `profile/security`, `people/employees/new`.

`admin/integrations/page.tsx:29` is additionally wrong: it calls `resolveCtx` directly and **never calls `requireWorkspace`**, so it doesn't verify the URL slug matches the session's tenant, and the entitlement gate is skipped.

**Fix — make the check mandatory by making it a parameter**

```ts
export async function resolveWorkspacePage(
  workspaceSlug: string,
  opts: { module?: ProductModule; permission: [string, Action] },   // ← required
) {
  const ctx = await resolveCtx(...);
  const workspace = await requireWorkspace(ctx, workspaceSlug, opts.module);
  assertPermission(ctx, opts.permission[0], opts.permission[1]);
  return { ctx, workspace };
}
```

Every call site becomes a compile error until it declares what it needs. That is the only version of this fix that stays fixed.

---

## P1-2 · Login rate limiting shares one global bucket — 10 logins per 15 min, platform-wide

**`src/lib/auth/session.ts:327-331`**

```ts
export function clientIp(req: Request, trustProxyHeaders = env.TRUST_PROXY_HEADERS): string | null {
  if (!trustProxyHeaders) return null;      // ← default is false
  ...
}
```

**`src/app/api/v1/auth/login/route.ts:31, 36`**

```ts
const ip = clientIp(req) ?? 'unknown';
await consume(limits.loginPerIp(ip));       // key = "login:ip:unknown"
```

`loginPerIp` is `max: 10, windowSeconds: 900` (`ratelimit.ts:34`). `TRUST_PROXY_HEADERS` defaults to `false`. Behind any load balancer — every real deployment — `clientIp` returns `null` for **every request from every user**, so they all collide on `login:ip:unknown`.

**The 11th login attempt on the entire platform, from anyone, in any workspace, gets a 429 for 15 minutes.**

Compounding it: `ratelimit.ts:18` performs the `zadd` **before** the count check, so rejected attempts keep extending the window. Once tripped, ordinary retry traffic holds the platform locked out indefinitely.

Every audit row also records `ipAddress: 'unknown'` — forensics are worthless.

**Fix**

```ts
// env.ts — replace the boolean with an actual allow-list
TRUSTED_PROXY_CIDRS: z.string().default(''),   // e.g. "10.0.0.0/8,172.16.0.0/12"
```

```ts
// session.ts
export function clientIp(req: Request): string | null {
  const socketIp = req.headers.get('x-real-ip');
  if (!isTrustedProxy(socketIp)) return socketIp;
  const chain = (req.headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim());
  return chain.reverse().find(ip => !isTrustedProxy(ip)) ?? socketIp;
}
```

In `ratelimit.ts`, count first and only `zadd` on accept — or use a fixed-window `INCR`+`EXPIRE` (2 commands instead of 4, cannot be starved). **Refuse to boot in production without trusted-proxy configuration** — a rate limiter that silently degrades to one global bucket is worse than none, because it looks configured.

---

## P1-3 · Mandatory MFA is a permanent lockout — there is no enrolment flow

**`src/app/api/v1/auth/login/route.ts:97-121`**

```ts
const mfaRequired = user.mfaEnabled || settings?.mfaRequired === true;
if (mfaRequired && !body.mfaCode && !body.recoveryCode) {
  return NextResponse.json({ mfaRequired: true, challengeToken: await issueChallenge(user.id) });
}
if (mfaRequired && (body.mfaCode || body.recoveryCode)) {
  const byTotp = Boolean(body.mfaCode && user.mfaSecret && verifyTotp(...));  // user.mfaSecret is null
  if (!byTotp && !byRecovery) throw Unauthorized(GENERIC);
}
```

When an admin sets `organizationSetting.mfaRequired = true`, **every user who has not already enrolled becomes permanently unable to log in.** `mfaRequired` is true so a TOTP code is demanded; `user.mfaSecret` is null so no code can ever verify. There is no enrolment path, no first-run screen, no bypass.

Two more problems in the same block:

- **`challengeToken` is issued and never verified.** Written to Redis at `issueChallenge` (:204-209); no code path reads it. Dead code that reads like a security control.
- **`mfaSatisfied` is stored on the session (`session.ts:25, 58`) and never read.** No step-up authentication exists.

**Fix**

```ts
if (mfaRequired && !user.mfaSecret) {
  // No access/refresh token. A short-lived, single-purpose grant.
  const enrolment = await createEnrolmentSession(user.id, { ttlMinutes: 10 });
  return NextResponse.json({ mfaEnrolmentRequired: true, destination: '/enroll-2fa' });
}
```

Mark that session `purpose: 'MFA_ENROLMENT'`; have `resolveCtx`/`resolvePlatformCtx` reject it for everything except enrolment, verification and logout. Add the three required tests: protected API rejects an enrolment token; expired token rejected; reused token rejected.

---

## P1-4 · The production build fails from a clean checkout

```
$ npm run build
Error: Invalid environment configuration:
  EMAIL_PROVIDER: mock providers are forbidden in production
  SMS_PROVIDER: mock providers are forbidden in production
  ... (6 total)
> Build error occurred
Error: Failed to collect page data for /api/health
```

`next build` forces `NODE_ENV=production`, and **`src/lib/env.ts:68-82` runs runtime provider validation at module-evaluation time during build-time page-data collection.** The build cannot complete with the `.env` that ships in the repo.

This conflates two things: *"is this binary safe to run in production"* is a runtime question, not a compile-time one. Build servers legitimately have no ClamAV, no Twilio credentials, no SMTP host.

**Fix**

```ts
const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production' || isBuild) return;   // ← skip during build
  ...
});
```

Add an explicit runtime gate in `instrumentation.ts` so the *server* still refuses to start with mock providers. Confirmed the build otherwise succeeds cleanly: **12.7 s, zero warnings** (the BullMQ/valkey-glide warning is genuinely resolved by `serverExternalPackages` in `next.config.ts:41`).

---

## P1-5 · The security test suite proves nothing in its current state

```
Test Files  6 failed | 12 passed (18)
     Tests  3 failed | 129 passed | 36 skipped (168)
```

Every test that would prove tenant isolation is in the skipped 36:

| File | Tests | Status |
|---|--:|---|
| `tenant/rls.spec.ts` | 10 | **silently skipped** — `describe.skipIf(!rlsUrl)` at line 70 |
| `tenant/isolation.spec.ts` | 10 | skipped (beforeAll error) |
| `permission/scope.spec.ts` | 10 | skipped |
| `integration/session-lifecycle.spec.ts` | 5 | skipped |
| `integration/unified-saas.spec.ts` | 1 | skipped |

`rls.spec.ts` is the dangerous one. `describe.skipIf(!process.env.RLS_DATABASE_URL)` means **if the variable is unset, the entire cross-tenant proof vanishes and the run is green.** That is exactly how a pipeline reports "tenant isolation verified" while verifying nothing. Per P0-4, it is also testing a database role the application never uses.

`tenant/calls.spec.ts` "passes" 6 tests but 5 are Zod schema assertions. The one isolation test asserts `a.tenantId !== b.tenantId` — a tautology.

**Fix**

```ts
// tests/tenant/rls.spec.ts
if (!process.env.RLS_DATABASE_URL) {
  throw new Error('RLS_DATABASE_URL is required. The RLS suite must never be skipped silently.');
}
```

Fail loudly, not quietly. Same for the fixtures: a missing database should abort with a clear message, not degrade to 36 skips. Point `RLS_DATABASE_URL` at the same role `DATABASE_URL` uses once P0-4 is fixed.

---

## P1-6 · No end-to-end tests exist

`package.json` declares `"test:e2e": "playwright test"` and `@playwright/test` is installed. There is **no `playwright.config.ts` and no spec file anywhere in the repo.**

The 20-step acceptance scenario (create Manath Homes → enable both modules → create employee → create lead → assert shared workspace ID → create Leadersfort → assert isolation) is entirely unverified. `integration/unified-saas.spec.ts` contains one test, and it skips.

---

## P1-7 · Sales-only workspaces cannot administer users or roles at all

**`identity/[action]/route.ts:32,44`** and **`roles/[action]/route.ts:26,42`** both declare `productModule: 'HRMS'`. `api/handler.ts:76` then calls `assertModuleEntitlement(ctx.tenantId, 'HRMS')` before the handler runs.

A workspace on the **Sales-only plan** therefore gets 403 on: list users, view user, reset password, unlock account, deactivate user, change role, revoke sessions, remove 2FA, list roles, create role, edit permission matrix, assign role.

User and role administration is a **platform** capability, not an HR feature. A Sales-only customer with no way to add a second user cannot be sold to.

**Fix**

```diff
- await assertModuleEntitlement(ctx.tenantId, spec.productModule ?? 'SALES');
+ if (spec.productModule) await assertModuleEntitlement(ctx.tenantId, spec.productModule);
```

Remove `productModule` from both routes, then audit all 62 routes and set it deliberately on each. The `?? 'SALES'` default is itself a latent bug.

---

## P1-8 · RBAC is too coarse for an HR product

The entire HR module runs on **three permissions**: `hrms:VIEW`, `hrms:CREATE`, `hrms:EDIT`.

`services/hr/access.ts:15-18` derives everything from the scope of one of them:

```ts
export const isHrAdmin  = (ctx) => SCOPE_RANK[scopeFor(ctx, 'hrms', 'EDIT')] >= SCOPE_RANK.ORGANIZATION;
export const isApprover = (ctx) => SCOPE_RANK[scopeFor(ctx, 'hrms', 'EDIT')] >= SCOPE_RANK.TEAM;
```

Consequences:

- **`hrms:VIEW` reads the entire workspace.** `hr/[resource]` cases `departments`, `employees`, `attendance`, `shifts`, `holidays`, `work-locations`, `location-assignments` have no scoping. Only `leave` (:55) and `documents` (:59) are scoped.
- **`hrms:CREATE` can forge attendance for anyone** — `case 'attendance'` (:197-201) accepts an arbitrary `employeeId` and inserts a `PRESENT` record. Payroll fraud with no approval step.
- **No separation between "HR admin" and "may read passport scans".** `company_admin` gets ORGANIZATION on `hrms`, so `isHrAdmin` is true, so it reads every identity document. The spec explicitly required `hr_document.read_sensitive` as a distinct permission.

**Fix:** split into the granular set the spec named — `employee.read`, `employee.manage`, `attendance.approve`, `leave.approve`, `hr_document.read_sensitive` — and re-derive `isHrAdmin`/`isApprover` from those. Schema-level change (`Permission` rows + `RolePermission` backfill) needing its own migration, but the surface is small because everything funnels through `access.ts`.

---

## P1-9 · Dual password stores will drift again

`platform/workspaces/route.ts:163, 179` and `hr/[resource]/route.ts:177, 182` both write the **same hash into `User.passwordHash` and `PlatformUser.passwordHash`.**

`accounts.ts:115-119` keeps them in sync on change. `reset-password/route.ts` does not (P0-3). Nothing enforces the invariant.

Additionally, `platform/workspaces/route.ts:172-183`:

```ts
const platformUser = await tx.platformUser.upsert({
  where: { normalizedEmail: adminEmail },
  update: { fullName: body.primaryAdminName, status: 'ACTIVE' },   // ← does NOT set passwordHash
  create: { ..., passwordHash, ... },
});
```

If the platform owner provisions a workspace with an email that already exists (a consultant administering two customers), the `update` branch runs, the password is **not** set, and the admin cannot log in with the password the owner just communicated. Silent — it will be reported as "the platform is broken".

**Fix:** delete `User.passwordHash`, `User.mfaSecret`, `User.mfaRecoveryCodes`, `User.failedLoginCount`, `User.lockedUntil` in a migration. `PlatformUser` is the credential authority; `User` is a per-workspace profile + role binding. Handle the existing-user case explicitly — reuse their credential and say so, or reject the request.

---

# PART 3 — MEDIUM (P2)

| # | Finding | Location | Impact |
|---|---|---|---|
| P2-1 | Dashboard shows headcount, pending leave approvals **and the subscription/billing panel** to every user with no permission gate | `dashboard/page.tsx:31-44` | Spec said "only show information authorized for the logged-in user" |
| P2-2 | Dashboard fires 12 sequential `COUNT` queries, no caching | `dashboard/page.tsx:12-27` | Slow first paint; scales with tenant size |
| P2-3 | `assertModuleEntitlement` is an uncached DB round-trip on **every** API request | `entitlements.ts:7` | ~1 extra query/request platform-wide. Cache 60 s in Redis |
| P2-4 | Uploads fully buffered before the size check | `documents/upload/route.ts:47`, `documents.ts:65-66` | `Buffer.from(await file.arrayBuffer())` runs first — a 2 GB POST is read into memory, *then* rejected. Check `content-length` first |
| P2-5 | Telephony webhook has no rate limiting | `webhooks/telephony/route.ts:8` | Unauthenticated endpoint doing 1-2 DB lookups per hit. Add `consume(limits.webhook(integrationKey))` before the DB call |
| P2-6 | Production CSP still allows `'unsafe-inline'` for scripts, no nonce | `next.config.ts:15-17` | `'unsafe-eval'` correctly gone. Use Next 16 nonce support. Also missing `upgrade-insecure-requests` |
| P2-7 | Secret validation is `z.string().min(32)` | `env.ts:3` | A 32-byte base64 secret is 44 chars. `"aaaaaaaa…"` passes. Decode and assert `Buffer.byteLength === 32`; reject known placeholders |
| P2-8 | `throw new Error('Use POST for this action.')` returns **500** | `identity/[action]/route.ts:38`, `roles/[action]/route.ts:37` | Should be 405 |
| P2-9 | `npm audit`: 1 high — `fast-uri` host confusion | transitive | `npm audit fix` |
| P2-10 | `.env.test` is tracked in git with database credentials | `git ls-files` | Untrack; ship `.env.test.example` |
| P2-11 | Platform settings page displays **hardcoded fabricated values** | `platform/settings/page.tsx:8-13` | "Public application URL: http://localhost:3000", "Data isolation: PostgreSQL tenant policies" — the second is currently false (P0-4). Read real config or delete the page |
| P2-12 | System-health page hardcodes "Healthy" for 4 of 5 components | `platform/system-health/page.tsx` | Only Postgres is probed. Redis, S3, face service and worker are asserted healthy without a check. Actively dangerous during an incident |
| P2-13 | Global search box is decorative | `nav/TopBar.tsx:128-135` | Input with ⌘K focus, no submit handler, no results |
| P2-14 | No `loading.tsx` anywhere | `src/app/**` | No loading states. Only root `error.tsx` + `not-found.tsx`; no 403 state |
| P2-15 | HRMS entitlement failure on a People page throws instead of redirecting | `people/*/page.tsx` | `sales/layout.tsx` redirects gracefully; People pages hit the generic error boundary. Add `people/layout.tsx` mirroring the Sales one |
| P2-16 | Recovery-code login has no UI | `LoginForm.tsx` | API supports `recoveryCode` (`login/route.ts:18`); the form only offers 6 digits. Lose your phone → permanent lockout |
| P2-17 | `createSession` is dead code | `session.ts:12` | Never called. The legacy `Session` branch in `resolveCtx` (:239-280) is reachable only via test fixtures — and unlike the platform branch it does **not** check `tenant.status`, so it is a suspension bypass waiting to be re-enabled. Delete both |

---

# PART 4 — MISSING FUNCTIONALITY

## 4.1 · Password reset is unreachable from the UI

- `LoginForm.tsx:76` links to **`/forgot-password`** → **404.** No such route exists.
- `forgot-password/route.ts:53` emails a link to **`/reset-password?token=…`** → **404.** No such route exists.
- `EMAIL_PROVIDER=mock`, so nothing is sent anyway.

Even if the pages existed, P0-3 means the flow doesn't work. **Three independent failures stacked on the most-used account-recovery path.**

## 4.2 · No user invitation flow

`UserStatus.INVITED` exists in the schema and is checked in seat counts (`hr/[resource]/route.ts:161`). Nothing ever creates an invitation. The only way to add a user is for an admin to type a plaintext password into a form and communicate it out-of-band. No invite token, no acceptance page, no `mustChangePassword` flag, no expiry.

## 4.3 · No e2e tests, no lint, no format check

Covered in P1-6 and §0. Three of the ten declared quality gates do not exist.

## 4.4 · Platform Owner MFA is optional and unenforced

`PLATFORM_OWNER_MFA_SECRET` is read by the seed (`seed/index.ts:415`) and is empty in the shipped `.env`. Nothing forces the account with cross-tenant read access on every customer to use 2FA. `resolvePlatformCtx` never inspects `mfaSatisfied`.

## 4.5 · Orphaned code and artefacts

| Item | Status |
|---|---|
| `apps/hrms/` — 85 tracked files, FastAPI + SQLAlchemy + Alembic + 15 test modules | **Dead.** Nothing in `apps/web` references it. `start.ps1` does not launch it |
| `apps/hrms/master_saas_hrms.db` | SQLite file on disk (gitignored) — the "two databases" confusion previously flagged |
| `apps/hrms/pytest-cache-files-*` × 6 | Stale cache directories |
| `apps/hrms/{tunnel.bat, run.bat, reset_admin.py}` | Local-only scripts |
| `apps/Sales Lead Flow/` | Contains **only** an orphaned `node_modules` — 0 tracked files |

The HRMS *was* genuinely reimplemented natively in Next.js/Postgres — that part of the earlier brief was delivered. But leaving the Python service in the tree reproduces the confusion it was meant to end, and it is 85 files of unmaintained, unscanned attack surface if anyone deploys the `Dockerfile` sitting next to it.

**Fix:** move `apps/hrms` and `apps/Sales Lead Flow` to an `archive/` directory outside the repo (originals are preserved at `Downloads/Master App/HRMS` and `Downloads/Master App/Sales Lead Flow`), and record the decision in an ADR.

---

# PART 5 — UI/UX AND ADMIN EDIT ACCESS

## 5.1 · The finding: the administration area is read-only

**There are zero `PATCH`, `PUT` or `DELETE` handlers across the entire HR, identity and roles API surface.** Verified:

```
$ grep -rn "export const PATCH|export const PUT|export const DELETE" src/app/api/v1/workspaces/
0
```

Every HR route exports `GET` and `POST` only. `admin/[section]/page.tsx` is 12 lines rendering a static two-column table — Company profile, Roles, Modules, Subscription and Security are **display-only, with no form, no button and no input.**

## 5.2 · Admin capability matrix — what actually works today

| Capability | Create | **Edit** | Delete | UI exists? | Where |
|---|:--:|:--:|:--:|:--:|---|
| **Company Administrator** ||||||
| Company profile (name, logo, address, timezone, currency) | — | ❌ | — | ❌ read-only table | `admin/[section]:4` |
| Departments | ✅ API | ❌ | ❌ | ⚠️ no edit UI | `hr/[resource]:143` |
| Designations | ❌ | ❌ | ❌ | ❌ | model exists, no endpoint |
| Employees | ✅ API | ❌ | ❌ | ⚠️ create only | `hr/[resource]:147` |
| Reporting manager | ✅ | ✅ | ✅ | ⚠️ API only | `identity:account-manager` |
| Shifts | ✅ API | ❌ | ❌ | ⚠️ | `hr/[resource]:202` |
| Holidays | ✅ API | ❌ | ❌ | ⚠️ | `hr/[resource]:219` |
| Leave types | ❌ | ❌ | ❌ | ❌ | seeded at provisioning only |
| Work locations | ✅ API | ❌ | ❌ | ⚠️ | `hr/[resource]:231` |
| Location assignments | ✅ | revoke only | ❌ | ⚠️ | `hr/actions:225` |
| Attendance policy | — | ✅ | — | ✅ **works** | `people/settings` + `HrPolicyForm` |
| Leave approve/reject | — | ✅ | — | ✅ **works** | `hr/actions:64` |
| Users — invite | ❌ | — | — | ❌ | no invitation flow |
| Users — reset pw / unlock / activate / role / 2FA-remove | — | ✅ | — | ✅ **works** | `admin/users/[userId]` |
| Roles — create / edit / delete / permission matrix / assign | ✅ | ✅ | ✅ | ✅ **works** | `admin/roles` + `PermissionMatrix` |
| Sales pipelines / stages | ❌ | ❌ | ❌ | ❌ | seeded only |
| Integrations | ❌ | ❌ | ❌ | ❌ read-only list | `admin/integrations` |
| Security settings (MFA required, password policy) | — | ❌ | — | ❌ read-only table | `admin/[section]:8` |
| Modules / Subscription | — | ❌ | — | ❌ read-only table | `admin/[section]:6,7` |
| Audit logs | — | — | — | ✅ **works** | `admin/audit` |
| **Platform Owner** ||||||
| Create workspace | ✅ | — | — | ✅ **works** | `platform/workspaces/new` |
| Suspend / Reactivate / Archive | — | ✅ | — | ✅ **works** | `WorkspaceControls` |
| Revoke workspace sessions | — | ✅ | — | ✅ **works** | `WorkspaceControls` |
| Change plan | — | ✅ API | — | ❌ **no UI** | `PATCH:10` |
| Change enabled modules | — | ✅ API | — | ❌ **no UI** | `PATCH:15` |
| Change seat / storage limits | — | ✅ API | — | ❌ **no UI** | `PATCH:12-14` |
| Change trial dates | — | ✅ API | — | ❌ **no UI** | `PATCH:16-17` |
| Edit workspace profile (name, logo, contact) | — | ❌ | — | ❌ | not in `updateSchema` |
| Manage plans (create/edit) | — | ❌ | — | ❌ read-only | `platform/plans` |
| Manage platform users | ❌ | ❌ | ❌ | ❌ read-only | `platform/users` |

**Summary: 6 capabilities fully work. 8 have an API but no UI. 14 do not exist at either layer.**

Note the shape of the Platform-side gap: `PATCH /api/v1/platform/workspaces/[id]` already accepts `planCode`, `enabledModules`, `maxUsers`, `maxEmployees`, `maxStorageMb`, `trialStartedAt`, `trialEndsAt` — **and the UI exposes four buttons that only ever send `status` and `revokeSessions`.** The backend work is done; the form is missing.

## 5.3 · Concrete UI fixes, in priority order

### 1. Ship the Platform workspace edit form (cheapest high-value win)

The API is complete. `WorkspaceControls.tsx` needs a real form beside the existing buttons:

```tsx
// platform/workspaces/[workspaceId]/WorkspaceEditForm.tsx
<select name="planCode">…</select>
<fieldset><legend>Modules</legend>
  <label><input type="checkbox" name="modules" value="HRMS" /> HRMS</label>
  <label><input type="checkbox" name="modules" value="SALES" /> Sales CRM</label>
</fieldset>
<input type="number" name="maxEmployees" /> <input type="number" name="maxUsers" />
<input type="date" name="trialStartedAt" /> <input type="date" name="trialEndsAt" />
```

Reuse the existing `update()` fetch helper. ~80 lines. Unblocks plan changes, module toggling and limit changes for every customer.

### 2. Replace `admin/[section]` with real editors

Five screens, all currently static tables:

- **Company profile** → form + logo upload (needs `PATCH /workspaces/[slug]/company`).
- **Security** → toggles for `mfaRequired`, password policy, session TTL (needs `PATCH .../security`).
- **Modules / Subscription** → read-only is *correct* here (only the Platform Owner may change entitlements), but add a "Request a change" action and a permission-denied explanation rather than a bare table.
- **Roles** → a working editor already exists at `admin/roles`; delete the duplicate read-only `[section]` case and redirect.

### 3. Add the missing HR `PATCH`/`DELETE` verbs

```ts
export const PATCH = route({ module: 'hrms', productModule: 'HRMS', action: 'EDIT', ... }, async ({ ctx, params, body }) => {
  // departments, shifts, holidays, work-locations, employees
});
export const DELETE = route({ module: 'hrms', productModule: 'HRMS', action: 'DELETE', ... }, ...);
```

Soft-delete where the model has `deletedAt` (`Department`, `Designation`, `EmployeeProfile` are already in `SOFT_DELETE_MODELS`, `db.ts:54-62`). Gate employee edits on `isHrAdmin`. Add row-level **Edit** and **Archive** actions to the existing `WorkspaceTable` — the component and `WorkspaceRecordForm` already exist, so per-screen cost is small.

### 4. Permission-filter the sidebar's Administration section

`WorkspaceSidebar.tsx:99-110` renders all ten admin links to every user unconditionally, while the Sales items above it *are* filtered (`:95`). The layout already computes `permitted` (`layout.tsx:53`) including `users`, `roles`, `settings`, `integrations`, `auditlogs`:

```diff
- {administration.map((item) => <NavLink … />)}
+ {administration.filter(i => !i.permission || permitted.includes(i.permission)).map((item) => <NavLink … />)}
```

…plus a `permission` key on each entry. Do the same for the People section (`:38-53`), which has no filtering at all.

> **This is cosmetic only — it must be paired with P1-1, or it just hides links that still work when typed.**

### 5. Add the missing states

`loading.tsx` per route group; a `403` permission-denied page with an explanation and a "request access" action; `EmptyState` on the list screens that currently render a bare empty table. `EmptyState.tsx` already exists and is used in only one place.

### 6. Make the search box work or remove it

A prominent ⌘K input that does nothing is worse than no search.

---

# PART 6 — WHAT IS GENUINELY WELL BUILT

Worth stating plainly, because it changes the remediation strategy — **this is a repair job, not a rewrite:**

- **`api/handler.ts`** — a single kernel enforcing authenticate → rate-limit → entitlement → permission → validate → handle → audit, in that order, for all 62 routes. The right design, consistently applied.
- **Telephony webhook** (`integrations/telephony.ts:97-110`, `webhooks/telephony/route.ts`) — HMAC over `timestamp.rawBody`, 5-minute replay window, constant-time compare, hex-format pre-validation, per-tenant secret derived from a server-side pepper, idempotency via a unique `WebhookEvent`, tenant resolved from the integration record and never from the payload, mock provider hard-fails in production. **This one is done properly.**
- **`services/hr/documents.ts`** — magic-byte content sniffing, quarantine-then-scan-then-promote, ClamAV integration, random 18-byte storage keys, tenant/employee-partitioned paths, streamed download through a permission check + audit row rather than a presigned URL.
- **`services/identity/roles.ts` + `accounts.ts`** — rank-based vertical escalation guards on every mutation; `updatePermissionMatrix` refuses to grant a scope the actor doesn't hold themselves (`roles.ts:158`). Exactly right. (P0-1 exists precisely because one route skips this.)
- **`db.ts` tenant guard** — throws rather than silently injecting `tenantId`, surfacing bugs instead of hiding them.
- **Login** — uniform error body, `burnTiming()` on every failure path, account lockout, argon2id with sane parameters.
- **Audit** — `NEVER_LOG` set, per-field diffs, request-ID correlation, ~51 call sites.
- **`db.ts:157-181`** — turns an opaque Prisma `MODULE_NOT_FOUND` into an actionable message.

---

# PART 7 — REMEDIATION PLAN

### Sprint 1 — Stop the bleeding (2-3 days)

1. **P0-1** privilege escalation — add `assertMayAdministerRole` + `isHrAdmin` gate. *~10 lines.*
2. **P0-2** credential disclosure — explicit `select`, global egress scrub, regression test. *~1 day.*
3. **P0-3** password reset — write both tables. *~10 lines.*
4. **P0-6** seed guard. *~5 lines.*
5. **P1-4** unblock the build — skip provider validation during `phase-production-build`. *~3 lines.*
6. **P2-9** `npm audit fix`.

### Sprint 2 — Make the isolation real (1 week)

7. **P0-5** give `withTx` a required `tenantId`; delete `withTenantTx`. Let the compiler find the call sites.
8. **P0-4** `FORCE ROW LEVEL SECURITY`, switch `DATABASE_URL` to `master_saas_app`, add the boot assertion.
9. **P1-5** make `rls.spec.ts` fail-loud, point it at the real role, make fixture failures abort rather than skip.
10. **Exit criterion: every one of the 36 skipped tests runs and passes.**

### Sprint 3 — Access control (1 week)

11. **P1-1** make `resolveWorkspacePage` require a permission argument; fix all 28 pages.
12. **P1-2** real trusted-proxy configuration; fail closed in production.
13. **P1-7** remove the HRMS entitlement from identity/roles; audit `productModule` on all 62 routes.
14. **P1-3** MFA enrolment token + `/enroll-2fa` screen + the three required tests.
15. **P2-1** permission-gate the dashboard panels.

### Sprint 4 — Close the product gaps (1-2 weeks)

16. Password reset UI (`/forgot-password`, `/reset-password`) + a real email provider.
17. User invitation flow (token, acceptance page, `mustChangePassword`).
18. **§5.3 items 1-3** — Platform workspace edit form, admin editors, HR `PATCH`/`DELETE`.
19. **P1-8** granular HR permissions + migration.
20. **P1-9** drop `User.passwordHash` and the duplicated auth columns.

### Sprint 5 — Quality gates (1 week)

21. ESLint + Prettier configs; replace the broken `next lint`.
22. `playwright.config.ts` + the 20-step acceptance scenario as a real spec.
23. **§5.3 items 4-6** — sidebar filtering, loading/403 states, search.
24. Archive `apps/hrms` and `apps/Sales Lead Flow` out of the repo; ADR recording why.
25. Fix the fabricated system-health and platform-settings pages.

---

# BOTTOM LINE

The skeleton is sound — the API kernel, the webhook hardening, the document pipeline and the role-escalation guards are the work of someone who knew what they were doing. The failures cluster in three places:

1. **The HR module was bolted onto that skeleton without inheriting its discipline** — it skips the field serialiser, skips the escalation guard, skips granular permissions, and skips `PATCH`/`DELETE` entirely.
2. **Two defects hide each other** — RLS is inert (P0-4) *because* enabling it would break every write (P0-5).
3. **The tests that would have caught all of this skip silently** — 36 skipped assertions and a `describe.skipIf` are why this reached a "production-ready" claim.

Sprints 1 and 2 are the ones that matter. Everything after is product work.
