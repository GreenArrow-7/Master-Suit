# Deploying to a single Azure Ubuntu VM

This is the runbook for the deployment you already have half-built: an Ubuntu VM
with Docker, and the repository cloned to `/opt/master-saas`. Everything runs in
one Compose project on that VM — application, worker, Postgres, Redis, MinIO,
ClamAV, the face service, and Caddy in front holding the certificate.

`docs/DEPLOYMENT.md` describes the shape of a *managed* production estate, and
that document is still right about what a commercial deployment eventually
needs. This one gets a working, TLS-terminated, tenant-isolated deployment onto
a single machine. Read "What this deployment is not" at the end before you put
customer data in it.

## Before you start

**Sizing.** 4 vCPU / 16 GB is comfortable; 2 vCPU / 8 GB is the floor and the
image build will be slow on it. Budget 60 GB of disk: ClamAV's signature set and
the face models are several hundred megabytes each before any data.

**DNS.** Point an A record at the VM's public IP and let it propagate *before*
the first start. Caddy gets its certificate over HTTP-01, and that fails against
a name which does not yet resolve here.

**Network security group.** Inbound 80 and 443 from the internet, 22 from your
own address only. Nothing else — no rule for 5432, 6379 or 9000. The Compose
overlay publishes no database port to the host at all, but an NSG rule for one
is a standing invitation to a future misconfiguration.

```bash
az network nsg rule create -g <rg> --nsg-name <nsg> -n allow-http --priority 100 --destination-port-ranges 80 443 --access Allow --protocol Tcp
```

## 1. Docker Compose plugin

Docker 29 is already installed. Confirm the Compose plugin came with it — the
overlay uses `!reset` and `!override`, which need Compose v2.24 or newer:

```bash
docker compose version
```

If that errors, install the plugin:

```bash
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
```

## 2. Configuration

```bash
cd /opt/master-saas/apps/web
cp .env.production.example .env.production
chmod 600 .env.production
node scripts/generate-secrets.mjs .env.production
```

If Node is not installed on the host, generate the two keys with Docker instead
and paste them in:

```bash
docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then edit `.env.production` and set, at minimum:

| Key | Notes |
| --- | --- |
| `APP_DOMAIN`, `APP_URL`, `ACME_EMAIL` | Your hostname, and the address Let's Encrypt mails on renewal failure. |
| `POSTGRES_PASSWORD` | Owning role. Read only when the data volume is empty — see step 4. |
| `APP_DB_PASSWORD` | Application role. Must match the password inside `DATABASE_URL`. |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | Two different roles. This is enforced at boot. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Also become the MinIO root credentials. |
| `SMTP_*`, `EMAIL_FROM` | Real SMTP. Not optional — see step 7. |
| `FACE_SERVICE_TOKEN` | Any long random string. |
| `PLATFORM_OWNER_EMAIL` | The first owner account. |

`TRUSTED_PROXY_CIDRS` is already set to `172.16.0.0/12`, which covers Docker's
default address pools and therefore Caddy. Leave it unless you have moved Docker
onto a custom subnet.

## 3. Build

```bash
cd /opt/master-saas/apps/web/infra
alias dc='docker compose --env-file ../.env.production -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.azure.yml'
dc build
```

Keep that alias for the session; every command below assumes it. Ten to twenty
minutes on a 2-vCPU VM.

The build needs no `.env` — `infra/Dockerfile` supplies throwaway values on the
`npm run build` line, because `next build` evaluates the configuration schema in
`src/lib/env.ts` while it collects page data. `.env*` is dockerignored, so no
real secret is ever written into an image layer.

## 4. Database, roles and schema

Order matters here. Start Postgres alone first, because `POSTGRES_PASSWORD` is
read only when the data volume is empty — if you have already started this stack
once with a different password, the value in `.env.production` is now silently
ignored, and you must either `ALTER ROLE leadflow PASSWORD ...` by hand or
`docker volume rm infra_pgdata` and begin again.

```bash
dc up -d postgres redis
dc run --rm migrate
```

`migrate` is a one-off container built from the Dockerfile's `build` stage: the
production image contains only the standalone server, with no Prisma CLI in it.
It runs `scripts/check-staging-first.mjs` and then `prisma migrate deploy` as the
owning role.

**The first run will refuse.** `check-staging-first.mjs` enforces the order
`docs/ENVIRONMENTS.md` requires — staging first, then production — and exits 1
when `STAGING_DATABASE_URL` is unset, rather than treating an absent variable as
permission. Either stand staging up (`docs/DEPLOY-STAGING.md`, about twenty
minutes) and set:

```
STAGING_DATABASE_URL=postgresql://leadflow:<staging password>@host.docker.internal:5433/leadflow_staging
```

or decide out loud that this deployment has no staging:

```
ALLOW_UNSTAGED_MIGRATION=yes
```

Both go in `.env.production`. The second means every migration in every release
meets production-shaped data for the first time in production, and
`migrate deploy` has no down-path — so a migration that takes a lock it cannot
get, or drops a column something still reads, is repaired forward, live, with
customers on it.

Migration `20260806000000_rls_force_and_platform_admin` creates the
`master_saas_app` role, grants it, and marks every tenant table FORCE ROW LEVEL
SECURITY. It sets that role's password to `master_saas_app` unless told
otherwise, so set the real one now:

```bash
dc exec postgres psql -U leadflow -d leadflow \
  -c "ALTER ROLE master_saas_app PASSWORD '<APP_DB_PASSWORD from .env.production>';"
