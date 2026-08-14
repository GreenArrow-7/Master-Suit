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
It runs `prisma migrate deploy` as the owning role.

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

## 8. Backups

Nothing here backs itself up. The minimum worth having on day one:

```bash
dc exec -T postgres pg_dump -U leadflow -Fc leadflow > /var/backups/leadflow-$(date +%F).dump
```

Put that in cron, ship the output off the VM (`az storage blob upload`), and
restore it once into a scratch database to prove the dump is real. An untested
backup is a hope, not a control. `docs/BACKUP-RECOVERY.md` covers the fuller
picture, including the MinIO volume, which this command does not touch.

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

## What this deployment is not

Worth being clear about, because the shortcuts are deliberate and each one has a
name:

- **Single point of failure.** One VM. Postgres, Redis and object storage share
  it with the application. There is no failover and no point-in-time recovery —
  only whatever `pg_dump` you scheduled above.
- **Secrets sit in a file.** `.env.production`, mode 600, on the VM. Real secret
  management means Azure Key Vault and injection at start. The file is at least
  never copied into an image.
- **Self-hosted Postgres.** Azure Database for PostgreSQL gives you managed
  backups, PITR and patching. Moving to it changes only `DATABASE_URL` and
  `MIGRATION_DATABASE_URL`, plus running that migration once against it — the
  role model the application requires is the same either way.
- **No metrics, traces or error reporting.** `docker compose logs` is what you
  have.
- **SMS and e-signature do not work.** See step 7.

`docs/KNOWN-LIMITATIONS.md` and `docs/SECURITY-REMEDIATION.md` are the two to
read before this carries anyone's real data.
