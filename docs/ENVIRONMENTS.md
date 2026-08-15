# Environments

One codebase, five environments, five databases. Nothing is shared between them
— not the database, not the secrets, not the seed data.

| Environment | `APP_ENV`     | Database (convention)   | Purpose                                   | Demo seed        |
| ----------- | ------------- | ----------------------- | ----------------------------------------- | ---------------- |
| Development | `development` | `leadflow` (historical) | A laptop. Anything goes.                  | Allowed          |
| Test        | `test`        | `master_saas_test`      | `npm test` / CI. Wiped freely.            | Allowed          |
| Demo        | `demo`        | `master_saas_demo`      | Customer showcase. Realistic, artificial. | **The** use case |
| Staging     | `staging`     | `master_saas_staging`   | Production rehearsal. Real config shape.  | **Refused**      |
| Production  | `production`  | `master_saas_prod`      | Customers. Nothing artificial, ever.      | **Refused**      |

## The declaration: `APP_ENV`

`NODE_ENV` says how the code was **built**; `APP_ENV` says which environment the
deployment **is**. They are different axes — staging and the demo showcase both
run production builds. Every deployed environment sets `APP_ENV` explicitly;
a production build that has not declared one refuses to boot.

## Enforcement (not convention)

These are checks in code, not team habits:

1. **Boot cross-check** (`src/lib/startup-check.ts`): the database name is
   physical evidence of which environment the process is wired to. `APP_ENV=production`
   pointed at a `*_demo` database — or any other mismatch against the
   `_test` / `_demo` / `_staging` / `_prod` name markers — kills the process
   before it serves a request.
2. **Seed guards** (`prisma/seed/index.ts`): the demo seed refuses to run when
   `NODE_ENV=production`, when `APP_ENV` is `production` **or** `staging`, or —
   independently of every declaration — when the target database's *name* marks
   it as production or staging. The third gate exists because the likeliest
   accident is a production connection string pasted into a shell whose
   declarations are still laptop defaults. On top of all three,
   `ALLOW_DEMO_SEED=yes` must be said explicitly, every time.
3. **Role split**: `DATABASE_URL` is the NOBYPASSRLS application role;
   `MIGRATION_DATABASE_URL` is the owning role, used by `prisma migrate` only.
   Boot refuses to start when they are the same string, and verifies at runtime
   that RLS actually applies to the connected role.

## What each database starts with

**Production / staging** start from schema + bootstrap only:

- `prisma migrate deploy` (the full versioned migration history)
- `node scripts/bootstrap-owner.mjs` — the first platform owner (which enrols
  MFA through `/enroll-2fa` on first login; privileged roles cannot skip it)
- Subscription plans and the permission catalogue (`scripts/seed-role-defaults.ts`)
- **No** demo tenants, personas, leads, or simulated calls. If a sales
  demonstration must run against production infrastructure, provision a
  dedicated demonstration *tenant* by hand and mark it as such.

**Demo** starts from the same schema plus `ALLOW_DEMO_SEED=yes npm run db:seed`:
Manath Homes and the Leadersfort workspace, the role personas
(`admin@`/`sales.manager@`/`sales.rep@`/`sdr@`/`account.manager@`/`qa.manager@`/`executive@manathhomes.ae`),
seeded leads/accounts/opportunities/calls/audits/targets/notifications, and the
AI-grounding records. All names and companies are artificial; the shape is
deterministic under `SEED_KEY`, and the password is pinned by `DEMO_PASSWORD`.

## Secrets

Every environment generates its own (`npm run secrets`): database passwords,
`FIELD_ENCRYPTION_KEY`, `WEBHOOK_SIGNING_PEPPER`, provider keys. Nothing is
copied between environments — a demo Gemini key with a spend cap is a different
credential from the production one, and rotating one environment must never
touch another. The boot check refuses placeholder or low-entropy values.

## Migrations

Versioned in `prisma/migrations`, applied with `prisma migrate deploy`, in
order: **staging first, then production**, never hand-edited SQL against a live
database. The deploy order for a release is: apply migrations → deploy
application → validate → clean up. Migrations are written backward-compatible
where practical (add-then-migrate-then-drop across releases) so an application
rollback does not require a schema rollback; where a schema reversal is
genuinely needed, write and stage a *forward* migration that undoes the change —
`migrate deploy` has no down-path, and pretending otherwise on a live database
is how data gets lost.

## Backup and recovery

Production runs automated `pg_dump` (or the platform's native snapshotting)
on a schedule with **30-day retention**, plus WAL archiving where the
infrastructure offers point-in-time recovery. The restore drill:

1. Restore the snapshot to a **new** database instance (never over the live one).
2. `prisma migrate status` against it — the ledger must be clean.
3. Point a staging deployment at it and smoke-test sign-in + one CRM read.
4. Only then repoint production connection strings.

Recordings, uploads and export artifacts live in object storage (S3-compatible),
not in Postgres; they are versioned/lifecycle-managed by the bucket, and the
database backup carries only their metadata. Redis is cache and queue state —
it is *not* backed up; every queue job is re-derivable and idempotent
(`lib/queue.ts` keys jobs deterministically).
