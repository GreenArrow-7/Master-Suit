# SPEC-0008 revision 3 — demo as a tenant inside the production deployment

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Revision | 3 — **replaces the architecture of revisions 1 and 2** |
| Risk | `R5` proposed (production application, database migration, public login) |
| Status | packet prepared; **no approval recorded for this revision** |
| Prepared | 2026-09-09 |

**Previous approvals are historical and are NOT transferred.** Revision 2's gate
1 and gate 2 approved *a dedicated demo VM with its own database*. This revision
proposes something materially different — one deployment, one database, a demo
tenant beside customer tenants. Those approvals do not describe this and are
preserved as the record of what was approved then.

**`EVC-024` remains open.** It is an infrastructure finding about
`89.167.94.197` and `demo.youhan.in`; changing the proposed architecture does not
resolve it, and this revision does not touch DNS or Caddy.

---

## 1. Architecture and first-release scope

One deployed application. Customer tenants and one synthetic demo tenant share
the deployment, the database instance and the worker. Separation is by tenant
row, enforced at two layers, with a third layer of tenant-scoped **policy**
governing consequential side effects.

**First release — in scope**

- Sales and HRMS through the **existing** business logic. No fork, no duplicate
  paths.
- `demo@youhan.in` → one `PlatformUser`, `platformRole USER`, exactly one
  `WorkspaceMembership` to the demo tenant.
- A protected, server-controlled tenant classification.
- Tenant-scoped suppression of consequential outbound actions.
- Idempotent, conflict-refusing provisioning.
- Demo resource limits and an operator disable control.
- Entry at the **existing application login URL**. `demo.youhan.in` is
  explicitly out of scope — a subdomain establishes no isolation.

**First release — out of scope**

- **Reset: disabled.** Not merely unimplemented — actively unreachable for the
  demo account, including existing endpoints and jobs.
- Platform administration and customer membership for demo identities.
- Any change to production environment variables, DNS, Caddy or customer
  integration behaviour.

## 2. Verified reusable controls

| Control | Evidence | Reuse |
|---|---|---|
| RLS policy + `FORCE` per tenant table | **[CODE]** migrations; `check-rls.mjs` CI gate | as-is |
| Transaction-local `set_config('app.tenant_id', …, true)` | **[CODE]** `db.ts:387`, `db.ts:625` | as-is |
| Application tenant guard, refuse-and-count | **[CODE]** `db.ts:420-434` | as-is |
| `PlatformUser` / `WorkspaceMembership` / `User` | **[CODE]** schema | as-is |
| `requirePlatformOwner` + `app.platform_admin` | **[CODE]** `auth/platform.ts:5`, `db.ts:658` | as-is |
| Two-tenant isolation suite | **[TEST]** 854 passing, `VER-0009` | extend to three fixtures |
| Synthetic Sales/HRMS dataset | **[CODE]** `prisma/seed/crm.ts`, `hr.ts` | content only |

## 3. Database and identity — design checks

### 3.1 Roles and connection paths **[CODE]**

