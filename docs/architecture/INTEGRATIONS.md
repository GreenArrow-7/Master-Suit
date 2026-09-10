# Integrations

Every external integration found in the repository. Configuration variable
*names* only; no values. "Failure/retry" describes code behaviour where
traced; "UNKNOWN" where it was not.

Common mechanics (VERIFIED):
- Per-workspace connections live in `IntegrationConnection`; secrets inside
  are envelope-encrypted with `FIELD_ENCRYPTION_KEY`
  (`src/lib/security/envelope.ts`); the provider catalogue is
  `src/lib/integrations/registry.ts` (categories `TELEPHONY`, `MESSAGING`,
  `MEETINGS`, `TRANSCRIPTION`, `AI`). `verifyConnection()` tests a connection
  on save (`verify.ts`). `withRetry()` / `isTransient()` (`retry.ts`) wrap
  outbound calls where used. Outbound URLs from vendors pass the
  private-address guard (`src/lib/security/outboundUrl.ts`).
- Provider selection by env: `EMAIL_PROVIDER`, `WHATSAPP_PROVIDER`,
  `ANTIVIRUS_PROVIDER` (`mock` refused in production by
  `startup-check.ts`).

| Service | Purpose | Calling component | Direction | Auth category | Config names | Failure / retry | Webhooks | Sensitivity | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PostgreSQL | primary store | `src/lib/db.ts` | out | password (role) | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DATABASE_REPLICA_URL`, `SHADOW_DATABASE_URL`, `APP_DB_PASSWORD`/`POSTGRES_PASSWORD` (compose) | connection timeout 5 s; health 503 | — | Critical | E1/E2 |
| Redis 7 | queues, rate limits, caches, pub/sub | `src/lib/redis.ts`, `queue.ts`, `ratelimit.ts`, `entitlements.ts`, `actorCache.ts` | out | password (`requirepass`) | `REDIS_URL`, `REDIS_PASSWORD` | error listener; health 503; `check:redis-auth` gate | — | High | E1/E2 |
| S3 / MinIO | documents, recordings, exports, encrypted attendance captures, backups | `src/lib/storage.ts` | out | access key pair | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `MINIO_ROOT_*` (compose) | bucket auto-create on first use | — | High | E1 |
| SMTP (Mailpit locally) | transactional mail: reset, invitations, notifications, alerts | `src/lib/mailer.ts`, notifications worker | out | SMTP user/password | `EMAIL_PROVIDER`, `SMTP_HOST/PORT/USER/PASSWORD`, `EMAIL_FROM`, `ALERT_EMAIL_*` | notifications queue 5 attempts exp 10 s; bodies never logged | — | Medium (tokens in mail) | E1 |
| ClamAV | scan uploads | `src/lib/antivirus.ts` | out (TCP INSTREAM) | none (network) | `ANTIVIRUS_PROVIDER`, `CLAMAV_HOST/PORT`, `ANTIVIRUS_TIMEOUT_MS` | `ERROR` verdict logged; handling of ERROR by callers not traced (INFERRED) | — | Medium | E1 |
| Face service (`apps/face`) | face embedding/match for attendance | `src/services/hr/face.ts` | out (HTTP) | shared bearer token with rotation window | `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN`, `FACE_SERVICE_TOKEN_PREVIOUS`, `FACE_SERVICE_TOKEN_ROTATED_AT`, `FACE_TOKEN_MAX_AGE_DAYS`, `FACE_SERVICE_TIMEOUT_MS`, `FACE_MATCH_THRESHOLD`, `FACE_SAMPLES_REQUIRED`, `FACE_ENROLMENT_MIN_SPREAD` | 5 s health probe; explicit "engine unavailable" error; no retry found | — | High (biometric) | E1; E2 CI "Face token gate"; alert `FaceServiceTokenStale` |
| Google Gemini | LLM: assistant, call analysis, coaching, follow-up e-mail drafts, transcription | `src/lib/ai/provider.ts`, `gemini.ts`, workers `ai.ts` | out (HTTPS `generativelanguage.googleapis.com`) | API key (shared `GEMINI_API_KEY` or per-workspace key) | `GEMINI_API_KEY`, `GEMINI_MODEL` | `AbortSignal.timeout`, `ai` queue 4 attempts exp 30 s; usage metering and spend cap (`usage.ts`, alert `AiSpendSpiking`); prompt redaction (`redact.ts`) | — | High (customer data leaves the system) | E1; E3 `tests/security/ai-redaction`, `tests/permission/gemini-key`, `plan-ai-allowance` |
| OpenRouter | alternative LLM transport | `src/lib/ai/provider.ts` (`AiProviderKey = 'google' | 'openrouter'`) | out | API key (per connection) | via `IntegrationConnection` | as above | — | High | E1 |
| Google Speech-to-Text | transcription engine option | `src/lib/integrations/transcription.ts` | out (`speech.googleapis.com`) | API key | per connection (`provider`, `model` settings) | in `ai` queue | — | High (recordings) | E1 |
| Google Calendar | meetings / Meet links for events | `src/lib/integrations/calendar.ts` | out (`googleapis.com/calendar/v3`) | OAuth-style bearer per connection (category MEETINGS) | per connection (`calendarId`) | errors surface to caller; retry not traced | — | Medium | E1 |
| Meta (Facebook/Instagram) | lead forms, comments, replies, messaging | `src/lib/integrations/meta/*`, `src/services/social/*`, `meta/*` | in (webhook) + out (Graph API) | app secret + page tokens; webhook verify token | `META_APP_ID`, `META_APP_SECRET`; per connection settings | signature verified; events deduped (`WebhookEvent`) | `POST /api/v1/webhooks/meta/[key]` | High (PII) | E1; E3 `meta-webhook-signature`, `meta-webhook-events` |
| WhatsApp Cloud API | outbound messages/templates, RSVP & testimonial links | `src/lib/integrations/whatsapp.ts` | out (`graph.facebook.com/<ver>/<phoneNumberId>/messages`) | bearer token per connection | `WHATSAPP_PROVIDER`; per connection | errors returned; queueing via notifications/campaign workers | inbound via Meta webhook | High | E1 |
| Telephony — Exotel, Knowlarity, Plivo, Twilio | click-to-call, dialer sessions, recordings, live streams | `src/lib/integrations/telephony/*` (`exotel.ts`, `knowlarity.ts`, `plivo.ts`, `twilio.ts`, `stream.ts`, `resolve.ts`) | out (vendor APIs) + in (status/answer webhooks, media streams) | vendor key/token per connection | per connection (`VENDOR_FIELDS`), `RECORDING_URL_ALLOWED_HOSTS`, `LIVE_STREAM_WS_URL`, `LIVE_STREAM_PORT` | `withRetry` on transient errors; media queue 6 attempts exp 15 s | `POST /api/v1/webhooks/telephony`, `/[key]`, `/[key]/answer` (signed) | High (recordings, numbers) | E1; E3 `telephony-signature`, `telephony-vendors`, `tests/integration/telephony-webhook-flow` |
| FCM (HTTP v1) | Android push | `src/lib/push/send.ts` | out (`oauth2.googleapis.com`, `fcm.googleapis.com`) | service-account JWT (RS256) | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | `fcmConfigured()` gate; per-token results | — | Medium | E1 |
| APNs | iOS push | `src/lib/push/send.ts` | out | token-based auth (p8 key) | `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_SANDBOX` | as above | — | Medium | E1 |
| Geocoding | address → coordinates (`geocode` route), maps (Leaflet) | `src/lib/geo.ts`, `/api/v1/geocode` | out | UNKNOWN (provider not traced) | none found in `env.ts` | UNKNOWN | — | Low | E1 partial — `INFERRED — requires verification` |
| Customer-configured outbound webhooks | notify integrators of events | `src/workers/webhook.ts`, `WebhookEvent` | out | signed (pepper) — construction not traced | `WEBHOOK_SIGNING_PEPPER` | 5 attempts exp backoff; attempts recorded | — | Medium | E1 (partial) |
| GitHub (deploy/CI) | CI checks, deploy, image registry (GHCR) | `.github/workflows/*` | out (from Actions) | repository secrets, `GITHUB_TOKEN` (`packages: write`) | `DEPLOY_HOST_<ENV>`, `DEPLOY_USER_<ENV>`, `DEPLOY_KEY_<ENV>`, `DEPLOY_KNOWN_HOSTS_<ENV>`, variable `DEPLOY_PATH_<ENV>` | preflight refuses unverified commits | — | High (production access) | E2 |
| Prometheus / Alertmanager | metrics scrape & alert delivery | `infra/prometheus.yml`, `alertmanager-entrypoint.sh` | in (scrape `web:3000/api/metrics`) / out (email, webhook) | `METRICS_TOKEN` bearer; SMTP relay password in 0600 file | `METRICS_TOKEN`, `ALERT_EMAIL_TO`, `ALERT_PAGE_EMAIL_TO`, `ALERT_WEBHOOK_URL`, `PROMETHEUS_RETENTION` | `ApplicationDown` on scrape failure | — | Medium | E2; E3 `tests/unit/observability` |
| Backup remote | off-host copies | `scripts/backup-ship.sh` | out (`local`, `s3`, `rclone`, `rsync` modes) | per transport | `BACKUP_*` (script env) | re-read and manifest reconciliation | — | Critical (full data) | E2; production remote `UNKNOWN` |

Not found in the repository (repository-wide search): payment gateways,
SMS gateways as a first-class provider (`SMS_PROVIDER` was removed per
`apps/web/docs/00-ARCHITECTURE.md` §8), e-signature, error-tracking SaaS,
OpenTelemetry exporters, Slack/Teams. Negative evidence only.

## Evidence Sources

E1: `apps/web/src/lib/integrations/**`, `src/lib/ai/**`, `src/lib/push/send.ts`,
`src/lib/mailer.ts`, `src/lib/antivirus.ts`, `src/lib/storage.ts`,
`src/lib/redis.ts`, `src/lib/db.ts`, `src/services/hr/face.ts`,
`src/workers/*.ts`, `src/lib/security/outboundUrl.ts`, `src/lib/env.ts`.
E2: `.env*.example`, `infra/*`, `.github/workflows/*`, `scripts/backup*.sh`.
E3: `apps/web/tests/security/*`, `tests/integration/*`, `tests/permission/*`.
Unverified: geocoding provider, outbound webhook signature construction,
ClamAV `ERROR` verdict handling, production backup remote.
