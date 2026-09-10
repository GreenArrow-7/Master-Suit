# SPEC-0008 — Implementation patches, prepared but NOT applied

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Prepared | 2026-09-09, against `origin/dev/yourhan-next` at `98fa066` |
| Applied | **no** — gate 5 is `HOLD` |

**Nothing here is applied.** `.github/workflows/*` and `apps/web/scripts/release.sh`
are `R5` under `docs/RISK_CLASSIFICATION.md`, and gate 5 implementation readiness
is `HOLD`. This document exists so that when gate 5 is granted the application is
mechanical and reviewable rather than exploratory, and so that a reviewer can see
the whole blast radius before approving it.

Every line number is against the commits named above and must be re-checked
before applying; two of these files are edited by other workstreams.

---

## Patch 1 — `deploy.yml` will not accept `demo`

**File:** `.github/workflows/deploy.yml` · **line 48** · **R5**

```yaml
-        options: [staging, production]
+        options: [staging, production, demo]
```

One line. Without it the workflow cannot be dispatched for this environment at
all, so **this must land before the GitHub environment and its secrets are
created** — otherwise the result is a fully configured environment nothing can
target.

Everything else in `deploy.yml` is already environment-generic: it builds every
secret name by interpolating the input (`DEPLOY_HOST_{0}` at line 136 and so on),
so no other edit is needed there.

## Patch 2 — `release.sh` has no `demo` case

**File:** `apps/web/scripts/release.sh` · **R5, shared by all environments**

Four edits, all additive. `REG-001` is mandatory because staging and production
run the same file.

**2a. `dc_for()`, after line 77.** The demo stack takes its own env file and its
own overlay, and deliberately **not** `host_overlay()` — that function selects
`docker-compose.small-host.yml`, which is production's.

```sh
     production)
       echo "docker compose --env-file ${APP_DIR}/.env.production -f ${INFRA}/docker-compose.yml -f ${INFRA}/docker-compose.prod.yml -f ${INFRA}/docker-compose.azure.yml$(host_overlay)" ;;
+    demo)
+      echo "docker compose --env-file ${APP_DIR}/.env.demo -f ${INFRA}/docker-compose.yml -f ${INFRA}/docker-compose.prod.yml -f ${INFRA}/docker-compose.demo.yml" ;;
```

**2b. The error text, line 78.**

```sh
-    *) fail "Unknown environment '$1'. Use staging or production." ;;
+    *) fail "Unknown environment '$1'. Use staging, production or demo." ;;
```

**2c. Usage strings, lines 110 and 132.**

```sh
-  ENVIRONMENT="${2:?usage: release.sh rollback <staging|production>}"
+  ENVIRONMENT="${2:?usage: release.sh rollback <staging|production|demo>}"
...
-ENVIRONMENT="${1:?usage: release.sh <staging|production|rollback|status> [commit]}"
+ENVIRONMENT="${1:?usage: release.sh <staging|production|demo|rollback|status> [commit]}"
```

**2d. The `status` loop, around line 141.** It reads `current_file staging`; it
should report demo alongside the others. Exact shape depends on the loop as it
stands at application time.

### 2e — the one that is not cosmetic: demo must **fail closed**, never build

**Lines 183-189** currently read:

```sh
if docker image inspect "master-suite/web:${TAG}" >/dev/null 2>&1; then
  say "image master-suite/web:${TAG} already exists — promoting it, not rebuilding"
else
  say "building master-suite/{web,worker}:${TAG} ..."
  ${DC} build
fi
```

For `demo` the `else` branch is **wrong and must be unreachable**. `AD` records
that the demo host never builds the application; if the image is absent the
deployment fails rather than producing a host-local artefact that no registry
can vouch for. The guard has to be environment-aware:

```sh
if docker image inspect "master-suite/web:${TAG}" >/dev/null 2>&1; then
  say "image master-suite/web:${TAG} already exists — promoting it, not rebuilding"
elif [ "${ENVIRONMENT}" = 'demo' ]; then
  fail "master-suite/web:${TAG} is not on this host. The demo environment never builds;
        the image is pulled from the registry by the deployment workflow. Absent image
        means the wrong SHA was dispatched or the pull step failed."
else
  say "building master-suite/{web,worker}:${TAG} ..."
  ${DC} build
fi
```