| Path | Variable | Role | Bypass |
|---|---|---|---|
| Application + worker | `DATABASE_URL` | `master_saas_app` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT **NOBYPASSRLS** LOGIN` (`20260806000000:25`) |
| Migrations | `MIGRATION_DATABASE_URL` | table owner | owner — bypasses RLS **unless** `FORCE`, which `20260806000000` adds |
| RLS test connection | `RLS_DATABASE_URL` | must name the same connection as `DATABASE_URL` | `tests/tenant/rls.spec.ts` throws rather than skips if not |

`20260806000000:29` carries a "belt and braces" `ALTER ROLE` for a role
predating the `NOBYPASSRLS` intent. **[UNKNOWN]** the effective attributes in
production.

### 3.2 Bypass surfaces

- **`SECURITY DEFINER`: none.** **[CODE]** grep across `prisma/migrations/`
  returns no match. This is a meaningful negative — a definer function is the
  classic silent RLS hole.
- **`app.platform_admin`** — deliberate, set only inside `requirePlatformOwner`
  (`db.ts:658`). Demo identities are `platformRole USER`, so unreachable; that
  must be a **test**, not an assumption.
- **The migration role** owns the tables. `FORCE` is the only thing preventing
  owner bypass; if a future migration drops it, `check-rls.mjs` fails. **[CODE]**
- **Unscoped clients** — one to verify: `workers/notifications.ts:61`
  `prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })` names no
  tenant. Either `DeviceToken` is a global model, or this trips the guard.
  **[UNKNOWN]** — must be resolved before release, as it is a **worker** write.

### 3.3 Policy coverage and context behaviour

- Read **and** write: the policy carries both `USING` and `WITH CHECK`. **[CODE]**
- Missing context: `nullif(current_setting('app.tenant_id', true), '')` yields
  `NULL`, and `"tenantId" = NULL` is never true — **fails closed to zero rows**.
  **[CODE]**, and must be proven by test against the restricted role.
- Pooled reuse: `set_config(..., true)` is transaction-local. **[CODE]** `db.ts:625`
  states this explicitly. Test required, not inferred.

### 3.4 How membership authorises the tenant **before** context is set

This is the ordering that matters, and it is the layer RLS cannot protect:
the policy constrains rows **once a tenant is chosen**; choosing the wrong tenant
is an application flaw the database will faithfully honour.

**[CODE]** `login/route.ts` resolves `PlatformUser` by address, then loads
memberships, then hydrates each membership's tenant `User` **passing `tenantId`
explicitly** — the route's own comment records that `User` is RLS-forced and can
only be read once a tenant is named. Workspace selection must therefore be
proven to accept only tenants for which a `WorkspaceMembership` row exists for
the authenticated `PlatformUser`, server-side, per request.

### 3.5 The seven non-RLS tables — full inventory

| Table | Sensitivity | Authorization path | Demo priority |
|---|---|---|---|
| **`WorkspaceMembership`** | **decides which tenants a login reaches** | app guard + `@@unique([tenantId, platformUserId])` | **highest** — a forged row grants a customer workspace |
| **`IntegrationConnection`** | **per-tenant vendor `credentials` JSON** | app guard + `@@unique([tenantId, provider])` | **highest** — cross-tenant read exposes customer credentials |
| `APIKey` | hashed bearer secrets | tenant resolved *from* the secret | high — enumeration must be infeasible |
| `PasswordResetToken` | single-use reset tokens | tenant resolved from `tokenHash` | high — account takeover if readable |
| `WorkspaceInvitation` | pending invitations | tenant resolved from token | medium — a readable invitation is a membership |
| `PlatformAuditEvent` | cross-tenant audit trail | control plane, `requirePlatformOwner` | medium — read exposes customer activity |
| `RateLimitCounter` | counters | bootstrap | low — no customer data; DoS relevance only |

Each is a documented bootstrap case with a stale-entry check. **The point is not
that they are wrong; it is that for these seven the demo tenant's boundary is
application authorization alone**, and the far side of that boundary becomes a
public login. Every one needs an explicit negative test.

## 4. Demo policy design

### 4.1 Classification — protected and server-controlled

Additive: `Tenant.kind` (`CUSTOMER` default, `DEMO`) **or** an equivalent
existing mechanism. Requirements:

- Default `CUSTOMER`, so every existing row keeps today's behaviour with no
  backfill. **Additive and non-breaking.**
- Writable **only** through the control plane behind `requirePlatformOwner`.
- **Never** derived from an email string, hostname, client flag or hidden UI
  control — the proposal's requirement and the correct one.
- A demo member must not be able to change it, nor the restrictions it implies.

### 4.2 Consequential-action policy, enforced at execution

A single server-side resolver — `demoPolicyFor(tenantId)` — consulted **at the
point the effect happens**, not at the route boundary, so workers and retries
are covered by the same rule.

**Rejects rather than proceeds** when tenant context or policy cannot be
established. A job whose `tenantId` no longer resolves must fail, not fall back.

### 4.3 Outbound inventory **[CODE]**, and what each does

| Surface | Site | Demo-reachable | First-release rule |
|---|---|---|---|
| `sendMail` — call follow-up | `api/v1/calls/[id]/follow-up-email/route.ts:151` | **yes**, Sales action | **suppress**, record intent |
| `sendMail` — HR notifications | `workers/notifications.ts:108` | **yes**, worker | **suppress**, record intent |
| `sendMail` — password recovery | `api/v1/auth/forgot-password/route.ts:86` | account flow | **preserve** — global, must keep working for customers |
| `sendMail` — invitations | `services/identity/invitations.ts:395` | account flow | **preserve** globally; demo tenant may not invite |
| Integrations: calendar, telephony, WhatsApp, Meta, transcription | `src/lib/integrations/**` | only if connected | **suppress** for demo tenants; per-tenant `IntegrationConnection` means a demo tenant has none — a data property, so the control is still required |
| Push / device tokens | `workers/notifications.ts` | **yes** | suppress |

**Global flows are preserved by explicit rule, not blanket-blocked.** Customer
authentication and notifications must be untouched — the suppression is keyed on
the tenant of the *effect*, never on the deployment.

**Production environment settings stay unchanged.** `EMAIL_PROVIDER` remains
`smtp`; nothing switches to `mock`.

## 5. Proposed changes

| File | Change | Risk |
|---|---|---|
| `apps/web/prisma/schema.prisma` + new migration | additive `Tenant.kind`, default `CUSTOMER` | R4 (schema, security-bearing) |
| `apps/web/src/lib/tenant/demo-policy.ts` *(new)* | `demoPolicyFor(tenantId)`; fail-closed | R4 |
| `apps/web/src/lib/mailer.ts` | tenant-aware suppression at `sendMail` | R4 |
| `apps/web/src/workers/notifications.ts` | policy check at execution | R4 |
| `apps/web/src/lib/integrations/registry.ts` | policy check before any vendor call | R4 |
| `apps/web/src/services/…/provision-demo.ts` *(new)* | idempotent, conflict-refusing | R4 |
| `apps/web/src/lib/auth/*` | demo identities cannot gain membership or platform role | R4 |
| `apps/web/tests/tenant/*`, `tests/security/*` | three-fixture isolation suite | R2 |
| Rate limiting / quotas | demo-scoped limits | R3 |

No change to `.github/workflows/*`, `apps/web/infra/*`, DNS or Caddy.

## 6. Security acceptance criteria

- `AC-D1` A demo session cannot read, write, delete, export or search any row of
  customer tenant A or B — by changed record id, changed tenant selector, or
  direct API call.
- `AC-D2` A demo session cannot create, modify or delete any
  `WorkspaceMembership`, and cannot reach any tenant it has no membership for.
- `AC-D3` A demo session cannot read any `IntegrationConnection` row of another
  tenant, and cannot read credentials of its own beyond what the product
  normally exposes.
- `AC-D4` A demo session is refused the platform control plane, and
  `app.platform_admin` is never set on its behalf.
- `AC-D5` No consequential outbound action executes for demo activity — request
  path **and** worker path, including retries.
- `AC-D6` Customer integrations and customer mail continue to work unchanged,
  proven **positively**, not by absence of failure.
- `AC-D7` Provisioning is idempotent; a second run creates no duplicate tenant,
  membership, user, employee number or email; it refuses a slug or address held
  by a non-demo tenant.
- `AC-D8` Reset is unreachable for the demo account through every existing
  endpoint and job.
- `AC-D9` Missing or forged tenant context yields zero rows against the
  **restricted role**, not an error-shaped success.
- `AC-D10` Operator disable stops new demo sessions, terminates active ones and
  drains or cancels queued demo side effects, per a documented revocation policy.
- `AC-D11` Demo resource limits apply and do not degrade customer service.

## 7. Tests — and which layer each proves

**Fixtures:** customer A, customer B, demo. Synthetic throughout; **no real
customer data**.

| Test | Proves | Layer |
|---|---|---|
| `ST-D1` cross-tenant read/write/delete/export via forged ids | `AC-D1` | **real PostgreSQL policy**, restricted role |
| `ST-D2` missing / forged `app.tenant_id` | `AC-D9` | **real policy** |
| `ST-D3` pooled-connection reuse across transactions | context does not leak | **real policy** |
| `ST-D4` membership forge / workspace switch | `AC-D2` | **application authorization** — `WorkspaceMembership` is outside RLS |
| `ST-D5` cross-tenant `IntegrationConnection` read | `AC-D3` | **application authorization** — outside RLS |
| `ST-D6` platform control plane denial | `AC-D4` | application |
| `ST-D7` demo outbound suppression, request path | `AC-D5` | application policy |
| `ST-D8` demo outbound suppression, **worker + retry** | `AC-D5` | application policy at execution |
| `ST-D9` customer mail and integrations still fire | `AC-D6` | **positive** control |
| `ST-D10` provisioning idempotence and conflict refusal | `AC-D7` | application |
| `ST-D11` reset unreachable | `AC-D8` | application |
| `ST-D12` operator disable, incl. queued work | `AC-D10` | application |
| `ST-D13` demo limits | `AC-D11` | application |

**Isolation tests must run as `master_saas_app`, not the owner** — a test using
the migration role proves nothing about RLS. `ST-D1`–`ST-D3` are the only ones
exercising actual PostgreSQL policies; the rest test application behaviour, and
saying so is the point.

## 8. Migration, rollout, disable, rollback

**Migration** — additive only: one nullable-with-default column. No customer row
changes value; no behaviour changes for `CUSTOMER`.

**Version compatibility during rollout and rollback.** Old application code does
not know `Tenant.kind` and therefore does not enforce demo policy. The dangerous
window is not the upgrade — it is the **downgrade**:

> **A rollback to a build without demo restrictions, while an accessible demo
> tenant exists, removes every suppression while leaving the demo login live.**

Rollback procedure, ordered, and the order is the control:

1. **Disable demo access first** (`AC-D10`) — new sessions refused, active ones
   terminated.
2. **Drain or cancel queued demo side effects.** Jobs enqueued under the new
   code will execute under the old code, which will not suppress them.
3. Verify no demo work remains in flight.
4. Then roll the application back. The additive column stays; old code ignores it.

**Never roll back before step 3.** This is the one place where an image rollback
alone is insufficient, exactly as the instruction anticipated.

**Disable control** is therefore both an operational tool and a rollback
prerequisite, and must exist before first release.

## 9. Approvals required for this revision

| Gate | Role | Status |
|---|---|---|
| 1 Specification | Product Owner **and** Solution Architect | **not recorded** |
| 2 Architecture | Solution Architect | **not recorded** — revision 2's approval was for a dedicated VM and does not carry |
| 3 Security | Application Security | **not recorded** — the material change: a public login joins the customer deployment |
| 4 Data / migration | per `HUMAN_APPROVAL_GATES.md` | **not recorded** — additive column |
| 5 Implementation readiness | Solution Architect | **not recorded** |
| 7 Release | Human Release Authority | **not recorded** |

No approval from revisions 1 or 2 is transferred. None is fabricated here.

## 10. Executable now versus gated

**Executable immediately** — no production impact, no gate:

- The three-fixture test harness and every negative case, against local
  disposable databases using the restricted role.
- Resolving the `workers/notifications.ts:61` unscoped `deleteMany` question.
- Drafting `demoPolicyFor` and the outbound call-site inventory as code review
  material.

**Blocked by gate 1 + 2** — the architecture is not approved: schema change,
policy module, any `src/` edit.

**Blocked by gate 5** — implementation of the above in the candidate branch.

**Blocked by gate 7 + runtime evidence** — production migration, provisioning,
smoke tests. Required runtime facts, none obtainable from the repository:
production `EMAIL_PROVIDER`; effective RLS and role attributes; whether
`demo@youhan.in` or `youhan-one-demo` already exist; shared-resource headroom;
backup and restore evidence.

## 11. Honest statement of production impact

This proposal **changes production**. The application, its database schema and
its configuration all change, and a public demonstration login joins the
deployment that serves customers. No claim of "production untouched" will be
made for it.

What can be claimed, and demonstrated: two enforcement layers separating demo
rows from customer rows, seven named tables where only one of those layers
applies and each with an explicit negative test, a tenant-scoped policy stopping
consequential effects at the point they execute, and an ordered disable-then-
rollback procedure that cannot leave a live demo running on code that does not
restrict it.
