# Master Suite

A multi-tenant CRM and HR platform: sales execution, call intelligence, HR and
payroll for one workspace per customer, in one Next.js application. Original
branding, interface, wording and source code.

<!-- schema-stats:start -->

202 models · 107 enums · 440 indexes · 103 unique constraints
<!-- schema-stats:end -->

_(generated — `node scripts/schema-stats.mjs --write`, checked in CI)_

## Getting started

```bash
npm install
cp .env.example .env && node scripts/generate-secrets.mjs .env
npx prisma migrate deploy
ALLOW_DEMO_SEED=yes npm run db:seed     # demo workspace, personas, sample data
npm run dev                             # and, in a second shell:
npm run worker                          # the queue consumers
```

`SETUP.md` has the longer version, including the two database roles the
application requires and why it refuses to start without them. `npm run worker`
is not optional in any environment that expects a call to be transcribed, a lead
to be distributed or an SLA to escalate — the web process enqueues, and nothing
else drains.

## How it is put together

One Next.js 16 application, not a frontend and a backend. Server components
render every screen, route handlers under `/api/v1` serve every mutation, a
services layer holds the business rules, and a second process of the same image
drains BullMQ queues. One PostgreSQL database holds every workspace.

|                        |                                                                             |
| ---------------------- | --------------------------------------------------------------------------- |
| `src/app/(workspace)/` | Every customer-facing screen, server-rendered                               |
| `src/app/(platform)/`  | The control plane: workspaces, plans, platform users                        |
| `src/app/api/v1/`      | The API. `lib/api/handler.ts` is the kernel every route goes through        |
| `src/services/`        | Business rules. Routes validate and delegate; nothing here knows about HTTP |
| `src/lib/`             | Auth, the Prisma client and its tenant guard, security, queues, AI, storage |
| `src/workers/`         | The queue consumers, and the schedulers that arm them                       |
| `prisma/`              | Schema and the full migration history                                       |
| `infra/`               | Compose stacks for local, staging and production; Caddy; the Dockerfile     |
| `tests/`               | Vitest (unit and integration) and Playwright (`tests/e2e`)                  |

## Tenant isolation, three times over

The property the product rests on, enforced independently at three layers:

1. **Repository** — every query carries `ctx.tenantId`.
2. **Prisma client extension** (`lib/db.ts`) — a query without a tenant filter
   throws rather than reaching the database, and the trip is counted as a metric
   worth paging on.
3. **PostgreSQL** — `FORCE ROW LEVEL SECURITY` on every tenant-owned table, with
   `app.tenant_id` set transaction-locally so it cannot leak to the next borrower
   of a pooled connection.

The application connects as a `NOBYPASSRLS` role that owns nothing, and
`lib/startup-check.ts` refuses to serve if that is ever untrue —
because a table owner bypasses every policy in the schema without any role
attribute saying so. `scripts/check-rls.mjs` is a CI gate over the live catalog.

## What runs the checks

```bash
npm run verify           # every gate CI runs, in CI's order
npm run verify -- --fast # the same, without the two slowest
npm run verify -- --list # the plan, running nothing
```

`.github/workflows/ci.yml` is the authority, and `scripts/verify.mjs` reads its
steps rather than keeping a copy of them — so a gate added to CI either runs
here too or forces somebody to write down why it cannot. There are fifteen of
them; this list used to name five and claim that was all of them, which is how
`prettier --check` came to be the thing CI failed on.

Four are worth knowing individually, because they are the ones that fail for
reasons a test cannot express:

```bash
node scripts/check-rls.mjs             # every tenant table enabled, forced and policied
node scripts/check-raw-sql-scope.mjs   # raw SQL against those tables is inside a transaction
npm run check:drift                    # schema.prisma and the migrations still agree
npm run test:e2e                       # playwright, against a production build — not in `verify`
```

## Where the documentation is

- `docs/00-ARCHITECTURE.md` — the design, module by module
- `docs/ARCHITECTURE-NETWORK-ASSESSMENT-R3.md` — the current assessment of what
  is actually built, with its weaknesses and a prioritised roadmap. Start here
  if you want the honest version. `-R2.md` and the unsuffixed original are the
  two earlier readings, left as written so the three can be read as a sequence
- `docs/KNOWN-LIMITATIONS.md` — what is deliberately not finished
- `docs/ENVIRONMENTS.md` — the five environments and what separates them
- `docs/DEPLOY-AZURE.md`, `docs/DEPLOY-STAGING.md` — running it
- `docs/BACKUP-RECOVERY.md` — backups, and proving one restores
