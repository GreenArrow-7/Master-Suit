# Authentication

Current observed behaviour. VERIFIED from implementation unless labelled.

## Login mechanism

- `POST /api/v1/auth/login` with e-mail + password, optional `mfaCode`
  (6 digits) or single-use `recoveryCode`. Identity is `PlatformUser`
  (`prisma/schema.prisma`); workspace accounts are memberships of that
  identity (`WorkspaceMembership`). E1 `src/app/api/v1/auth/login/route.ts`.
- Passwords: argon2id via `@node-rs/argon2` with tunable
  `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`; unknown
  users trigger `burnTiming()` (a dummy verify) to equalise response time.
  Password policy (`checkPolicy`, `DEFAULT_POLICY`, `PasswordHistory` with
  `reuseWindow`/`maxAgeDays`) — E1 `src/lib/auth/password.ts`; E3
  `tests/security/password-policy`.
- Brute-force controls: Redis fixed windows `loginPerIp` 10/300 s and
  `loginPerAccount` 5/300 s; account lockout after `MAX_FAILED_LOGINS` for
  `lockoutMinutes` (platform setting). E1 `src/lib/security/ratelimit.ts`,
  login route; E3 `tests/security/ratelimit`, `auth-validation`.
- Workspace selection after login: `GET/POST /api/v1/auth/workspaces`
  chooses `activeTenantId` among ACTIVE memberships of ACTIVE tenants. E1
  `src/lib/auth/platform-policy.ts` `isActiveWorkspaceMembership`.

## Session / token mechanism

- Opaque random token; only `sha256(token)` is stored in `PlatformSession`
  (`tokenHash` unique) with `purpose` (`FULL`, `MFA_ENROLMENT`,
  `AI_SERVICE`), `activeTenantId`, `mfaSatisfied`, `expiresAt`, `lastSeenAt`,
  `revokedAt`/`revokedReason`, device fields. E1 `src/lib/auth/session.ts`,
  schema.
- Cookie `lf_session` (FULL/MFA_ENROLMENT) or `lf_service_session`
  (AI_SERVICE): `httpOnly`, `sameSite: 'lax'`, `secure` when
  `NODE_ENV === 'production'`, expiry = session `expiresAt`. E1.
- Lifetimes: `SESSION_TTL_MINUTES` (FULL), 10 minutes for `MFA_ENROLMENT`
  (`MFA_ENROLMENT_TTL_MINUTES`), `SERVICE_SESSION_TTL_MINUTES` for service
  sessions (capped at 480 per the code comment); idle timeout from the
  platform setting `sessionIdleTimeoutMinutes` (env default
  `SESSION_IDLE_TIMEOUT_MINUTES`), enforced in both `resolveCtx` and refresh
  (`IDLE_TIMEOUT` revocation). `lastSeenAt` is written at most once a minute.
  E1. Defaults live in `src/lib/env.ts` (not restated here to avoid drift).
- Per-request checks in `resolveCtx`: session exists, not revoked, not
  expired, idle window, user ACTIVE and not deleted, purpose matches role
  (`ROLE_PURPOSE_MISMATCH` revocation), MFA satisfied for privileged
  platform roles unless the session is an enrolment session, then the
  active membership and tenant status. E1 `session.ts`. TESTED —
  `tests/server/session-lifecycle`, `tests/security/mfa-reauth`,
  `platform-identity`.

## Refresh behaviour

`POST /api/v1/auth/refresh`: presents the cookie; the session is looked up
by hash; a token that was already rotated is treated as theft (family
revoked); idle cutoff exceeded → revoked; otherwise a new session/token is
created and the cookie replaced. The browser wrapper performs at most one
single-flight refresh per 401 burst. E1 `refresh/route.ts`,
`src/lib/auth/client.ts`.

## Logout

`POST /auth/logout` revokes the presented session (`USER_LOGOUT`) and deletes
the cookie; `POST /auth/logout-all` revokes every session of the identity
(optionally except the current). E1.

## MFA

- TOTP per RFC 6238 (SHA-1, 6 digits, 30 s step, drift window) —
  `src/lib/auth/mfa.ts`; `otpauth://` provisioning URL with product issuer.
