# Security Model

Current observed state. Findings and concerns are recorded separately in
`docs/security/SECURITY_OBSERVATIONS.md`; this file describes the model.

## Trust boundaries

| # | Boundary | Controls found | Evidence |
|---|---|---|---|
| 1 | Internet → edge | Caddy TLS (ACME, `APP_DOMAIN`, `ACME_EMAIL`), `request_body max_size 32MB`, `/api/metrics` answered 404 at the edge, `X-Real-IP` set | E2 `infra/Caddyfile` |
| 2 | Edge → app | `TRUSTED_PROXY_CIDRS` + `clientIp()`; HSTS/nosniff/referrer/permissions/COOP headers; CSP per request; `ALLOWED_ORIGINS` and origin checks | E1 `src/lib/auth/session.ts`, `src/lib/security/cidr.ts`, `origin.ts`, `src/proxy.ts`; E2 `next.config.ts`; E3 `tests/security/client-ip`, `csp`, `redirect` |
| 3 | Anonymous → authenticated | session cookie / API key / service credential resolved in the kernel; public routes are explicit (`public/*`, `f/`, `l/`, `rsvp/`, `testimonial/`, webhooks) | E1 `src/lib/api/handler.ts` |
| 4 | Tenant → tenant | `Ctx.tenantId` on every service call; Prisma tenant guard; PostgreSQL FORCE RLS; 404 for foreign records | E1 `src/lib/db.ts`, migrations; E3 `tests/tenant/*` |
| 5 | User → user inside a tenant | role → permission → scope (`OWN/TEAM/BRANCH/REGION/ORGANIZATION`), `visibilityWhere`, field permissions | E1 `src/lib/security/rbac.ts`, `visibility.ts`, `fieldSecurity.ts`; E3 `tests/permission/*` |
| 6 | Workspace → platform console | `PlatformRole`; MFA mandatory for `OWNER`, `SUPPORT`, `SECURITY_AUDITOR`; time-boxed, reasoned `PlatformAccessGrant`; separate `app.platform_admin` RLS mode; `PlatformAuditEvent` | E1 `src/lib/auth/platform-*.ts`; E3 `tests/security/platform-*` |
| 7 | App → machine identities | `AI_SERVICE` platform role with `PlatformServiceCredential` (`lf_svc_`, ≤ 90 days), separate `lf_service_session` cookie, purpose-bound sessions | E1 `src/lib/auth/service-identity.ts`, `session.ts`; E3 `tests/security/service-identity-*`, `platform-service-identity` |
| 8 | App → third parties | envelope-encrypted stored credentials; outbound private-address guard; recording host allow-list; signed inbound webhooks; prompt redaction before LLM calls; secret-egress tests | E1 `src/lib/security/envelope.ts`, `outboundUrl.ts`, `src/lib/ai/redact.ts`; E3 `tests/security/secret-egress`, `ai-redaction`, `integration-connections` |
| 9 | App → face sidecar | shared bearer token, constant-time compare, rotation window, staleness alert | E1 `apps/face/tokens.py`; E2 alert rule |
| 10 | Inside the Compose network | Redis password required everywhere; PostgreSQL app role `NOBYPASSRLS`; internal traffic is plaintext on one host | E1/E2; E4 `docs/KNOWN-LIMITATIONS.md` |
| 11 | Process → configuration | Zod-validated env; `_FILE` secrets; production boot gate refuses mock providers, same-URL, env/DB mismatch | E1 `src/lib/env.ts`, `startup-check.ts`; E3 `tests/security/env-secrets`, `secret-files` |

## Sensitive assets

Customer/tenant business data (leads, deals, calls, recordings, transcripts,
campaign audiences), HR data (compensation, payslips, leave, performance,
recruiting, documents), biometric data (`BiometricConsent`,
`HrFaceTemplate`, encrypted attendance captures), platform identities and
credentials (password hashes, MFA secrets, recovery codes, sessions, API
keys, service credentials), integration credentials (envelope-encrypted),
audit trails, backups (full copies of everything), signing/encryption keys
(`FIELD_ENCRYPTION_KEY`, `WEBHOOK_SIGNING_PEPPER`), deploy keys. E1 schema,
E2 env names.

## Sensitive data categories

