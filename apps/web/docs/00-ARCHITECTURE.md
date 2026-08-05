# LeadFlow CRM — System Architecture

## 1. Topology

```
                      ┌──────────────────────────────────────────┐
   Browser / PWA ───▶ │  Next.js 15 (App Router, RSC)            │
   Field mobile  ───▶ │  • /app        authenticated UI          │
                      │  • /p          public forms + LPs        │
                      │  • /api/v1     REST (OpenAPI 3.1)        │
                      └───────────┬──────────────────────────────┘
                                  │ (single image, horizontally scaled)
        ┌─────────────────────────┼─────────────────────────────┐
        │                         │                             │
┌───────▼─────────┐    ┌──────────▼────────┐        ┌───────────▼────────┐
│ PostgreSQL 16   │    │ Redis 7           │        │ S3-compatible      │
│ • OLTP          │    │ • BullMQ queues   │        │ • documents        │
│ • partitioned   │    │ • config cache    │        │ • import/export    │
│   activity+audit│    │ • rate limits     │        │ • signed URLs only │
│ • tsvector FTS  │    │ • round-robin ptr │        └────────────────────┘
└─────────────────┘    └──────────┬────────┘
                                  │
                     ┌────────────▼────────────┐
                     │ Worker process (same    │
                     │ image, PROCESS_ROLE=…)  │
                     │ 9 queues, see §5        │
                     └─────────────────────────┘
```

Single deployable image; `PROCESS_ROLE` selects web or worker. No worker logic in
request handlers, no request logic in workers. Both import the same `src/services`
layer, so authorization is identical on either path.

## 2. Layering rules

| Layer | Path | May import | Never does |
|---|---|---|---|
| Route handlers | `src/app/api/**` | services, `lib/api` | touch `prisma` directly |
| Server actions | `src/app/**/actions.ts` | services | touch `prisma` directly |
| Services | `src/services/**` | repositories, `lib/*` | read cookies or `Request` |
| Repositories | `src/repositories/**` | `lib/db` | make authorization decisions |
| Workers | `src/workers/**` | services | bypass `Ctx` |

**Every** service entry point takes a `Ctx` (tenant + actor + resolved permissions)
as its first argument. There is no ambient tenant anywhere in the codebase. This is
what makes the tenant-isolation suite meaningful rather than decorative.

## 3. Module map

| # | Module | Owns | Phase |
|---|---|---|---|
| 01 | Identity | users, sessions, MFA, lockout, password policy | 1 |
| 02 | Tenancy | tenants, org settings, branding, regions, branches, territories, departments, teams | 1 |
| 03 | Access control | roles, permissions, role-permissions, field permissions, visibility resolver | 1 |
| 04 | Audit | append-only log, diff capture, viewer, export | 1 |
| 05 | Leads | leads, stages, custom fields, scoring, grading, duplicates, merge | 2 |
| 06 | Activities | activity types, 360° timeline, activity-driven scoring | 2 |
| 07 | Tasks & calendar | tasks, recurrence, reminders, escalation, day/week/month views | 2 |
| 08 | Smart Views | view tabs, filter tree, personal/team/role scoping | 2 |
| 09 | Data movement | import jobs, export jobs, column mapping, error files | 2 |
| 10 | Opportunities | types, pipelines, stages, kanban, forecast, line items | 3 |
| 11 | Accounts & contacts | B2B hierarchy, relationship rollups | 3 |
| 12 | Products | catalogue, eligibility, pricing, tax | 3 |
| 13 | Distribution | rule engine, 15 methods, quotas, capacity, fallback, simulation | 3 |
| 14 | Automation | graph builder, trigger bus, conditions, actions, waits, retries | 4 |
| 15 | Marketing | campaigns, lists, segments, email campaigns, attribution | 5 |
| 16 | Forms | dynamic builder, conditional logic, submissions | 5 |
| 17 | Landing pages | block builder, versions, publishing, analytics | 5 |
| 18 | Communications | unified timeline, provider abstraction, consent, quiet hours | 6 |
| 19 | Field sales | visit plan, check-in/out, geofence, offline sync, attendance | 6 |
| 20 | Service | tickets, SLA, business hours, escalation, CSAT, canned responses | 6 |
| 21 | Documents | versioned storage, verification, expiry, signed URLs, AV hook | 6 |
| 22 | Analytics | report builder, dashboards, widgets, schedules | 7 |
| 23 | AI assistance | summarisation, next-best-action, classification, NL reporting | 7 |
| 24 | Integrations | API keys, signed webhooks, connector registry | 3→7 |