**This is the single most important line in the patch set.** Without it a demo
deployment silently falls back to building on the host, which defeats immutable
images and would put a compiler and the source tree on the demonstration server.

### 2f — tag width, and why it needs a decision

`release.sh` derives tags with `git rev-parse --short=12` (lines 129, 164, 169).
`AD-020` specifies parity on **full 40-character** SHAs. These are reconcilable —
the deployment workflow can pull by full SHA and locally tag to the 12-character
form `release.sh` expects — but the mapping must be recorded at deploy time, not
inferred later. **Open decision for gate 5**, not resolved here.

## Patch 3 — no `migrate` image is published

**File:** `.github/workflows/build-images.yml` · **lines 29-33** · **R5**

```yaml
         include:
           - image: web
             target: production
           - image: worker
             target: worker
+          - image: migrate
+            target: build
```

`release.sh:196` runs `${DC} --profile tools run --rm migrate`, and the `migrate`
service builds `target: build` because the `production` stage is Next.js
standalone output and carries **no `prisma` CLI**. On a host that never builds,
that service has nothing to run from. Additive to the matrix; changes no existing
image and no environment's deploy behaviour.

## Patch 4 — `docker-compose.demo.yml` does not exist

**File:** `apps/web/infra/docker-compose.demo.yml` · **new** · **R5**

Modelled on `docker-compose.staging.yml`, differing in that the demo **is**
publicly reachable, so it needs a real certificate rather than staging's
`auto_https off`. Required content:

- `caddy` mounting a new `Caddyfile.demo` — the **production** Caddyfile model
  (`{$APP_DOMAIN}` with ACME over HTTP-01), never the staging one.
- `APP_ENV=demo` and a `DATABASE_URL` naming a database matching `/[_-]demo\d*$/i`,
  which `apps/web/src/lib/startup-check.ts` cross-checks at boot.
- `TRUSTED_PROXY_CIDRS` set to the demo project's **own** Compose subnet and
  nothing wider. `0.0.0.0/0` is forbidden: it would trust the caller's own
  forwarded entry, which is the spoof the right-to-left walk in
  `apps/web/src/lib/auth/session.ts` exists to defeat.
- Mock outbound providers, with **no vendor credential present at all** rather
  than blank-but-declared.
- No published port for Postgres, Redis, MinIO or any admin or debug interface.
  80 and 443 only.

## Patch 5 — `Caddyfile.demo` does not exist

**File:** `apps/web/infra/Caddyfile.demo` · **new** · **R5**

Copy `apps/web/infra/Caddyfile`, not `Caddyfile.intranet` and not
`Caddyfile.staging`. `Caddyfile.intranet` is production's and hard-codes
`89.167.94.197`; `Caddyfile.staging` sets `auto_https off` and terminates no TLS.

---

## Order of application

1. Patch 1 (`deploy.yml` options) — before any GitHub environment exists.
2. Patch 3 (`migrate` image) and one `build-images.yml` run, so the image exists
   before anything tries to pull it.
3. Patches 4 and 5 (demo overlay and Caddyfile) — inert until dispatched.
4. Patch 2 (`release.sh`), with `REG-001` regression evidence for staging and
   production **before** merge, because that file is shared.
5. Only then: GitHub environment, secrets, host provisioning, DNS, deploy.

## What this does not cover

- The host. Nothing here can be applied usefully without one, and `EVC-024`
  records that the address `demo.youhan.in` currently resolves to is associated
  with production in this repository.
- `.env.demo` on the host, including `METRICS_TOKEN` — generated there by
  `npm run secrets .env.demo`, never through GitHub. See the provisioning
  checklist's correction of 2026-09-09.
- The demonstration account password, which is provisioned at seed time and
  never committed, logged or placed in an evidence file.
