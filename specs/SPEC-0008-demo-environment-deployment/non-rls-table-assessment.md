# SPEC-0008 revision 3 — the seven non-RLS tables, assessed individually

| Field | Value |
|---|---|
| Specification | `SPEC-0008` revision 3 |
| Prepared | 2026-09-09, repository assessment |
| Replaces | the phrase "RLS is structurally inapplicable", which was too blunt |

**Withdrawing that phrase.** It was accurate for the `GLOBAL_MODELS` identity
tables, which carry no `tenantId` at all, and it was **wrong as a general
statement** — it implied the seven BOOTSTRAP tables share the identity tables'
situation. They do not. All seven carry `tenantId`, so a policy *could* apply to
each. Each is exempt for its own reason, and each reason deserves testing rather
than inheriting one verdict. That is what follows.

Privileges are common to all seven **[CODE]**: `master_saas_app` holds
`SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`, and is
`NOBYPASSRLS`. So for these seven the database grants full DML and applies no
policy: **the boundary is entirely application authorization**, which
`tests/tenant/demo-application-boundary.spec.ts` now measures rather than
assumes.

---

## 1. `IntegrationConnection` — the one that deserved the challenge

**Purpose and ownership.** Per-tenant vendor connections,
`@@unique([tenantId, provider])`, holding a `credentials` JSON. Owned
unambiguously by one tenant. **[CODE]**

**Why it is outside RLS — and it is not by analogy with identity tables.**
Four inbound webhook routes resolve the tenant *from* the key, with no
authenticated session and no tenant yet known **[CODE]**:

```
src/app/api/v1/webhooks/meta/[key]/route.ts:73, :157
src/app/api/v1/webhooks/telephony/[key]/route.ts:71
src/app/api/v1/webhooks/telephony/[key]/answer/route.ts:33
    prisma.integrationConnection.findUnique({ where: { webhookKey: key } })
```

`GLOBAL_UNIQUE_FIELDS` declares `IntegrationConnection: ['webhookKey']`
**[CODE]** `src/lib/db.ts`, so the application guard permits that unscoped
lookup deliberately. Under a `tenant_isolation` policy with no
`app.tenant_id` set, the lookup returns zero rows and **every inbound webhook
breaks**. This is the same genuine bootstrap shape as `PasswordResetToken` and
`APIKey`: a bearer secret is the only thing the caller holds, and the tenant is
derived from it.

**So the exemption is justified — but the blast radius is larger than the
justification requires.** The bootstrap need is *key → tenant*. The exemption
grants *unscoped read of every tenant's credentials*.

**Reachable paths** **[CODE]**: authenticated `GET/DELETE/PATCH /api/v1/integrations`
and `PUT/POST/DELETE /api/v1/integrations/[provider]`, all behind
`route({ module: 'integrations', … })`; plus the four unauthenticated webhook
routes above.

**Evidence for the current protection** **[TEST]**, `demo-application-boundary.spec.ts`:
a demo principal is refused `DELETE` and `PATCH` against customer A's
connection with row count, `status` and credential marker unchanged; no list
response contains any credential marker, including the caller's own, because
the route's `select` omits `credentials`; a session forged onto customer A as
active tenant is refused upstream in `resolveCtx`.

**Recommended control — narrow the exemption, do not remove it.**

| Option | Assessment |
|---|---|
| Leave as-is | Works, and is what the tests above measure. Cost: a single application-layer mistake exposes every tenant's vendor credentials. |
| Enable RLS with a policy allowing unscoped read when no tenant is pinned | Nearly a no-op — a policy that permits unscoped reads to satisfy the webhook path re-grants what it was meant to remove. **Rejected.** |
| **Split the table** — a small bootstrap mapping (`webhookKey → tenantId`, no secrets) outside RLS, with `credentials` in an RLS-covered table | **Recommended.** Reduces what the exemption exposes from *all credentials* to *a key-to-tenant mapping*, and the webhook path keeps working unchanged. |

**But not in the first release.** It is a schema change to a table four
unauthenticated production routes depend on, it benefits every tenant rather
than the demo, and it is not required for the demo boundary to hold — the tests
show the application refuses today. **Recommendation: record it as a follow-up
with its own specification**, and let gate 3 accept the current control on the
measured evidence. Doing it inside the demo change would be exactly the
unnecessary redesign the instruction warns against.

## 2. `WorkspaceMembership` — highest value, and correctly exempt

**Purpose and ownership.** `@@unique([tenantId, platformUserId])`; the table
deciding which tenants a login reaches. Also in `GLOBAL_MODELS` **[CODE]**.