## 4. Navigation

Collapsible left rail, five groups. An item renders only when the actor holds
`<module>:VIEW`; an empty group hides its own header.

```
WORK      Home · Smart Views · Leads · Opportunities · Accounts · Contacts
          Activities · Tasks · Calendar
GROW      Marketing · Campaigns · Forms · Landing Pages · Communications · Automation
OPERATE   Field Sales · Customer Service · Documents · Products
INSIGHT   Reports · Dashboards
SYSTEM    Integrations · Administration · Audit Logs · Settings
```

Top bar: organization selector · branch selector · global search (⌘K) ·
quick create (c) · notifications · recently viewed · help · profile.

## 5. Background job architecture

BullMQ on Redis. Nine queues with independent concurrency and retry policy, so a
slow campaign send cannot starve SLA timers.

| Queue | Concurrency | Attempts | Backoff | Jobs |
|---|---|---|---|---|
| `automation` | 25 | 5 | exp 2s→5m | enrollment step execution, wait resumption |
| `distribution` | 10 | 3 | exp 1s→30s | assignment, reassignment, escalation |
| `sla` | 10 | 3 | fixed 30s | lead first-contact timers, ticket response/resolution timers |
| `messaging` | 40 | 5 | exp 5s→15m | email/SMS/WhatsApp send, delivery receipts |
| `campaign` | 4 | 3 | exp 30s→10m | audience materialisation, batched sends |
| `import` | 3 | 2 | fixed 60s | chunked CSV/XLSX ingest, 5 000 rows per chunk |
| `export` | 3 | 2 | fixed 60s | streamed CSV/XLSX/PDF to object storage |
| `webhook` | 20 | 5 | exp 10s→30m | signed delivery and retry ladder |
| `maintenance` | 2 | 1 | — | score decay, list rebuild, partition rotation, session GC |

Repeatable jobs: SLA sweeper (60 s), score decay (daily 02:00 tenant-local),
dynamic list rebuild (15 m), partition creation (weekly), export-link expiry (hourly).

Idempotency: every job carries `jobId = sha256(tenantId:kind:recordId:discriminator)`.
Re-enqueueing an in-flight key is a no-op, so retries and duplicate triggers converge
on one side effect.

## 6. Caching

| Cached | Key | TTL | Invalidated by |
|---|---|---|---|
| Org settings | `t:{tid}:settings` | 10 m | settings write |
| Role → permission map | `t:{tid}:role:{rid}:perms` | 10 m | role or permission write |
| Stage & pipeline config | `t:{tid}:stages` | 10 m | config write |
| Custom field definitions | `t:{tid}:cfd:{obj}` | 10 m | definition write |
| Visibility user set | `t:{tid}:vis:{uid}:{scope}` | 5 m | team/branch/manager change |

Writes publish an invalidation on a Redis pub/sub channel so every web pod drops its
in-process LRU copy. Record data is never cached — configuration only.

## 7. Repository structure

```
leadflow-crm/
├─ prisma/
│  ├─ schema.prisma                 79 models · 25 enums · 119 indexes
│  ├─ migrations/                   SQL incl. partial indexes, FTS, partitions, RLS
│  └─ seed/                         demo tenant generator (06-SEED-PLAN.md)
├─ prisma.config.ts                 Prisma 7 migrate configuration
├─ src/
│  ├─ app/
│  │  ├─ (auth)/  login · forgot-password · reset-password
│  │  ├─ (app)/   26 authenticated route groups
│  │  ├─ p/[slug] public forms and landing pages
│  │  └─ api/v1/  REST surface
│  ├─ components/  ui/ · data-grid/ · builders/ · nav/
│  ├─ services/    one folder per module in §3
│  ├─ repositories/ Prisma access, visibility-aware
│  ├─ workers/     one file per queue
│  ├─ lib/
│  │  ├─ db.ts env.ts errors.ts logger.ts redis.ts storage.ts
│  │  ├─ auth/     password.ts session.ts mfa.ts lockout.ts
│  │  ├─ security/ rbac.ts visibility.ts fieldSecurity.ts audit.ts ratelimit.ts
│  │  └─ api/      handler.ts pagination.ts filterTree.ts openapi.ts
│  └─ styles/tokens.css
├─ tests/  unit/ integration/ permission/ tenant/ e2e/
├─ infra/  docker-compose.yml Dockerfile
└─ docs/
```

