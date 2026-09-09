# Demo-as-tenant — Phase 1 feasibility assessment

| Field | Value |
|---|---|
| Prepared | 2026-09-09, repository assessment only |
| Base | `origin/dev/yourhan-next` `98fa066`; worktree `ebfa56c` |
| Production inspected | **no** — this is a repository assessment |
| Verdict | **Feasible after specified changes** |

Evidence classes are marked throughout: **[CODE]** verified in the repository,
**[TEST]** proven by a test that has been run, **[DOC]** a documented claim not
independently verified here, **[INFER]** reasoning from the above, **[UNKNOWN]**
requires runtime or infrastructure verification.

---

## 1. The question that decides it

Sharing one server does **not** require sharing tables in the sense that
matters. Isolation here is enforced by PostgreSQL, not by application code.

**[CODE]** `prisma/migrations/*` install, per tenant-owned table:

```sql
ALTER TABLE %I ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON %I FOR ALL TO master_saas_app
  USING ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));
```

**[CODE]** `20260806000000_rls_force_and_platform_admin` adds `FORCE ROW LEVEL
SECURITY`, so the owning role does not bypass its own policies.

**[CODE]** `apps/web/src/lib/db.ts:387` pins the context per transaction:
`SELECT set_config('app.tenant_id', ${tenantId}, true)` — the `true` makes it
transaction-local, so it cannot leak across pooled connections
(`apps/web/src/lib/db.ts:625`).

**[CODE]** `apps/web/scripts/check-rls.mjs` is a CI gate asserting every
`tenantId`-carrying table still has its policy, its RLS flag **and** its FORCE
flag, checked against the live catalog rather than against a list. Its header
records why: a migration pasting an older copy of the sweep silently downgraded
security across every table at once, and was caught only by two unrelated suites
failing together.

**[CODE]** A second, independent application-level guard sits above it
(`apps/web/src/lib/db.ts:420-434`): any read or filtered write that names
neither `tenantId` nor a declared globally-unique field is refused and counted,
so a repository relying on RLS alone is visible rather than silent.

**[INFER]** This is defence in depth of the shape the proposal needs: a demo
tenant's rows are separated from customer rows by the database, and an
application bug that forgets a tenant filter fails closed twice.

## 2. The identity model already supports this

**[CODE]** Three models carry it:

| Model | Shape | Location |
|---|---|---|
| `PlatformUser` | global identity, `email @unique`, `platformRole` | `prisma/schema.prisma:~1050` |
| `WorkspaceMembership` | `@@unique([tenantId, platformUserId])`, `salesUserId` → tenant `User` | `prisma/schema.prisma:1211` |
| `User` | tenant-scoped, **`@@unique([tenantId, email])`** | `prisma/schema.prisma:964` |

**[CODE]** Email is unique **per tenant**, not globally, and the global identity
is `PlatformUser.email`. So `demo@youhan.in` is one `PlatformUser` with exactly
one membership; it collides with no customer.

**[CODE]** `PlatformRole` is `USER | OWNER | SUPPORT | SECURITY_AUDITOR |
AI_SERVICE`. The control plane is gated by `requirePlatformOwner`
(`apps/web/src/lib/auth/platform.ts:5`), and the `app.platform_admin` bypass is
set only inside that path (`apps/web/src/lib/db.ts:658`).

**[TEST]** This is not theoretical. `SPEC-0007` already runs a demonstration
tenant **beside another tenant in one database** — `youhan-one-demo` and
`leadersfort` — and asserts the boundary at the route handler:

- `ST-005` cross-tenant refusal; `ST-009` platform control plane refused to the
  demo login; `ST-003`/`ST-003b` role scoping both directions.
- Serial run of `tests/security`, `tests/tenant`, `tests/permission`,
  `tests/auth`: **854 tests, 0 failures** (`VER-0009`).

**[INFER]** The data-isolation half of this proposal is already built, already
gated in CI, and already tested in the exact two-tenants-one-database
configuration the proposal asks for.

## 3. What does **not** exist — the real work

### 3.1 Side-effect safety is environment-wide, not tenant-scoped — **the blocker**

**[CODE]** `apps/web/src/lib/mailer.ts:48-61` selects the provider from a single
environment variable:

```ts
if (env.EMAIL_PROVIDER === 'mock') { … logger.info('email captured (not sent)') }
if (env.EMAIL_PROVIDER === 'smtp') { await smtpTransport().sendMail(…) }
```

**[CODE]** `apps/web/src/lib/mailer.ts:9` records that **production refuses to
boot with `mock`** (`lib/startup-check.ts`).

**[CODE]** A grep for `APP_ENV` across `apps/web/src/lib/` and
`apps/web/src/services/`, excluding `env.ts` and `startup-check.ts`, returns
**nothing**. There is no environment-conditional or tenant-conditional behaviour
anywhere in the application.

**[INFER]** Today, demo safety is produced entirely by *running a separate
deployment with different environment variables*. Put the demo tenant inside
production and it inherits production's providers: **a demo user exercising
password reset, an invitation, or any notification would send real email.**
This is the single largest gap and the main reason the verdict is not "feasible
as-is".

### 3.2 There is no demo tenant classification

**[CODE]** `Tenant` (`prisma/schema.prisma:356`) carries `id`, `slug @unique`,
`status` (default `ACTIVE`), `planCode` (default `standard`). There is no
`isDemo`, no tenant kind, no policy column.

**[INFER]** The proposal's requirement — "an explicit, protected tenant
classification … never an email string, URL hostname, client flag or hidden UI
control" — has nothing to bind to yet. This is an additive migration plus a
server-side policy lookup.

### 3.3 Provisioning cannot use the existing seed

