# Staging provisioning checklist — for the infrastructure owner

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Purpose | Bring staging into existence so `deploy.yml` can run against the release candidate |
| Release candidate | `63daf3da3fff00366cee9680c520d955e427c0cf` |
| Prepared by | AI agent — **no credential was created, obtained, guessed or printed** |
| Source of truth | `.github/workflows/deploy.yml`, `apps/web/scripts/release.sh`, `apps/web/infra/` |

> Every name below was read out of the workflow and compose sources, not
> assumed. Where the workflow composes a name dynamically, the composition is
> shown so it can be checked rather than trusted.

---

## 0. Read this first — staging is not an empty environment

`apps/web/infra/Caddyfile.staging` states the design intent plainly: staging is
pointed at a **restored production snapshot**, which is what makes it a
deployment *holding real customer data with none of production's operational
attention*. Two consequences, both material:

1. **Provisioning staging exercises the very restore capability `EVC-005` says
   is unproven.** These are not independent blockers. Standing staging up the
   way it is designed *requires* a working production backup/restore. If the
   restore does not work, staging cannot be built as designed.
2. **Staging inherits production's data-protection obligations.** It has no
   public hostname and no certificate on purpose; the only access path is an SSH
   tunnel. Do not "fix" that by giving it a public name.

**Decision required before provisioning** — one of:

| Option | Consequence |
|---|---|
| **A.** Restore a production snapshot into staging, as designed | Satisfies `EVC-005` restore evidence as a by-product. Staging holds real customer data. |
| **B.** Provision staging with seeded/synthetic data | Unblocks the release path sooner, but staging stops being a production rehearsal, and `EVC-005` stays entirely unproven. |

This is an owner's decision, not an engineering default. It is recorded here
rather than chosen.

---

## A. Create the GitHub environment

Repository → Settings → Environments → **New environment** → name it exactly:

```
staging
```

Lowercase. `deploy.yml` uses `environment: ${{ inputs.environment }}`, and the
dispatch input is a choice whose literal value is `staging`.

**Do not add required reviewers to `staging`.** The workflow header is explicit
that this is deliberate — *"a rehearsal nobody can start without a second person
is a rehearsal that stops happening."* Required reviewers belong on
`production`, which does not exist yet either.

Current state, verified with repository admin rights:

```
repos/GreenArrow-7/Master-Suit/environments     -> total_count: 0
repos/GreenArrow-7/Master-Suit/actions/secrets  -> total_count: 0
```

## B. Configure the secrets

`deploy.yml` composes each name as
`secrets[format('DEPLOY_HOST_{0}', inputs.environment)]`, so the suffix is the
literal input value `staging`. **GitHub secret names are case-insensitive on
lookup and the UI stores them uppercase**, so create them uppercase — the
lowercase-suffixed lookup in the workflow resolves them correctly.

| # | Secret | Required? | What it is |
|---|---|---|---|
| 1 | `DEPLOY_HOST_STAGING` | **yes** | the VM's address |
| 2 | `DEPLOY_USER_STAGING` | **yes** | an account in the `docker` group, with the repository checked out at the deploy path and `.env.staging` already present |
| 3 | `DEPLOY_KEY_STAGING` | **yes** | private key whose public half is in that account's `authorized_keys`, restricted to this repository |
| 4 | `DEPLOY_KNOWN_HOSTS_STAGING` | **strongly recommended** | pins the host key |

**Item 4 is absent from the usual three-secret summary and it is a security
control.** Without it the workflow falls back to trust-on-first-use:

```
::warning::No DEPLOY_KNOWN_HOSTS_staging; accepting the host key on first use.
ssh-keyscan -H "$HOST" | tee ~/.ssh/known_hosts
```

The workflow's own comment says pinning is *"what a deployment carrying
production credentials should be doing."* Set it. Obtain the value by running
`ssh-keyscan` against the host from a trusted network and comparing the
fingerprint out of band — not by copying whatever the first run happened to
accept.

### Optional repository/environment **variable** (not a secret)

| Variable | Default if unset | Meaning |
|---|---|---|
| `DEPLOY_PATH_STAGING` | `/opt/master-suite` | where the repository is checked out on the host |

Referenced as `vars[format('DEPLOY_PATH_{0}', inputs.environment)]`. Set it only
if the checkout is not at the default path.

**Do not paste any secret value into chat, a ticket, or a commit.** Verify by
name, and by whether the deploy step gets past its check — never by echoing.

## C. Staging server prerequisites

Derived from `release.sh` and the compose files it composes for staging:
`docker-compose.yml` + `docker-compose.prod.yml` + `docker-compose.staging.yml`.

### Host