## 8. Environment variables

```dotenv
# ── Core ────────────────────────────────────────────────
NODE_ENV=production
PROCESS_ROLE=web                      # web | worker
APP_URL=https://app.leadflow.example
PORT=3000

# ── Data ────────────────────────────────────────────────
DATABASE_URL=postgresql://leadflow:pw@postgres:5432/leadflow?schema=public&connection_limit=20
DATABASE_REPLICA_URL=                 # optional read replica for reports
REDIS_URL=redis://redis:6379/0

# ── Secrets (32-byte base64) ────────────────────────────
SESSION_SECRET=
FIELD_ENCRYPTION_KEY=                 # AES-256-GCM for provider/integration configs
WEBHOOK_SIGNING_PEPPER=

# ── Auth ────────────────────────────────────────────────
SESSION_TTL_MINUTES=480
SESSION_IDLE_TIMEOUT_MINUTES=60
MAX_FAILED_LOGINS=5
LOCKOUT_MINUTES=15
ARGON2_MEMORY_KIB=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1
SSO_OIDC_ISSUER=
SSO_OIDC_CLIENT_ID=
SSO_OIDC_CLIENT_SECRET=

# ── Storage ─────────────────────────────────────────────
S3_ENDPOINT=http://minio:9000
S3_REGION=me-central-1
S3_BUCKET=leadflow-documents
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true
SIGNED_URL_TTL_SECONDS=300

# ── Providers (mock by default; change the key to go live) ─
EMAIL_PROVIDER=mock                   # mock | smtp | ses | sendgrid
SMS_PROVIDER=mock                     # mock | twilio | unifonic
WHATSAPP_PROVIDER=mock                # mock | meta_cloud | 360dialog
TELEPHONY_PROVIDER=mock
ANTIVIRUS_PROVIDER=mock
AI_PROVIDER=mock                      # mock | anthropic
AI_API_KEY=

# ── Limits ──────────────────────────────────────────────
API_RATE_LIMIT_PER_MIN=600
EXPORT_MAX_ROWS=500000
IMPORT_CHUNK_SIZE=5000
UPLOAD_MAX_MB=25

# ── Observability ───────────────────────────────────────
LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=
```

## 9. Implementation phases

| Phase | Delivers | Exit criteria |
|---|---|---|
| **1 Foundation** | auth, tenancy, users, roles, permissions, org settings, nav shell, audit | tenant-isolation and permission suites green; every route passes through the API kernel |
| **2 Core CRM** | leads, stages, custom fields, activities, tasks, Smart Views, import/export, duplicates | 1M-row lead grid p95 < 400 ms; 100k-row import completes without lock contention |
| **3 Sales execution** | opportunities, pipelines, accounts, contacts, products, distribution, sales dashboards | distribution simulation matches live assignment on a 10k replay |
| **4 Automation** | graph builder, trigger bus, conditions, actions, waits, retries, execution logs | chaos test: kill a worker mid-enrollment, no duplicate side effects |
| **5 Marketing** | lists, segments, campaigns, email builder, forms, landing pages, attribution | 50k-recipient send completes with per-recipient delivery state |
| **6 Extended ops** | communications, field sales, service, SLA, documents | SLA breach fires within 60 s of deadline under load |
| **7 Analytics & AI** | report builder, dashboard builder, schedules, AI layer | scheduled report delivers; AI output labelled, logged, never auto-sent |

Each phase ships the full Definition of Done: migrations, services, APIs,
authorization, validation, UI states, audit, tests, seed data, documentation.