**[CODE]** `apps/web/prisma/seed/index.ts:54-69` refuses on four independent
gates: `NODE_ENV=production`, `APP_ENV` in `production`/`staging`, a database
name matching `/[_-](prod|production|staging|stage)\d*$/i`, and absent
`ALLOW_DEMO_SEED=yes`.

**[INFER]** Against production all four bite, and **they should**. The seed is
built for a disposable database and reachable only from one. Provisioning a demo
tenant inside production needs a *different*, narrower, tenant-scoped operation —
not a relaxation of these guards. Weakening them would remove the control that
currently makes it impossible to seed a customer database by accident.

### 3.4 The reset is environment-shaped

**[CODE]** `removeSeededTenant(slug, label)` in `apps/web/prisma/seed/index.ts:486`
deletes a tenant and its children by slug, and `--reset` applies it to **every**
seeded workspace (`CONV-011`).

**[INFER]** As written this must never exist in production. A tenant-scoped
reset is possible but is its own design problem — cascades, files, caches,
queued jobs, concurrent writes — and the proposal's own instruction to disable
it for the initial release if safety cannot be established is the right default.

### 3.5 Seven tables sit outside RLS, and two matter here

**[CODE]** `apps/web/scripts/check-rls.mjs:55-68` — `APIKey`,
**`IntegrationConnection`**, `PasswordResetToken`, `RateLimitCounter`,
`WorkspaceInvitation`, **`WorkspaceMembership`**, `PlatformAuditEvent`.

Each is a deliberate bootstrap case, documented, with a stale-entry check that
fails if a name stops naming a real model. Two are directly relevant:

- **`WorkspaceMembership`** decides which tenants a login can reach. It is
  protected by the application guard and `@@unique([tenantId, platformUserId])`,
  **not** by RLS.
- **`IntegrationConnection`** holds per-tenant `credentials` JSON
  (`@@unique([tenantId, provider])`), also outside RLS.

**[INFER]** For a demo tenant inside production these two are the highest-value
targets: the first would grant a customer workspace, the second would read
customer vendor credentials. Neither is a defect today — both are guarded — but
both move from "internal boundary" to "boundary with an untrusted public user on
the other side", and that changes how much assurance they need.

**[CODE]** Mitigating, on integrations specifically: they are per-tenant rows,
so a demo tenant with no connected integration has nothing to send with. That is
useful but it is a *data* property, not a *control* — it holds until someone
connects one.

## 4. Reusable versus not

| Component | Reuse? | Evidence |
|---|---|---|
| RLS + `set_config` tenant pinning | **yes, as-is** | **[CODE]** `db.ts:387`, migrations |
| Application tenant guard | **yes, as-is** | **[CODE]** `db.ts:420-434` |
| `PlatformUser`/`WorkspaceMembership`/`User` | **yes, as-is** | **[CODE]** schema |
| `requirePlatformOwner` control-plane gate | **yes, as-is** | **[CODE]** `auth/platform.ts:5` |
| Persona/isolation test suite | **yes**, extend with a third fixture | **[TEST]** `VER-0009`, 854 passing |
| Synthetic Sales/HRMS dataset shape | **yes**, content reusable | **[CODE]** `prisma/seed/crm.ts`, `hr.ts` |
| Demo seed **entry point** | **no** — assumes a disposable database | **[CODE]** four gates |
| Demo **reset** | **no** — environment-wide | **[CODE]** `--reset` |
| `EMAIL_PROVIDER=mock` safety | **no** — environment-wide | **[CODE]** `mailer.ts:48` |
| `APP_ENV=demo` marker | **no** — one deployment is `production` | **[CODE]** `startup-check.ts` |

## 5. UNKNOWN — requires runtime or infrastructure verification

- Production's actual RLS state, and whether its application role really is
  `NOBYPASSRLS`. **[UNKNOWN]** The repository says what migrations *install*.
- Production's `EMAIL_PROVIDER` and which integrations are connected.
  **[UNKNOWN]**
- Whether `89.167.94.197` is currently customer production. **[UNKNOWN]** —
  `EVC-024`, still open and **not closed by this proposal**.
- Production headroom for demo load on shared Postgres, Redis and the worker.
  **[UNKNOWN]**
- Whether any customer tenant already uses the slug `youhan-one-demo` or the
  address `demo@youhan.in`. **[UNKNOWN]**

## 6. Verdict

**Feasible after specified changes.**

The hard part — isolating *data* between a demo tenant and customer tenants on
one deployment — is already built, CI-gated, and tested in the two-tenant
configuration this proposal needs. What is missing is isolating *side effects*,
which the application currently does per deployment rather than per tenant.

The required changes, smallest first:

1. **Tenant classification.** Additive column plus a server-side policy lookup.
2. **Tenant-scoped outbound gating.** Route every consequential effect —
   starting with `sendMail` — through a policy check keyed on the tenant, not on
   `APP_ENV`. Must hold in workers, where there is no request.
3. **A narrow provisioning operation**, separate from the seed, idempotent,
   refusing to touch a tenant not classified demo.
4. **Reset: disabled for the initial release**, unless a tenant-scoped design
   can be shown safe against cascades, files, caches and concurrent writes.
5. **Demo resource limits** and an operator switch to disable demo access
   without touching customer access.
6. **Extend the isolation suite to three fixtures** — customer A, customer B,
   demo — and add negative cases against `WorkspaceMembership` and
   `IntegrationConnection` specifically, since those two are outside RLS.

**This changes production.** The application, its configuration and its database
would all be modified, and a public login would be added to the deployment
serving customers. Any claim of "production untouched" is false from the moment
this ships; what can honestly be claimed is a specific set of boundaries, each
with evidence.

**`EVC-024` is not closed by this proposal.** The infrastructure finding stands
on its own, and the `demo.youhan.in` A record still points at a host the
repository associates with production.