```

Verify the role is what the application requires — this is the single most
common reason a first deployment refuses to start:

```bash
dc exec postgres psql -U leadflow -d leadflow \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('leadflow','master_saas_app');"
```

`master_saas_app` must show `f` and `f`. If it shows `t` for either, the boot
check will exit the container rather than serve traffic with row-level security
silently disabled.

## 5. Start

```bash
dc up -d
dc ps
```

ClamAV downloads several hundred megabytes of signatures on first boot and its
health check allows ten minutes for it. Document upload fails until it is
healthy. The face service downloads roughly 275 MB of models on the same
schedule. Both are one-time.

Watch the application come up:

```bash
dc logs -f web
```

**Then check the worker, every time.** Nothing depends on it, so `dc ps` reports
a healthy stack whether or not it is consuming anything — which is how this
deployment ran for months with every queue dead:

```bash
dc logs worker | grep 'workers started'
```

That line must appear and must list nine queues:

```
"queues":["automation","distribution","sla","media","ai","notifications","campaign","webhook","maintenance"]
```

If it is absent the container has exited; `dc logs worker` will say which queue
could not attach. The process now exits non-zero rather than idling, so a
persistent failure shows as a restart loop instead of silence. Without this
container: Facebook leads are stored and never become leads, every AI analysis
stays PENDING, call recordings never leave the vendor's servers, SLA timers
never fire, approval emails are never sent, and nothing enforces any retention
window.

A refusal from `[startup]` is deliberate and names its own cause. The four you
might hit:

- **mock providers configured** — one of the provider keys still says `mock`.
- **TRUSTED_PROXY_CIDRS is empty / "none"** — the app cannot attribute a request
  to a client, so per-IP rate limiting would collapse into one shared bucket.
- **role is a superuser / has BYPASSRLS** — `DATABASE_URL` is pointing at the
  owning role. Go back to step 4.
- **DATABASE_URL and MIGRATION_DATABASE_URL are the same connection** — the
  overlay blanks the migration URL for the web container, so this means
  something is overriding it.

## 6. The first owner

The demo seed refuses to run when `NODE_ENV` is production — pointed at a live
database it is a mass insert of fictional people with working logins. Create the
owner account instead:

```bash
dc run --rm migrate node scripts/bootstrap-owner.mjs
```

It prints a temporary password once. Sign in at `https://<APP_DOMAIN>/login`.

One thing to know: a Platform Owner with no workspace membership has no
self-service password change screen — that form lives inside a workspace. So
either create your first workspace and add yourself to it, or use the
forgot-password flow, which needs the SMTP settings in the next step. Until you
do one of those, the printed password is the account's password.

## 7. Providers, honestly

Every key in `PROVIDER_KEYS` is checked at boot and the process exits if any of
them still reads `mock`. What is behind them varies, and the boot check cannot
tell the difference:

| Setting | State |
| --- | --- |
| `EMAIL_PROVIDER=smtp` | Real (nodemailer). Configure it — password resets are undeliverable otherwise. |
| `ANTIVIRUS_PROVIDER=clamav` | Real, and running in this stack. |
| `TELEPHONY_PROVIDER=hmac` | Real. |
| `WHATSAPP_PROVIDER=meta` | Real (Meta Cloud API), configured per tenant in the integrations UI. |
| `SMS_PROVIDER`, `ESIGNATURE_PROVIDER`, `AI_PROVIDER` | **No adapter exists.** |

For the last three, `src/lib/integrations/*.ts` has a `switch` with a `mock` case
and a commented placeholder where a vendor would go. Any non-`mock` value gets
past the boot check and then throws `Unknown provider` the first time the feature
is used — so SMS and e-signature are effectively unavailable, not merely
unconfigured. The example file sets them to `unconfigured` to make that visible
rather than pretending. Implement the adapter before promising either to a
tenant.

### `SMTP_HOST` had to be restated in the Azure overlay

Worth knowing about, because the symptom was invisible. `docker-compose.prod.yml`
sets `SMTP_HOST: mailpit` in its `environment:` block — correct for the local
production-build rehearsal in `docs/PERFORMANCE.md`, which is the only stack that
runs that overlay on its own. But `environment:` outranks `env_file:`
unconditionally, so on this deployment that value won over whatever
`.env.production` said, and every password-reset mail, invitation and
notification was delivered into a Mailpit container on the VM and never left it.