**Why outside RLS.** It is read *before* a tenant is chosen — `resolveCtx`
queries it to discover which tenant the session may use
(`src/lib/auth/session.ts:433`), and `GET /api/v1/auth/workspaces` lists a
user's memberships across tenants by design. A `tenantId`-matching policy
would make workspace selection impossible: you cannot pin the tenant you are
still deciding.

**Evidence** **[TEST]**: demo sees only its own workspace; holds no membership
row in any customer tenant; a session naming customer A as active is refused at
`session.ts:453` with `Unauthorized`, before the database is reached.

**Recommended control: application authorization, unchanged.** RLS is not
merely awkward here, it is contradictory — the lookup exists to answer "which
tenant?", so it cannot be scoped by the answer. The control that matters is
that `resolveCtx` keys on **both** `platformUserId` and `activeTenantId`, which
it does, and which is now a test.

## 3. `PasswordResetToken`

**Purpose.** Single-use reset tokens; `GLOBAL_UNIQUE_FIELDS: ['tokenHash']`.
**Why exempt:** redeemed by someone not signed in; the tenant is resolved from
the token. **[CODE]** — the migration's own bootstrap list gives this reason,
and `db.ts` records that without the exemption the endpoint answered 500
unconditionally.

**Reachable by demo:** the global account flow, same as any user.
**Recommended control: application authorization plus token properties** —
single-use, hashed at rest, expiring. Enumeration resistance comes from the
token being a 256-bit secret, not from a policy. **Unchanged.**

## 4. `APIKey`

**Purpose.** Hashed bearer credentials; `GLOBAL_UNIQUE_FIELDS: ['prefix', 'keyHash']`.
**Why exempt:** the tenant is resolved from the presented key.
**Demo relevance:** a demo tenant should hold no API key. **Recommended
control: application authorization, plus provisioning that issues none** —
and, if API access is not part of the demonstration, an explicit demo policy
denying key creation. Cheap, and it removes the surface rather than guarding it.

## 5. `WorkspaceInvitation`

**Purpose.** Pending invitations; `GLOBAL_UNIQUE_FIELDS: ['tokenHash']`; moved
into the bootstrap set by `20260807020000` **[CODE]**.
**Why exempt:** redeemed before the invitee has a tenant.
**Demo relevance: material.** A readable or forgeable invitation is a
membership, and membership is the whole boundary. **Recommended control:
application authorization plus a demo policy denying invitation creation** —
the first release grants the demo tenant no ability to invite, so the surface is
not reachable from the demo side at all.

## 6. `PlatformAuditEvent`

**Purpose.** Cross-tenant audit trail; also in `GLOBAL_MODELS`.
**Why exempt:** cross-tenant by design; a policy would defeat its purpose.
**Demo relevance:** a read would expose customer activity metadata.
**Recommended control: `requirePlatformOwner`, unchanged** — the demo principal
is `platformRole USER` and is refused the control plane **[TEST]**. Writes are
appends the application makes on the actor's behalf, not user-controlled.

## 7. `RateLimitCounter`

**Purpose.** Counters. No customer data.
**Why exempt:** bootstrap; consulted before identity is established.
**Demo relevance: availability, not confidentiality** — the concern is a demo
user consuming a bucket shared with customers, which is `AC-D11` (resource
limits) rather than a tenancy question. **Recommended control: demo-scoped
limits**, which the first release already requires.

---

## Summary

| Table | Exemption justified? | Recommended control | Change in this release? |
|---|---|---|---|
| `IntegrationConnection` | **yes** — webhook bootstrap, verified | application authz now; **split the table** as a follow-up | no |
| `WorkspaceMembership` | **yes** — contradictory to scope | application authz, unchanged | no |
| `PasswordResetToken` | yes — token bootstrap | application authz + token properties | no |
| `APIKey` | yes — key bootstrap | application authz + issue none to demo | **deny key creation for demo** |
| `WorkspaceInvitation` | yes — pre-tenant redemption | application authz + deny demo invitations | **deny invitation creation for demo** |
| `PlatformAuditEvent` | yes — cross-tenant by design | `requirePlatformOwner`, unchanged | no |
| `RateLimitCounter` | yes — pre-identity | demo-scoped limits | **yes, via `AC-D11`** |

**Two of the seven produce first-release work**, and both are demo policy rather
than schema: deny the demo tenant the ability to create API keys or invitations.
Neither is a redesign. **One produces a follow-up** — splitting
`IntegrationConnection` — which is a genuine improvement for every tenant and
deliberately **not** bundled into the demo change.

**No table is recommended for RLS in this release.** Each exemption survived
being examined on its own terms; the answer is the same for all seven, but it is
now seven answers rather than one assumption.
