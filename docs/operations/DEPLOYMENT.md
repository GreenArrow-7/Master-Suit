# Deployment

Current mechanism as visible in the repository. Nothing was executed.
Authoritative runbooks: `docs/DEPLOY-AZURE.md` (2026-08-21) and
`docs/DEPLOY-STAGING.md` (2026-08-20). `docs/DEPLOYMENT.md` (root, 15 lines,
2026-08-05) is superseded by them and by this file — evidence conflict
**EVC-003**. The active production mechanism itself is
`UNKNOWN — requires runtime/infrastructure verification`.

## Build

- `npm run build` → `next build` (standalone output). CI runs it on Node 24
  after every other gate. E2 `package.json`, `ci.yml` step "Build".
- Container: `infra/Dockerfile` multi-stage on `node:22-alpine` — `deps`
  (`npm ci`), `build` (`prisma generate` + `next build` with placeholder env),
  `production` (standalone copy, non-root `leadflow` uid 1001,
  `BUILD_COMMIT`/`BUILD_TIME` from build args), plus a worker target and a
  `development` stage. E2.

## Artifact

- On the VM: images `master-suite/web:<commit>` and
  `master-suite/worker:<commit>` built by `scripts/release.sh` and kept in
  the daemon's image store; `release.sh status` lists them. E1.
- In the registry: `build-images.yml` (manual) builds the same targets for
  an exact SHA and pushes `ghcr.io/<repo>/web:<sha>` and `worker:<sha>`
  (`provenance: false`, OCI revision label). Nothing in the repository pulls
  these images during a deploy — the host builds locally (`release.sh`).
  Registry path = INFERRED future use, not the current release path
  (**EVC-012**).

## Containers (production composition, E2)

`docker-compose.yml` (postgres, redis, minio, mailpit, clamav, prometheus,
alertmanager) + `docker-compose.prod.yml` (web on `127.0.0.1:3000`, worker,
healthchecks, `restart: unless-stopped`) + `docker-compose.azure.yml` (caddy
80/443, `migrate` tools-profile service running
`check-staging-first.mjs && prisma migrate deploy`, face, ports reset to
internal, `mailpit` retained). Logging: json-file 10 MB × 5 per container.
Prometheus/Alertmanager render config into tmpfs via entrypoint scripts.

## CI/CD

- `ci.yml` — on push to `main` and pull requests; one `verify` job:
  `npm ci` → generate `.env` → migrate deploy → schema drift → tenant
  isolation → raw SQL scope → seed → typecheck → lint → format check → README
  schema counts → observability drift → Redis auth → face token gate →
  backup round trip → unit `vitest run` → server integration → Playwright
  e2e (push, or PRs targeting `main`) → build → `npm audit --omit=dev
  --audit-level=high`. E2.
- `deploy.yml` — `workflow_dispatch` with inputs `environment`
  (staging|production), `action` (deploy|rollback), optional `commit`.
  `preflight` resolves the commit and, for `deploy`, refuses one whose
  `verify` check run is not `success` (`gh api …/check-runs`). `deploy` runs
  under `environment: <env>` (GitHub environment protection — reviewers
  `UNKNOWN`), checks `DEPLOY_HOST/USER/KEY_<ENV>` exist, opens SSH (pins the
  host key only if `DEPLOY_KNOWN_HOSTS_<ENV>` is set), runs
  `scripts/release.sh <env> [commit]` or `release.sh rollback <env>` in
  `DEPLOY_PATH_<ENV>` (default `/opt/master-suite`), prints what is running,
  forgets the key. Concurrency group per environment. E2.
- `build-images.yml` — manual, exact-SHA guard, GHCR push, step summary
  with digests. E2.
- Branch protection / required checks: `UNKNOWN — requires
  runtime/infrastructure verification` (GitHub settings are not in the
  repository).

## Server startup and deployment sequence (E1 `scripts/release.sh`)

```text
release.sh staging            # build this commit's images (tag = commit), run migrate
                              # profile, `up -d`, record staging.current/.previous
# exercise staging
release.sh production         # takes the tag staging is running; starts that image
                              # (no rebuild), runs migrate (staging-first gate), `up -d`,
                              # records production.current/.previous
release.sh production <sha>   # explicit commit
release.sh rollback <env>     # `up -d --no-build` with <env>.previous; DB untouched
release.sh status             # current/previous per env + images on the host
```
Post-deploy confirmation the script prints: `curl -H "Authorization: Bearer
$METRICS_TOKEN" http://web:3000/api/metrics | grep build_info`.

Host provisioning: `infra/cloud-init.yaml` (packages docker.io,
docker-compose-plugin, git, ufw; marker file) and `infra/provision-host.sh`
(idempotent, `PROVISION_CHECK_ONLY=1` report mode, `SSH_ALLOW_FROM`). VM,
NSG and DNS creation remain `az` commands in `docs/DEPLOY-AZURE.md` (E4).
Backup schedule installation: `scripts/install-backup-schedule.sh` →
`infra/systemd/*`. E2.

## What is not in the repository (E6)

Currently deployed commit, host OS state, whether `face`/`clamav`/`pgbouncer`
run, TLS certificate status, GitHub environment reviewers, DNS. All
`UNKNOWN — requires runtime/infrastructure verification`.

## Evidence Sources

E1: `apps/web/scripts/release.sh`, `scripts/check-staging-first.mjs`,
`src/instrumentation.ts`, `src/lib/startup-check.ts`.
E2: `apps/web/infra/Dockerfile`, `infra/docker-compose*.yml`,
`infra/Caddyfile*`, `infra/cloud-init.yaml`, `infra/provision-host.sh`,
`infra/systemd/*`, `.github/workflows/{ci,deploy,build-images}.yml`,
`package.json`.
E4: `docs/DEPLOY-AZURE.md`, `docs/DEPLOY-STAGING.md`, `docs/DEPLOYMENT.md`
(superseded).