PII (names, phones, e-mails, addresses, UTM/referrer data), contact and
communication content (WhatsApp/e-mail bodies), voice recordings and
transcripts, biometric templates and images, financial (compensation,
payouts, commissions, bookings), authentication material, location data
(`MAX_GPS_ACCURACY_M`, `HrWorkLocation`, site visits). E1.

## Primary attack surfaces

1. `/api/v1/*` (173 handlers; 38 outside the kernel).
2. Authentication routes (`login`, `refresh`, `forgot-`/`reset-password`,
   `accept-invite`, `enroll-2fa`, `service-login`).
3. Public pages and their POST routes (`/f`, `/l`, `/rsvp`, `/testimonial`,
   `public/*`).
4. Inbound webhooks (`webhooks/telephony*`, `webhooks/meta/[key]`).
5. File upload / download (documents, recordings, HR documents, captures).
6. Platform console (`/platform/*`, `api/v1/platform/*`, `admin/*`).
7. Worker-side outbound fetches (recording URLs, provider APIs) — SSRF
   surface mitigated by `outboundUrl.ts`.
8. Operational endpoints (`/api/metrics`, `/api/health`).
9. The host: SSH for deploys, Docker daemon, `.env.<env>` files.
E1/E2.

## Frontend / backend trust relationship

The browser is untrusted. All authorization happens server-side per request;
the tenant is derived from the credential and never accepted from the client
(`apps/web/docs/03-API.md` "A request cannot name a tenant" — matched by the
kernel). The UI receives a `permitted` list only to shape navigation
(`(workspace)/[workspaceSlug]/layout.tsx`). VERIFIED.

## External integrations

See `docs/architecture/INTEGRATIONS.md`. Highest sensitivity: LLM providers
(customer data egress, mitigated by redaction and per-plan allowances), Meta
and telephony (PII in both directions), backup remotes.

## Privileged functionality and administrative surfaces

- Platform console pages (11) and routes (`platform/*` 9, `admin/*` 2): plan
  and subscription management, user actions (suspend/reset/MFA), workspace
  creation and support entry, retention settings, grid columns, audit and AI
  usage views, system health. E1.
- Operator scripts on the host (`bootstrap-owner.mjs`, `owner-mfa.mjs`,
  `platform-service-identity.mjs`, `rotate-field-encryption-key.mjs`,
  `rotate-face-token.sh`, `ensure-workspace-admin.mjs`,
  `backfill-admin-permissions.mjs`, `clean-orphaned-rows.mjs`,
  `backup*.sh`, `restore-verify.sh`, `release.sh`). These require host
  access and the migration/owner credentials; they are outside application
  authorization. E2.
- `dev/outbox` route: 404 unless `NODE_ENV !== 'production'` and
  `EMAIL_PROVIDER === 'mock'`. E1.

## File / storage exposure

Objects are private in the bucket; the application streams them after
authorization. Presigned-URL usage was not traced in Phase A — `INFERRED —
requires verification`. Uploads pass antivirus when a provider is
configured; quarantine handling is referenced in
`docs/OPERATIONAL-READINESS.md` §3 (E4). Backups may contain the entire
dataset; encryption is optional (`BACKUP_PASSPHRASE`) with a warning when
absent (E2 `scripts/backup.sh`).

## Evidence Sources

E1: `apps/web/src/lib/api/handler.ts`, `src/lib/auth/*`, `src/lib/security/*`,
`src/lib/db.ts`, `src/lib/env.ts`, `src/lib/startup-check.ts`, `src/proxy.ts`,
`src/app/api/v1/**`, `apps/face/tokens.py`, `prisma/schema.prisma`.
E2: `next.config.ts`, `infra/Caddyfile`, `infra/docker-compose*.yml`,
`infra/prometheus-alerts.yml`, `.env*.example`, `apps/web/scripts/*`.
E3: `apps/web/tests/security/*`, `tests/tenant/*`, `tests/permission/*`.
E4: `apps/web/docs/03-API.md`, `docs/KNOWN-LIMITATIONS.md`,
`docs/THREAT-MODEL.md` (14 lines, 2026-08-05 — superseded in detail by this
file), `security/APPLICATION_ATTACK_SURFACE.md` (2026-08-08).
Unverified: presigned URL usage, quarantine bucket lifecycle, live edge
configuration.
