# Data Flows

Only flows that can be traced in the repository are listed. Each step names
its evidence.

## 1. Browser page request (authenticated workspace page)

```text
Browser → Caddy (TLS, X-Real-IP) → Next proxy (src/proxy.ts: CSP, x-pathname)
→ (workspace)/[workspaceSlug]/layout.tsx → requestCtx() (src/lib/workspace-page.ts)
→ resolveCtx() (src/lib/auth/session.ts): cookie lf_session → sha256 → PlatformSession
   (not revoked, not expired, idle check, user ACTIVE, MFA satisfied for privileged
   roles, lastSeenAt touched ≤ 1/min) → active WorkspaceMembership (ACTIVE, tenant ACTIVE)
→ requireWorkspace(ctx, slug, module) + assertModuleEntitlement
→ page loads via services with Ctx → Prisma (tenant guard pins app.tenant_id) → PostgreSQL (RLS)
→ server-rendered HTML + client islands
```
VERIFIED — files named above. Redirects: no shell → `/login`; MFA enrolment
pending → security page (`layout.tsx`).

## 2. Browser API call

```text
Client component → fetch('/api/v1/…', credentials same-origin)
→ route() kernel: requestId → resolveCtx → rate limits → entitlement → permission
→ Zod parse → handler → service → Prisma/RLS → audit(auditEvent) → JSON + x-request-id
→ on 401: src/lib/auth/client.ts single-flight POST /api/v1/auth/refresh, one retry, else onSessionEnded
```
VERIFIED — `src/lib/api/handler.ts`, `src/lib/auth/client.ts`.

## 3. Login

```text
POST /api/v1/auth/login {email, password, mfaCode? | recoveryCode?}
→ rate limits loginPerIp (10/5 min) + loginPerAccount (5/5 min)
→ PlatformUser lookup; verifyPassword (argon2id) or burnTiming() for unknown users
→ failed-login counter / lockout (lockoutMinutes setting, MAX_FAILED_LOGINS)
→ MFA required if user.mfaEnabled OR tenant mfaRequired OR privileged platform role
   ├─ no secret yet → MFA_ENROLMENT session (10 min) + {mfaEnrolmentRequired:true}
   ├─ no code supplied → 200 {mfaRequired:true}
   └─ code/recovery verified → createPlatformSession (FULL, mfaSatisfied)
→ Set-Cookie lf_session (httpOnly, sameSite lax, secure in production)
→ audit + workspace selection (/auth/workspaces)
```
VERIFIED — `src/app/api/v1/auth/login/route.ts`, `src/lib/auth/session.ts`,
`password.ts`, `mfa.ts`, `src/lib/security/ratelimit.ts`. TESTED —
`tests/security/auth-validation`, `mfa-enrolment`, `mfa-reauth`,
`recovery-codes`, `ratelimit`, `tests/server/session-lifecycle`.

## 4. Session refresh and logout

```text
POST /auth/refresh: cookie token → hash → session; already-rotated token presented again
   → treated as theft: revoke the family; idle cutoff exceeded → revoke IDLE_TIMEOUT;
   else createPlatformSession(rotated) + new cookie
POST /auth/logout → revokeSession(USER_LOGOUT) + cookie delete
POST /auth/logout-all → revokeAllPlatformSessions / revokeAllSessions
```
VERIFIED — `src/app/api/v1/auth/refresh/route.ts`, `logout`, `logout-all`,
`src/lib/auth/session.ts`.

## 5. Password reset and invitation

```text
POST /auth/forgot-password → PasswordResetToken {tokenHash sha256, expiresAt +30 min}
   → mailer.sendMail (body never logged) → link
POST /auth/reset-password {token,newPassword} → hash match, not used, not expired
   → checkPolicy + PasswordHistory → hashPassword → usedAt set (scoped consumption)
POST /auth/accept-invite → WorkspaceInvitation → membership + credentials
```
VERIFIED — the three route files, `src/lib/mailer.ts`. TESTED —
`tests/security/password-reset`, `password-policy`,
`tests/integration/forgot-password-flow`, `invitation-flow`.

## 6. API-key integrator

```text
Authorization: Bearer lf_live_<prefix>_<secret> → authenticateApiKey: prefix lookup,
revokedAt/expiresAt checks, argon2 verify of secret, scopes ⊆ role permissions
→ per-key limit (API_RATE_LIMIT_PER_MIN) → same kernel pipeline as a user
```
VERIFIED — `src/lib/auth/apiKey.ts`, `handler.ts`. TESTED —
`tests/security/self-service-api-key`.

## 7. Inbound webhooks (telephony, Meta)

