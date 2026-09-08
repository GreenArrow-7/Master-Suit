# Logging

Current observed behaviour.

## Framework and destination

pino 9.14.0 (`src/lib/logger.ts`), structured JSON to stdout. Base fields
`service: 'leadflow'`, `role: PROCESS_ROLE`. Level from `LOG_LEVEL`
(enum in `src/lib/env.ts`). Containers write through Docker's json-file
driver with rotation at 10 MB × 5; nothing ships logs off the host. E1/E2.

## Levels in use

`logger.error` for 5xx and infrastructure failures (including audit-write
failures), `logger.warn` for rejected requests (4xx) and degraded
conditions, `info`/`debug` elsewhere. 206 `logger.*` call sites in `src`;
`console.log` is banned by ESLint (`no-console`, `warn`/`error` allowed) and
there are none in `src`. E1/E2.

## Structure and correlation

Every kernel-handled request has a `requestId` (incoming `x-request-id` or a
new ULID); it appears in log lines and in the problem+json body, so a user
report maps to log lines. Worker logs carry `role: 'worker'`. No trace ids —
there is no tracing. E1.

## Sensitive data

- pino `redact` paths: `password`, `*.password`, `passwordHash`,
  `*.passwordHash`, `token`, `*.token`, `tokenHash`, `*.tokenHash`,
  `secret`, `*.secret`, `apiKey`, `*.apiKey`, `otp`, `*.otp`,
  `req.headers.authorization`, `req.headers.cookie`; censor `[redacted]`.
  Depth is one wildcard level — deeper nesting is not covered
  (`docs/security/SECURITY_OBSERVATIONS.md` SEC-OBS-007). E1.
- `scrubSecrets()` in the API kernel strips known secret keys from error
  context before logging; `SECRET_KEYS` (`src/lib/security/audit.ts`) is the
  shared list and also keeps secrets out of audit metadata. E1.
- Mail bodies are never logged (`src/lib/mailer.ts` comment and code) because
  they carry reset and invitation tokens. AI prompts are redacted before
  leaving the process (`src/lib/ai/redact.ts`). E1; TESTED
  `tests/security/secret-egress`, `ai-redaction`.

## Audit logging (separate from application logs)

`AuditLog` (tenant-scoped: actor, event, object, field, previous/new value,
metadata, ip, ua, requestId, occurredAt, four indexes) written by `audit()`
and `auditDiff()` from 141 sites and by the kernel for routes declaring
`auditEvent`; `PlatformAuditEvent` for platform-console actions. Retention
sweeps by `AUDIT_LOG_RETENTION_DAYS` and `PLATFORM_AUDIT_RETENTION_DAYS`
(`src/lib/jobs/retention.ts`); viewable at `/platform/audit`. E1; TESTED
`tests/permission/audit-retention`.

## Recommended future standard (not current)

- Ship logs somewhere durable (none today); choose a destination before
  adding a second host.
- Deepen redaction or forbid logging raw request bodies outright.

## Evidence Sources

E1: `apps/web/src/lib/logger.ts`, `src/lib/api/handler.ts`,
`src/lib/security/audit.ts`, `src/lib/mailer.ts`, `src/lib/ai/redact.ts`,
`src/lib/jobs/retention.ts`, `prisma/schema.prisma` (`AuditLog`,
`PlatformAuditEvent`), `src/workers/*`.
E2: `eslint.config.mjs`, `infra/docker-compose*.yml`, `.env*.example`.
E3: `apps/web/tests/security/secret-egress.spec.ts`, `ai-redaction.spec.ts`,
`tests/permission/audit-retention.spec.ts`.
E4: `docs/OBSERVABILITY.md`.
