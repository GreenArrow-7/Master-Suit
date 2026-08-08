# Application Attack Surface

**Date:** 2026-08-08 · **Target:** `apps/web` (Next.js 16, Prisma 7, PostgreSQL, Redis, MinIO) + `apps/face`

Route authorization below was **extracted from source**, not transcribed — each entry is the
`module`/`action` the route actually declares to the API kernel.

## Architecture

```
Browser ─┬─ Next server components  ──┐
         └─ /api/v1/* route handlers ─┤
                                      ├─ route() kernel: authn → rate limit → authz → validate → handle → audit → scrub
                                      │
                            services/* (business rules, record-level authorization)
                                      │
                    Prisma client + tenant-guard extension  (layer 2)
                                      │
                    PostgreSQL with FORCE ROW LEVEL SECURITY (layer 3)
```

**Trust boundaries:** Browser→API · API→Postgres (RLS) · API→Redis · API→MinIO ·
API→`apps/face` (biometric engine) · API→SMTP/telephony/AV · Worker(BullMQ)→API services ·
Platform control plane→tenant workspaces.

## Identity and authorization model

| Concept | Where | Note |
|---|---|---|
| Session | `PlatformSession` row, SHA-256 token hash in `lf_session` cookie | httpOnly, `secure` in production, `sameSite=lax`. No JWT anywhere — nothing to forge offline |
| Session purpose | `FULL` \| `MFA_ENROLMENT` | Enrolment grant reaches `/enroll-2fa` and nothing else |
| Actor | `buildActor()` → role + permission map + branch/region/teams/managed users | Rebuilt per request from the database; never read from the client |
| Permission | `module:ACTION` → `Scope` | `NONE < OWN < TEAM < BRANCH < REGION < ORGANIZATION` |
| Tenant | `ctx.tenantId` | Enforced in repositories, guard extension, and RLS |
| Platform staff | `OWNER`/`SUPPORT`/`SECURITY_AUDITOR` | MFA mandatory; get a read-only support actor inside a workspace |

**Sensitive assets:** passwords (argon2), TOTP secrets (encrypted), recovery codes (hashed),
face templates, attendance captures, identity documents (passport/visa/Emirates ID/labour
card), salary and compensation, IBAN/bank details, payslips, WPS files, audit log.

## Route inventory — 73 route files

### Anonymous / pre-authentication (kernel-bypassing by necessity)

| Route | Gate | Status |
|---|---|---|
| `POST /v1/auth/login` | Own rate limit (per-IP + per-account), uniform failure responses, `burnTiming()` | PASS |
| `POST /v1/auth/forgot-password`, `/reset-password` | Own rate limits; single-use hashed token | PASS |
| `POST /v1/auth/accept-invite` | Hashed invitation token; bootstrap lookup exempt from RLS by design | PASS |
| `POST /v1/auth/refresh`, `/logout`, `/logout-all` | Session row revocation | PASS |
| `GET /v1/auth/workspaces` | Session-scoped | PASS |
| `POST /v1/webhooks/telephony/*` | HMAC signature + per-integration-key rate limit | PASS |
| `GET /health` | Liveness only, no data | PASS |
| `/v1/dev/outbox` | Dev-only mail outbox | Verify it is unreachable in production builds |

### HRMS — `productModule: HRMS`

| Route | Declared | Record-level rules |
|---|---|---|
| `GET /v1/workspaces/{slug}/hr/{resource}` | `employee:VIEW/CREATE/EDIT/DELETE` | Per-resource scoping in services |
| `POST /v1/workspaces/{slug}/hr/actions/{action}` | `employee:VIEW` floor + per-action `ACTION_PERMISSION` map | 29 verbs; finer rules in service layer |
| `POST /v1/workspaces/{slug}/hr/documents/upload` | `isHrAdmin` | Quarantine-first, magic-byte sniff, generated key |
| `GET  .../hr/documents/{id}/download` | `mayReadSensitiveDocuments` or owner | CLEAN-scan gate, checksum, audited |
| `GET  .../hr/payroll/{runId}/wps` | `payroll:EXPORT` @ORGANIZATION | Approved runs only; audited; **no rate limit** (I-03) |

The `actions/{action}` dispatcher is the single largest HR surface. Its kernel gate is only a
floor; the authority each verb needs is asserted per-verb and then again on the record inside
the service. **This is where F-01 was found** — the per-verb permission was asserted, but the
service did not check the record against the actor's scope.

### Sales — `productModule: SALES`

Leads, accounts, contacts, opportunities, activities, tasks, calls, campaigns, events,
targets, scorecards, follow-ups. All declare `module:ACTION` through the kernel and resolve
row visibility via `visibilityWhere` / `assertRecordVisible`. `leads/export` bypasses the
kernel (streamed CSV) but re-checks permission, applies field-level masking, and neutralises
spreadsheet formulas.

### Platform control plane

`/v1/platform/*` gate on `requirePlatformOwner` rather than the tenant kernel, and write
through `withPlatformTx` (asserts `app.platform_admin` for RLS). Entering a workspace mints a
scoped support actor.

## Where the risk concentrates

1. **HR action dispatcher** — 29 verbs behind one route; authority is per-verb and
   per-record. Highest density of authorization decisions in the codebase. *(F-01 here.)*
2. **Money paths** — overtime approval → `approvedOvertimeMinutes` → payroll run → payslip →
   WPS file. Each step is a separate authority; a gap at any one is financial.
3. **Kernel-bypassing routes (15)** — every one currently correct, but each re-implements
   gates the kernel would otherwise guarantee. *(I-03.)*
4. **Biometrics** — face templates and attendance captures; fails closed when the engine is
   unavailable (503, never a wave-through).
5. **Migration-derived permissions** — backfills that grant a new permission from an existing
   one carry the *scope* but not the *record-level constraints* the source had. This is the
   generalised form of F-01 and the pattern most likely to recur.
