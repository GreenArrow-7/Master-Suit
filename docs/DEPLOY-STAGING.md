# Staging

A second Compose project — its own database, its own secrets, its own object
store — that a release passes through before production. `docs/ENVIRONMENTS.md`
has required that order for migrations since it was written; this is the thing
that makes it true.

Files: `apps/web/infra/docker-compose.staging.yml`,
`apps/web/infra/Caddyfile.staging`, `apps/web/.env.staging.example`,
`apps/web/scripts/check-staging-first.mjs`.

## Why bother

`prisma migrate deploy` has no down-path. A migration that takes a lock it
cannot get on a large table, drops a column something still reads, or fails
halfway through leaves a production database that must be repaired forward,
live, with customers on it. Nothing in the roadmap is cheaper than discovering
that against a copy.

Before this, the mandated order was a sentence in a document. The sentence
survives exactly as long as nobody is in a hurry, and the moment somebody is in
a hurry is the moment it was written for. Now `docker compose ... run --rm
migrate` against production **refuses** to apply a migration that has not
already finished in staging with the same bytes.

## What it is

| | Production | Staging |
| --- | --- | --- |
| Compose project | `infra` (directory name) | `master-suite-staging` (`name:` in the overlay) |
| Overlays | `base + prod + azure` | `base + prod + staging` |
| Database | `leadflow` | `leadflow_staging` |
| `APP_ENV` | `production` | `staging` |
| Reached at | `https://$APP_DOMAIN` (Caddy, ACME) | `http://127.0.0.1:8080` (Caddy, no TLS, SSH tunnel) |
| Mail | real SMTP relay | Mailpit on the host |
| Workers | 2 replicas | 1 replica |
| Published on the host | `:80`, `:443`, `127.0.0.1:9001` | `127.0.0.1:8080`, `:8026`, `:9002`, `:5433` |
| Secrets | `.env.production` | `.env.staging` — **nothing copied between them** |

The two projects share nothing. Compose prefixes volumes and networks with the
project name, which is why `name: master-suite-staging` is at the top of the
overlay and not a nicety: without it, bringing staging up on the production VM
would mount production's `pgdata`.

### Why the database name matters

`src/lib/startup-check.ts` reads the `_staging` marker out of `DATABASE_URL` and
kills the process unless `APP_ENV` says `staging`. That is the only *automatic*
check that these two are different environments — a production connection string
pasted into `.env.staging` does not start, and neither does the reverse.
Renaming `leadflow_staging` to match production's disables it.

### Why it is not on the public internet

The restore drill below points staging at a restored production snapshot, which
is what makes a rehearsal worth running. That makes staging a deployment holding
real customer data with none of production's operational attention, and a public
hostname with a certificate would make it the softest route to that data.

So Caddy here binds `127.0.0.1:8080` and terminates plain HTTP:

```bash
ssh -L 8080:127.0.0.1:8080 -L 8026:127.0.0.1:8026 azureuser@<vm>
# http://localhost:8080   the application
# http://localhost:8026   Mailpit — everything staging "sends"
```

Caddy is still in the stack rather than skipped, because the proxy is part of
what staging rehearses: `TRUSTED_PROXY_CIDRS`, the `X-Forwarded-For` chain that
every rate-limit bucket and every audit row's source address is keyed on, the
32 MB body cap, and the `/api/metrics` block. Reaching web directly on `:3000`
would rehearse a topology production does not have — and would not boot anyway,
because a production build with no declared proxy refuses to start.

## Standing it up

```bash
cd /opt/master-saas/apps/web
cp .env.staging.example .env.staging
chmod 600 .env.staging
node scripts/generate-secrets.mjs .env.staging     # its own keys, not production's
$EDITOR .env.staging                               # passwords, FACE_SERVICE_TOKEN, S3 creds
```

Then, from `apps/web/infra`:

```bash
alias dcs='docker compose --env-file ../.env.staging \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.staging.yml'

dcs up -d postgres redis
dcs run --rm migrate            # plain `prisma migrate deploy` — staging IS first
dcs exec postgres psql -U leadflow -d leadflow_staging \
  -c "ALTER ROLE master_saas_app PASSWORD '<APP_DB_PASSWORD from .env.staging>';"
dcs up -d
dcs ps
```

Same order and the same `ALTER ROLE` step as production, for the same reason:
`20260806000000_rls_force_and_platform_admin` creates `master_saas_app` with a
default password, and the boot check refuses to serve as a role that bypasses
row-level security.