| Requirement | Detail |
|---|---|
| OS | Ubuntu. `apps/web/infra/provision-host.sh` brings a bare Ubuntu host to the expected state |
| Provisioning | `sudo infra/provision-host.sh`. Run `sudo PROVISION_CHECK_ONLY=1 infra/provision-host.sh` first — it reports and changes nothing |
| Above the host | the VM, its network security group and DNS are **not** covered by that script; they are an `az` sequence in `docs/DEPLOY-AZURE.md` |
| Container runtime | Docker with the Compose plugin (`docker compose`, not `docker-compose`) |
| Deploy account | in the `docker` group; `authorized_keys` holds the public half of `DEPLOY_KEY_STAGING` |
| Checkout | a git clone at `DEPLOY_PATH` (default `/opt/master-suite`), able to `git fetch --all --tags` from this repository |
| Clean tree | `release.sh` **refuses a dirty tree** — a build from one is not the commit it claims to be |
| State dir | `/var/lib/master-suite` (override `RELEASE_STATE_DIR`), holding the `.current` / `.previous` tag files a rollback trusts |
| Build capacity | images build **on the host** — no registry. Budget **10–20 minutes** per build, plus disk for retained image tags |

### Repository / image access

No registry is used: images are tagged `master-suite/web:<commit>` locally. The
host therefore needs to *build*, which means it needs the source — so the
constraint is git read access to this repository, not a registry pull secret.

> Note for later: `release.sh` records that separate staging and production
> hosts **would** need a registry (push after the staging build, pull before the
> production start). On one VM, promotion is production starting the tag staging
> built. If staging and production end up on different machines, that is a
> change to plan for, not an operational detail.

### Network / firewall / TLS

| Requirement | Detail |
|---|---|
| Inbound | SSH only, from the deploy runner and administrators. `provision-host.sh` takes `SSH_ALLOW_FROM` |
| Public HTTP | **none.** `Caddyfile.staging` sets `auto_https off` and binds `:80` with no site name |
| TLS / certificate | **none, deliberately.** Staging has no public name, so it is not the softest route to restored customer data |
| Access path | SSH tunnel: `ssh -L 8080:127.0.0.1:8080 <user>@<vm>` then `http://localhost:8080` |
| DNS record | not required for staging |

### Services in the staging composition

`postgres`, `redis`, `minio`, `mailpit`, `clamav`, `face`, `web`, `worker`,
`caddy`, `migrate`, `prometheus`, `alertmanager`.

| Concern | Provided by |
|---|---|
| Database | `postgres` (in-compose) |
| Cache / queues | `redis` (in-compose); BullMQ workers in `worker` |
| Object storage | `minio` (in-compose), S3-compatible |
| Mail | `mailpit` — captures mail, does not deliver |
| Antivirus | `clamav` |
| Face sidecar | `face` (`apps/face`) |
| Migrations | a dedicated `migrate` service in the staging overlay |
| Observability | `prometheus` + `alertmanager` |

### Application configuration — `.env.staging`

Must exist on the host at `apps/web/.env.staging`. It is **not** in the
repository and must never be committed. `release.sh` passes it via
`docker compose --env-file`.

Variables referenced by the staging composition, by name only:

```
APP_ENV  BUILD_TIME  IMAGE_TAG
DATABASE_URL  POSTGRES_PASSWORD
REDIS_PASSWORD
S3_ACCESS_KEY_ID  S3_SECRET_ACCESS_KEY
SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASSWORD  EMAIL_FROM
FACE_SERVICE_TOKEN  FACE_SERVICE_TOKEN_PREVIOUS
METRICS_TOKEN
PROMETHEUS_RETENTION
ALERT_EMAIL_FROM  ALERT_EMAIL_TO  ALERT_PAGE_EMAIL_TO
ALERT_SMTP_REQUIRE_TLS  ALERT_WEBHOOK_URL
```

`FACE_SERVICE_TOKEN_PREVIOUS` exists to allow token rotation without downtime —
set it when rotating, leave it empty otherwise.

Generate staging's own values. **Do not copy production secrets into staging**,
whichever data option is chosen in §0 — a restored snapshot needs production
*data*, not production *credentials*.

### Optional host overlay

If the VM is small, `release.sh` applies `infra/docker-compose.small-host.yml`
automatically when that file is present on the host. It is untracked by design
(it describes the machine, not the release): one worker replica instead of two,
Postgres tuned for 4 GB, an intranet Caddyfile. Its absence on a small host
caused a real defect — a promotion that silently scaled workers up and switched
Caddy to a certificate it could not obtain. Decide deliberately whether this
host needs one.

---

## D. After provisioning — the dispatch

Only once §A–§C genuinely exist:

```
gh workflow run deploy.yml \
  -f environment=staging \
  -f action=deploy \
  -f commit=63daf3da3fff00366cee9680c520d955e427c0cf
```

`deploy.yml` preflight independently refuses any commit whose `verify` check run
is not `success` on that exact SHA. `63daf3d` satisfies this (run
`34247053426`). That gate is the workflow's, not this document's — it re-checks.

**Do not deploy** `main`, `latest`, `e620171`, `a04c7e3`, or an uncommitted tree.

## E. First-deploy caveat — there is nothing to roll back to

`release.sh rollback` requires a **previously recorded tag** in the state
directory *and* that tag's image still present on the host. On a freshly
provisioned staging host neither exists, so:

```
No previous tag recorded for staging. Nothing to roll back to.
```

**The first staging deploy has no rollback.** Recovery from a bad first deploy
is re-deploying a known-good commit forward, not rolling back. Schedule the
first deploy for a time when that is acceptable.