```text
Vendor → POST /api/v1/webhooks/telephony[/key][/answer] or /webhooks/meta/[key]
→ signature verification (vendor-specific; tests telephony-signature, meta-webhook-signature)
→ tenant resolved from the connection key, never from the payload
→ service (calls / social leads / conversations) → Prisma → enqueue follow-on jobs
```
VERIFIED — route files under `src/app/api/v1/webhooks`,
`src/lib/integrations/telephony/*`, `meta/*`. TESTED —
`tests/security/telephony-signature`, `meta-webhook-signature`,
`meta-webhook-events`, `tests/integration/telephony-webhook-flow`.

## 8. Outbound webhooks and background jobs

```text
Service → enqueue(queue, job) (src/lib/queue.ts, Redis)
→ worker process (src/workers/<queue>.ts) → service with a system Ctx
→ webhook worker: WebhookEvent row (attempts incremented), 5 attempts exp backoff,
   failures kept in Redis (removeOnFail 5000) and visible via WebhookEvent
```
VERIFIED — `src/lib/queue.ts`, `src/workers/webhook.ts`. Signing algorithm
for outbound payloads: `WEBHOOK_SIGNING_PEPPER` exists in `env.ts`; the
exact HMAC construction was not traced in Phase A — INFERRED.

## 9. Call recording → transcription → AI analysis

```text
Telephony webhook → Call/Recording rows → media queue fetches the recording into
object storage (allow-listed hosts RECORDING_URL_ALLOWED_HOSTS, private-address guard)
→ ai queue → transcription provider (Google Speech / Gemini / OpenRouter per connection)
→ Transcript → AIAnalysis / scorecards → usage metered per workspace (plan allowance)
```
VERIFIED at the module level — `src/workers/media.ts`, `src/workers/ai.ts`,
`src/lib/integrations/transcription.ts`, `src/lib/ai/*`,
`src/lib/security/outboundUrl.ts`. TESTED — `tests/permission/ai-usage`,
`tests/security/ai-redaction`, `secret-egress`.

## 10. Face check-in (attendance)

```text
Employee (browser/PWA/WebView) → capture → POST attendance punch route
→ src/services/hr/face.ts: /health (5 s) then POST {FACE_SERVICE_URL}/analyse
   (Bearer FACE_SERVICE_TOKEN, FACE_SERVICE_TIMEOUT_MS) → apps/face (FastAPI, InsightFace)
→ match against HrFaceTemplate (threshold FACE_MATCH_THRESHOLD, samples FACE_SAMPLES_REQUIRED)
→ HrAttendancePunch; capture frame encrypted and stored in object storage
   (legacy on-disk vault read fallback; retention sweep)
```
VERIFIED — `src/services/hr/face.ts`, `apps/face/main.py`,
`src/lib/env.ts`; storage behaviour DOCUMENTED in `docs/KNOWN-LIMITATIONS.md`
("The web tier is stateless now") and matched by
`scripts/migrate-attendance-captures.mjs`. TESTED — `tests/unit/capture-vault`
(Windows-environmental failures noted in `docs/PHASE_A_GAP_ANALYSIS.md`).

## 11. Platform Owner entering a workspace (support access)

```text
Owner/Support/Security auditor (MFA satisfied) → POST /platform/workspaces/[id]/access
   (reason ≥ 12 chars, minutes ≤ 240, default 30) → PlatformAccessGrant
→ POST …/enter → session activeTenantId switched → workspace UI with SupportModeBanner
→ PlatformAuditEvent
```
VERIFIED — `src/lib/auth/platform-access.ts`, `platform-policy.ts`, route
files under `platform/workspaces/[workspaceId]`,
`components/platform/SupportModeBanner.tsx`. TESTED —
`tests/security/platform-support-access`, `platform-break-glass`,
`platform-mfa`.

## 12. Public lead capture

```text
Anonymous → GET /f/[workspaceSlug]/[formKey] (server-rendered form)
→ POST /api/v1/public/forms → validation → Lead + FormSubmission in that tenant
→ distribution / automation queues
```
VERIFIED — `src/app/f/**`, `src/app/api/v1/public/forms/route.ts`.
Anti-abuse controls on this path (rate limit, captcha) were not traced in
Phase A — `INFERRED — requires verification`.

## Evidence Sources

E1: the files named per flow under `apps/web/src/**`, `apps/face/main.py`.
E3: `apps/web/tests/security/*`, `tests/integration/*`, `tests/server/*`,
`tests/permission/*`.
E4: `apps/web/docs/03-API.md`, `docs/KNOWN-LIMITATIONS.md`.
Unverified: outbound webhook signing construction, public-form abuse
controls, idempotency-key storage.