### Footprint

Staging generates its own `REDIS_PASSWORD` along with the rest — `npm run secrets
.env.staging` — and never copies production's. Rotating one environment's
credential must not touch another's.

Two full stacks on one VM means two Postgres, two Redis, two MinIO, two ClamAV
(~2 GB resident each, for the signature database) and two face containers. On
the 4 vCPU / 16 GB VM in `docs/DEPLOY-AZURE.md` that fits, with little room
over. Below that, put staging on its own smaller host — nothing assumes the two
are neighbours except the loopback address in `STAGING_DATABASE_URL`, which
becomes a real hostname when they are not.

## The gate

Add to `apps/web/.env.production`:

```
STAGING_DATABASE_URL=postgresql://leadflow:<staging POSTGRES_PASSWORD>@host.docker.internal:5433/leadflow_staging
```

`5433` is where the staging overlay publishes its Postgres on the host's
loopback; `host.docker.internal` is how the production project's `migrate`
container reaches out through the host gateway, since Compose projects do not
share a network. If staging is on its own VM, put that VM's address here.

Nothing else changes. The production `migrate` service now runs

```
node scripts/check-staging-first.mjs && npx prisma migrate deploy
```

so the enforced path is the path `docs/DEPLOY-AZURE.md` already documents.

### What it compares

Three ledgers: the committed migrations in `prisma/migrations` and their sha256
(which is exactly what Prisma stores as `checksum`), production's
`_prisma_migrations`, and staging's. Anything in the repository that production
has not finished is *pending*, and every pending migration must appear in
staging — finished, not rolled back, and with a checksum matching the file on
disk right now.

It refuses on:

| | Why it matters |
| --- | --- |
| never applied to staging | The rehearsal did not happen |
| rolled back in staging | It failed the rehearsal. Do not carry it forward |
| started in staging, never finished | Usually a lock it could not take; production will not give it one either |
| **edited after staging ran it** | The subtle one — see below |
| `STAGING_DATABASE_URL` unset | "No staging" must be a decision, not a default |

The fourth is the one worth spelling out. A migration rehearsed in staging and
then edited before the production rollout would be applied by Prisma without
complaint: the checksum Prisma compares against lives in *production's* ledger,
which has no row for that migration yet. What production runs would be SQL that
has never executed anywhere. This is the only check that catches it.

It warns, without refusing, when staging has applied something this checkout
does not carry — a migration run there from an uncommitted branch. It cannot
reach production, but it means the rehearsal ran against a schema this release
cannot reproduce.

### The escape hatch

A deployment with no staging still has to be able to migrate, so `check-staging-
first.mjs` takes `ALLOW_UNSTAGED_MIGRATION=yes`, in the same say-it-out-loud
idiom as `ALLOW_DEMO_SEED` and `TRUSTED_PROXY_CIDRS=none`. It prints what that
means every time and never turns itself off silently because a variable happens
to be unset.

## Releasing

```bash
cd /opt/master-saas && git pull

apps/web/scripts/release.sh staging       # 1. build this commit, migrate, start
#    exercise it: sign in, one CRM read, whatever the release touches
apps/web/scripts/release.sh production    # 2. promote — gated
```

Step 2's migrate is where the staging-first gate fires. If step 1 was skipped, or
a migration was edited between the two, it exits 1 and nothing is applied.

**The gate covers migrations; `release.sh` covers the image.** Step 2 with no
argument does not choose a commit — it takes the tag staging is running, and
because both Compose projects share one Docker daemon on this VM it starts *that
image* rather than building its own copy of the same source. So "staging first"
means the same bytes, not merely the same branch name.

On separate hosts that needs a registry: push after the staging build and pull
before the production start. The tag scheme (`master-suite/web:<commit>`) does not
change, and neither does anything else here.

`scripts/release.sh status` lists what each environment is on and which images
are still startable. Rollback is `scripts/release.sh rollback <environment>`, and
it deliberately does not roll the database back — see `docs/DEPLOY-AZURE.md`.

## Restoring production data into staging

This is what makes staging worth having — a migration meets production-shaped
data before production does.

Two steps, and they are different operations. `scripts/restore-verify.sh` proves
a backup is restorable; it does its work in a scratch `*_restorecheck` database
and drops it, so it never leaves data behind. Loading the snapshot into
staging's live database is the second step.

