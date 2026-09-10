# Observability

Current state. Authoritative detail: `docs/OBSERVABILITY.md` (2026-08-21).

## Logs

- pino 9 JSON to stdout, `level: LOG_LEVEL`, `base: { service:
  'leadflow', role: PROCESS_ROLE }`, redaction list for credentials and
  auth headers. VERIFIED `src/lib/logger.ts`.
- Request correlation: `x-request-id` (incoming or ULID) on every kernel
  response and in warn/error log lines; problem+json carries `requestId`.
  VERIFIED `src/lib/api/handler.ts`.
- Collection: Docker json-file driver, 10 MB × 5 per container
  (`x-logging` in every compose file). No log-shipping configuration was
  identified in any compose file or entrypoint, so on the inspected evidence
  logs remain on the host and are lost with the container. A collector
  installed outside the repository would not be visible here. DOCUMENTED by
  `docs/OBSERVABILITY.md` and consistent with the compose configuration.
- `no-console` lint rule (`warn`/`error` allowed) — 0 `console.log` in `src`.

## Metrics

- In-process registry (`src/lib/metrics.ts`: counters, gauges, histograms,
  `MAX_SERIES` cap) exposed at `GET /api/metrics` in Prometheus exposition,
  gated by `METRICS_TOKEN` (404 without or when unset); Caddy answers 404 for
  the path publicly, so only in-network scrapes reach it. VERIFIED.
- Prometheus v3.1.0 scrapes `web:3000` every 30 s with the token from a
  0600 file rendered by `prometheus-entrypoint.sh`; Alertmanager v0.28.0
  routes to e-mail (`ALERT_EMAIL_TO`, `ALERT_PAGE_EMAIL_TO`) and an optional
  webhook. E2 `infra/prometheus.yml`, `alertmanager-entrypoint.sh`. TESTED
  `tests/unit/observability` (POSIX-only assertions).
- Notable series: `masterapp_build_info`, tenant-guard trips, queue depth/
  age/failures/deferrals, HTTP error rate and latency, DB connections vs
  max, face token age, AI spend. E1/E2.

## Alerting (E2 `infra/prometheus-alerts.yml`, 12 rules)

`TenantGuardTripped`, `QueueHasNoConsumer`, `QueueBacklogAgeing`,
`QueueDeferralsSustained`, `QueueFailuresAccumulating`,
`ServerErrorRateHigh`, `RequestLatencyDegraded`, `ApplicationDown`,
`PlatformWriteAccessOpen`, `DatabaseConnectionsHigh`,
`FaceServiceTokenStale`, `AiSpendSpiking`. `scripts/check-observability.mjs`
(CI gate) keeps rule/job names aligned with the app. Delivery in production:
`UNKNOWN — requires runtime/infrastructure verification`.

## Health checks

`GET /api/health` (Postgres `SELECT 1` and Redis `PING`, 2 s deadline each,
503 `degraded`), `GET /api/health/live` (process alive). Compose
`healthcheck` on web; `depends_on: condition: service_healthy`. VERIFIED.

## Exception tracking and tracing

No exception-tracking or tracing integration was identified in the inspected
evidence: `apps/web/package.json` declares no Sentry, OpenTelemetry or
Datadog package, and no exporter or DSN configuration was found in `src/` or
`infra/`. `docs/OBSERVABILITY.md` "What is still missing" states the same.
Controls outside the repository, such as an agent installed on the host,
would not be visible here — `UNKNOWN — requires runtime/infrastructure
verification`.

## Audit logs

`AuditLog` per tenant (30 `AuditEvent` kinds, before/after values,
`requestId`, IP, UA; 141 `audit()` call sites; kernel `auditEvent`) and
`PlatformAuditEvent` for console actions; platform UI at `/platform/audit`;
retention via `AUDIT_LOG_RETENTION_DAYS` / `PLATFORM_AUDIT_RETENTION_DAYS`
(`lib/jobs/retention.ts`). VERIFIED; TESTED `tests/permission/audit-retention`.

## Evidence Sources

E1: `apps/web/src/lib/logger.ts`, `src/lib/metrics.ts`,
`src/app/api/metrics/route.ts`, `src/app/api/health/*`,
`src/lib/api/handler.ts`, `src/lib/security/audit.ts`, `src/lib/jobs/retention.ts`.
E2: `apps/web/infra/docker-compose*.yml`, `infra/prometheus.yml`,
`infra/prometheus-alerts.yml`, `infra/prometheus-entrypoint.sh`,
`infra/alertmanager-entrypoint.sh`, `scripts/check-observability.mjs`,
`eslint.config.mjs`, `package.json`.
E3: `apps/web/tests/unit/observability.spec.ts`, `tests/security/metrics.spec.ts`.
E4: `docs/OBSERVABILITY.md`, `docs/KNOWN-LIMITATIONS.md`.