Nothing failed. The transport is real, the send succeeds, the audit row records a
delivered message; the only symptom is customers who never receive the reset
link, which reads as flaky email rather than as a misconfiguration — and a
locked-out account has no other way back in.

`docker-compose.azure.yml` now restates `EMAIL_PROVIDER`, `SMTP_HOST` and
`SMTP_PORT` from `.env.production`, with `SMTP_HOST` marked required, so a
deployment with no relay configured refuses to start instead of swallowing its
own mail. Confirm yours with:

```bash
dc config | grep -A1 SMTP_HOST
```

## 8. Backups

Nothing here backs itself up, and **two** stores hold customer data: PostgreSQL,
and the MinIO bucket holding every call recording, HR document and biometric
capture. The database carries only their metadata — restore it alone and you get
rows pointing at files that are gone.

The `pg_dump` one-liner that used to be here covered the first and not the
second, which meant every recording and document on this VM existed in exactly
one place. `scripts/backup.sh` takes both:

```bash
cd /opt/master-saas/apps/web/infra
BACKUP_PASSPHRASE='<from your secret store>' ../scripts/backup.sh /var/backups/master-suite
az storage blob upload-batch -d master-suite-backups -s /var/backups/master-suite/<stamp>
```

On a schedule — installed rather than documented, because a cron line in a
runbook is a suggestion somebody once wrote down:

```bash
sudo /opt/master-saas/apps/web/scripts/install-backup-schedule.sh /var/backups/master-suite
$EDITOR /etc/master-suite/backup.env      # set BACKUP_PASSPHRASE
systemctl start master-suite-backup.service   # take one now and watch it
```

Three timers, all `Persistent=true` so a VM that was off during the window runs
at the next boot rather than skipping the day in silence:

| Timer | When | What |
| --- | --- | --- |
| `master-suite-backup` | 02:30 daily | database + bucket, encryption **required** |
| `master-suite-restore-verify` | Sun 04:00 | restores `latest` into a scratch database and reconciles it |
| `master-suite-backup-status` | 09:00 daily | fails if the newest complete backup is over 48h old |

02:30 is half an hour before the maintenance worker's retention sweep at 03:00,
so a backup always precedes the deletions you would need it to undo. Retention
is 30 days, pruned by `backup.sh` after a successful run, with a floor of three
backups kept whatever their age — an age-only rule would delete everything you
had left on the day you noticed the schedule had broken.

The third timer is there because the first two cannot report the failure that
matters most. A backup that *stops firing* — masked unit, disabled timer, host
off, clock moved — produces no failed service, because no service ran. So after
this, one command answers "are we backed up?":

```bash
systemctl --failed
```

An untested backup is a hope, not a control — see `docs/BACKUP-RECOVERY.md` for
what each check catches, for the retention rules, and for the full restore
procedure.

## Updating

```bash
cd /opt/master-saas && git pull
cd apps/web/infra
dc build
dc run --rm migrate
dc up -d
```

Migrations run before the new image starts, which is the correct order for
additive migrations. A migration that drops or renames a column is not safe this
way — the old container is still serving during it.

`dc run --rm migrate` is also the gate: it refuses any migration that has not
already finished against staging with the same checksum. Deploy the same commit
to staging first (`docs/DEPLOY-STAGING.md`), or the step exits 1 and applies
nothing.

## What this deployment is not

Worth being clear about, because the shortcuts are deliberate and each one has a
name:

- **Single point of failure.** One VM. Postgres, Redis and object storage share
  it with the application. There is no failover and no point-in-time recovery —
  only the daily backup you scheduled above, which means the worst case is
  losing up to a day of work.
- **Secrets sit in a file.** `.env.production`, mode 600, on the VM. Real secret
  management means Azure Key Vault and injection at start. The file is at least
  never copied into an image.
- **Self-hosted Postgres.** Azure Database for PostgreSQL gives you managed
  backups, PITR and patching. Moving to it changes only `DATABASE_URL` and
  `MIGRATION_DATABASE_URL`, plus running that migration once against it — the
  role model the application requires is the same either way.
- **Metrics yes, traces and error reporting no.** `GET /api/metrics` serves
  Prometheus exposition — request rate and latency by module, error rate by code,
  queue depth, backlog age and consumer count per queue, AI tokens by feature,
  and the tenant-guard trip counter. `infra/prometheus-alerts.yml` has eight
  rules, each corresponding to a failure this deployment has actually had. Set
  `METRICS_TOKEN` (`node scripts/generate-secrets.mjs` fills it in) and point a
  scraper at `web:3000` on the compose network — Caddy blocks the path from the
  public interface. What is still missing: distributed tracing, a stack-trace
  reporter, and log shipping. `pino` writes structured JSON to stdout; nothing
  collects it, so it still dies with the container.
- **SMS and e-signature do not work.** See step 7.

`docs/KNOWN-LIMITATIONS.md` and `docs/SECURITY-REMEDIATION.md` are the two to
read before this carries anyone's real data.