```bash
cd apps/web
# 1. Prove the backup restores at all — six checks, then it cleans up after itself.
DC="docker compose --env-file ../.env.staging \
  -f infra/docker-compose.yml -f infra/docker-compose.prod.yml -f infra/docker-compose.staging.yml" \
PG_DB=leadflow_staging \
  scripts/restore-verify.sh /var/backups/master-suite/<stamp>

# 2. Replace staging's database with it.
cd infra
dcs stop web worker                     # nothing connected while the database is replaced
dcs exec -T postgres psql -U leadflow -d postgres \
  -c 'DROP DATABASE leadflow_staging' \
  -c 'CREATE DATABASE leadflow_staging OWNER leadflow'
dcs exec -T postgres pg_restore -U leadflow -d leadflow_staging \
  < /var/backups/master-suite/<stamp>/database.dump
dcs start web worker
```

`pg_restore` here is deliberately **plain** — no `--no-owner`, no
`--no-privileges`. Both roles exist in this cluster under the same names, so the
dump carries ownership, the `master_saas_app` grants, every RLS policy and its
`FORCE` flag across intact. Stripping them would restore a schema the
application role cannot read a row of. Verified on a real snapshot: 175
tenant-owned tables came across still enabled, forced and policied
(`RLS_DATABASE_URL=... node scripts/check-rls.mjs` is the way to confirm it on
yours).

The `_prisma_migrations` ledger comes across too, which is exactly what the gate
wants: staging's ledger now matches production's, so the pending set for the
next release is precisely what needs rehearsing.

Two things to understand before doing any of this:

- **Encrypted columns do not survive the trip.** `FIELD_ENCRYPTION_KEY` is
  different here — deliberately — so restored authenticator secrets will not
  verify and enrolled second factors in the restored data are dead. That is
  correct: a restored staging must not be a way to sign in as a customer.
  Re-enrol the accounts you need (`scripts/owner-mfa.mjs`). Never paste
  production's key in to "make the restore work"; that turns staging into a
  second place production's plaintext can be recovered from.
- **Mail and object storage are pointed elsewhere on purpose.** Staging's
  `SMTP_HOST` is Mailpit and its `S3_BUCKET` is its own, so a notification job
  cannot mail real customers from a rehearsal and a retention sweep cannot
  delete production's recordings. The restored rows will reference objects that
  are not in staging's bucket; a document download 404s there, and that is the
  correct trade.

## Monitoring it

This project runs its own Prometheus and Alertmanager — `docker-compose.staging.yml`
clears the `observability` profile the same way `docker-compose.azure.yml` does,
so bringing staging up brings its monitoring up with it. They are on loopback,
one port above production's:

```bash
ssh -L 9091:127.0.0.1:9091 -L 9094:127.0.0.1:9094 azureuser@<vm>
# http://localhost:9091/alerts   — Prometheus, what is firing and why
# http://localhost:9094          — Alertmanager, what was grouped and sent
```

`infra/prometheus-alerts.yml` applies unchanged, and every alert this project
raises carries `environment="staging"` — that label is the whole reason
Prometheus is given `APP_ENV`. A staging deployment firing `QueueHasNoConsumer`
or `TenantGuardTripped` before production does is the entire point of having one.

Alerts are delivered into **Mailpit**, on `127.0.0.1:8026`, not to a person. The
notification is composed, grouped, routed and sent for real — it just lands
where a rehearsal belongs. Two settings make that work and both are in
`docker-compose.staging.yml` rather than in the env file, because
`environment:` outranks `env_file:` and a value copied over from
`.env.production` would otherwise win: `SMTP_HOST: mailpit`, and
`ALERT_SMTP_REQUIRE_TLS: 'false'` because Mailpit offers no STARTTLS. Left at the
default, every alert would fail to deliver and Alertmanager would log the
failure rather than raise one — the quietest possible way for monitoring to be
broken.

See `docs/OBSERVABILITY.md`.

## What this is not

- **Not a load rehearsal.** One worker replica, a shared VM, and a database
  competing with production's for the same page cache. It tells you a migration
  applies and a release runs; it tells you nothing about how either performs.
- **Not a canary.** Traffic is never split between the two. Staging is exercised
  by hand or by `tests/e2e`, and then production is deployed whole.
- **Not automatic.** There is no pipeline that promotes staging to production on
  green. The gate refuses a promotion that skipped staging; it does not perform
  the promotion.