- Required when `user.mfaEnabled`, when the workspace setting `mfaRequired`
  is on, or for `OWNER`/`SUPPORT`/`SECURITY_AUDITOR`. A required-but-unenrolled
  user receives a 10-minute `MFA_ENROLMENT` session that only the enrolment
  routes accept (`/auth/enroll-2fa`, page `(auth)/enroll-2fa`).
- Recovery codes (single use). `AuthenticationFactor` model. Operator
  helper `scripts/owner-mfa.mjs` (local/demo). E1; E3 `mfa-enrolment`,
  `recovery-codes`, `platform-mfa`, `tests/e2e/auth-mfa`.

## Account recovery

`forgot-password` issues a `PasswordResetToken` (sha256 hash stored, 30
minutes, single use) sent by e-mail; `reset-password` validates, applies the
policy/history checks, hashes the new password, marks the token used with a
scoped update (migration `20260904080000_platform_scoped_password_reset`).
Temporary passwords for operator-created accounts are single-use
(`tests/security/temporary-password`). E1; E3 `password-reset`,
`tests/integration/forgot-password-flow`.

## Invitations

`WorkspaceInvitation` → `accept-invite` (page + route) creates/links the
identity and membership. E3 `tests/integration/invitation-flow`,
`tests/e2e/invitation`.

## API keys

`lf_live_<8-hex prefix>_<43-char secret>`; only the prefix is stored in clear,
the secret is argon2-hashed; `scopes` may only narrow the bound role;
`expiresAt`/`revokedAt` honoured; per-key rate limit
`API_RATE_LIMIT_PER_MIN`. Self-service issuance is tested. E1
`src/lib/auth/apiKey.ts`; E3 `self-service-api-key`, `single-credential-store`.

## Service identities

`AI_SERVICE` platform users authenticate with `lf_svc_…` credentials
(`PlatformServiceCredential`, argon2-hashed, expiry required, ≤ 90 days,
rotation function) via `service-login` (rate limit 10/900 s) into a
purpose-bound `AI_SERVICE` session/cookie; credentials cannot be issued to
any other role. Provisioned by `scripts/platform-service-identity.mjs`. E1
`src/lib/auth/service-identity.ts`; E3 `service-identity-*`,
`platform-service-identity`.

## Rate limiting (auth-related, E1 `ratelimit.ts`)

| Key | Limit |
|---|---|
| `login:ip:<ip>` | 10 per 300 s |
| `login:acct:<email>` | 5 per 300 s |
| `svclogin:<username>` | 10 per 900 s |
| `api:<keyId>` | `API_RATE_LIMIT_PER_MIN` per 60 s |
| `route:<module>:<action>:<actor|ip>` | per-route `rateLimit` spec |

Fixed windows admit up to 2× nominal across a boundary (documented in the
file). Additional edge-level limits: none identified in `infra/Caddyfile`
(negative evidence at the repository level).

## Conflicts / notes

`docs/AUTHENTICATION-DESIGN.md` (19 lines, 2026-08-05) describes the target
model at unification time; the implementation above is the current state
and is consistent with it. `docs/SECURITY-REMEDIATION.md` refers to a
`2fa_enrollment` credential of the old HRMS — the same control now exists as
the `MFA_ENROLMENT` session purpose (**EVC-011** in
`docs/EVIDENCE_CONFLICTS.md`).

## Evidence Sources

E1: `apps/web/src/lib/auth/{session,password,mfa,apiKey,service-identity,platform-policy,platform-access,client}.ts`,
`src/lib/security/ratelimit.ts`, `src/app/api/v1/auth/*/route.ts`,
`prisma/schema.prisma`, `prisma/migrations/20260904080000_platform_scoped_password_reset`.
E3: `apps/web/tests/security/*`, `tests/server/session-lifecycle.spec.ts`,
`tests/integration/*`, `tests/e2e/auth-mfa.spec.ts`.
E4: `docs/AUTHENTICATION-DESIGN.md`, `docs/SECURITY-REMEDIATION.md`,
`apps/web/docs/05-SECURITY.md` §2.
Unverified: production values of TTL/idle/lockout settings.
