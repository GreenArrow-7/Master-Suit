# SPEC-0008 — Gate 5 provisioning checklist

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Purpose | The exact evidence that turns gate 5 from HOLD to approvable |
| Prepared | 2026-09-09 |
| Prepared by | agent |

Gate 5 is implementation readiness. It is held not because anything is wrong but
because three of its prerequisites do not exist and cannot be created by an
agent. This document lists every one, states who owns it, and says precisely
what evidence closes it — so that gate 5 becomes a check against a list rather
than a judgement call.

**Nothing here has been provisioned.** No host, no DNS record, no certificate,
no GitHub environment, no secret. Secret **names** appear below; no value does,
and none was read.

---

## The three genuine blockers

Everything else on this list is work. These three are facts that must exist
first, and none is an engineering decision.

| # | Blocker | Owner | Evidence that closes it |
|---|---|---|---|
| B1 | No demo host exists | DevOps, with the budget holder | A reachable host, its SSH fingerprint, and its specification recorded |
| B2 | No domain, DNS record or certificate | DevOps, with Product | A hostname authorised for use, resolving to the host |
| B3 | **`deploy.yml` has never run** | DevOps | Explained: **0** GitHub environments, **0** secrets, **0** variables exist today, so it has not deployed staging or production either |

B3 is the one most likely to be waved past. It is on this list because adding a
demo target to a workflow that has never successfully deployed anything is a
different proposition from adding one to a working pipeline, and gate 5 should
know which it is approving.

**Corrected 2026-09-09, re-measured against GitHub.** An earlier statement that
"the pipeline has never run" was too broad and is narrowed here:

| Workflow | Runs | Evidence |
|---|---|---|
| `.github/workflows/deploy.yml` | **none, ever** | no runs listed |
| `.github/workflows/build-images.yml` | **one, successful** | run `34020142561`, `workflow_dispatch`, commit `f16ed677516fb07f31832a5d725e13efb477c34d`, 5m35s, 2026-09-06 |
| `.github/workflows/ci.yml` | runs regularly, passing | most recent success on `dev/yourhan-next`, 14m07s, 2026-09-08 |

So the *image build* half of the demo path is proven — GHCR already holds
`web` and `worker` for one commit — and the *deployment* half is what has never
executed. That is a materially better position than the earlier wording implied,
and it is the deployment half that gate 5 is being asked about.

---

## 1. Demo host / runtime

| Item | Requirement | Evidence |
|---|---|---|
| Host | A separate VM, per `CL-001` option B | Hostname or resource id recorded |
| Why not co-located | `apps/web/infra/Caddyfile.staging` shows staging is tunnel-only and holds a **restored production snapshot** | Recorded as the reason, not the cost |
| Size | Runs the Compose stack: web, worker, postgres, redis, minio, caddy | `apps/web/infra/docker-compose.small-host.yml` is the reference shape |
| OS and bootstrap | `apps/web/infra/cloud-init.yaml` and `apps/web/infra/provision-host.sh` | Provisioning run recorded, with its observed duration for `CL-003` |
| Docker | Engine and Compose v2 present | `docker compose version` on the host |
| Checkout | `/opt/master-suite` (or `DEPLOY_PATH_demo`) at the deployed commit | `release.sh` requires it for migrations |
| Registry access | Read-only pull of `ghcr.io/<owner>/<repo>/{web,worker}` | A pull of one tag succeeds |

### 1a. Minimum host specification

Taken from the repository's own provisioning assets, not invented. Where a
number is inferred rather than stated, that is said.

| Item | Requirement | Source |
|---|---|---|
| Base | Ubuntu LTS; first boot via `apps/web/infra/cloud-init.yaml`, which clones the repo and runs `apps/web/infra/provision-host.sh` | those two files |
| CPU | **2 vCPU** minimum | `apps/web/infra/docker-compose.small-host.yml` header: *"a small single host (2 vCPU, 4 GB)"* |
| RAM | **4 GB** minimum, **plus swap** | same header; `apps/web/infra/Dockerfile` notes the deployment VM is "4 GB plus swap" |
| Disk | **Inferred, not stated anywhere in the repo:** ~40 GB for images, Postgres, MinIO objects and logs. Confirm at provisioning | an assumption, flagged as one |
| Docker | Engine present; `provision-host.sh` installs `docker.io` if absent | `provision-host.sh` |
| Compose | **v2.24.0 or newer** — the overlays' `!reset`/`!override` need it, and the script upgrades below that | `provision-host.sh` version gate |
| Deploy user | `deploy` by default, in the `docker` group, holding the pipeline's SSH key | `provision-host.sh` |
| Firewall | `ufw` allowing **80** and **443**; port **22 restricted to a named source** via `SSH_ALLOW_FROM` | `provision-host.sh` |
| Published ports | **80 and 443 only.** Postgres, Redis, MinIO and the app port stay on the Compose network | the demo overlay must not publish them |
| Volumes | Persistent for Postgres, MinIO and Caddy's certificate store — the last so a rebuild does not re-request a certificate and meet a rate limit | Compose volumes |
| Deploy path | `/opt/master-suite`, or whatever `DEPLOY_PATH_demo` names | `deploy.yml` default |
| Database placement | On the demo host, in the demo Compose project. **Not** shared with any other environment, and not published beyond loopback | `SEC-002`, `DATA-005` |
| Monitoring access | Prometheus reaches `/api/metrics` with `METRICS_TOKEN`; the endpoint 404s when that is unset | `apps/web/src/app/api/metrics/route.ts` |

**No such host exists today. HUMAN INFRASTRUCTURE INPUT REQUIRED** — this is
blocker B1, and no part of it is an engineering decision an agent can make.

### 1b. SSH host-key enrolment

`DEPLOY_KNOWN_HOSTS_demo` is mandatory, and the enrolment must not be
"deploy once and let the workflow learn the key". `deploy.yml` falls back to
`ssh-keyscan` when the secret is empty and emits a warning; that fallback is
trust-on-first-use and is not acceptable for a publicly reachable host.

Enrolment procedure, to be completed **before** the first deployment:

1. Read the host key **on the host's own console** — the cloud provider's serial
   console or equivalent — with `ssh-keyscan -H <host>` run locally, or
   `for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done`.
2. Compare the fingerprint obtained out-of-band with the one an `ssh-keyscan`
   from elsewhere returns. They must match; a mismatch means stop.
3. Store the `known_hosts` line as `DEPLOY_KNOWN_HOSTS_demo`.
4. Confirm the workflow no longer emits its "accepting the host key on first
   use" warning — the absence of that warning is the evidence.

`StrictHostKeyChecking=no` is never used. `deploy.yml` already passes
`StrictHostKeyChecking=yes`; this section is about making sure the pinned key it
checks against was obtained honestly.

## 2. `APP_ENV=demo`

Set in the demo environment file. The boot cross-check in
`apps/web/src/lib/startup-check.ts` is bidirectional and fatal: a database named
`*_demo` under any other `APP_ENV`, or `APP_ENV=demo` against a database named
for another environment, refuses to start. **Evidence: the application boots.**
That is a stronger check than reading the file back.

## 3. `master_saas_demo`

| Item | Requirement |
|---|---|
| Name | Carries the demo marker `/[_-]demo\d*$/i` that the cross-check reads |
| Location | The demo host's own Postgres 16 instance; not shared with any other environment |
| Roles | The `NOBYPASSRLS` application role, plus the migration role, as production has |
| Migrations | `prisma migrate deploy` from the deployed commit's tree |
| Seed | `ALLOW_DEMO_SEED=yes`, with `DEMO_PASSWORD` supplied from the secret store so the seed never generates or prints one |
| Verification | `npm run check:rls` and `npm run check:drift` clean against it |

## 4. GitHub Environment

Named **`demo`**, matching `deploy.yml`'s `environment: ${{ inputs.environment }}`
and the `DEPLOY_*_{0}` secret template exactly — the workflow resolves both from
the input string, so the name is not cosmetic.

Unlike production, `demo` needs **no required reviewers**: its release gate is
that a human dispatches the workflow at all, per `CL-005` option C.

## 5. Required GitHub secret and variable NAMES

Names only. No value appears here, and none was read.

**Secrets, environment-scoped to `demo`:**

| Name | Purpose |
|---|---|
| `DEPLOY_HOST_demo` | SSH host, resolved by `deploy.yml`'s `format('DEPLOY_HOST_{0}', …)` |
| `DEPLOY_USER_demo` | SSH user |
| `DEPLOY_KEY_demo` | SSH private key |
| `DEPLOY_KNOWN_HOSTS_demo` | Pinned host fingerprint. **Not optional here:** without it `deploy.yml` falls back to trust-on-first-use, which is wrong for a publicly reachable host |
| `METRICS_TOKEN_demo` | Read-only, for the parity reporter to read `masterapp_build_info` |

**Variables:**

| Name | Purpose |
|---|---|
| `DEPLOY_PATH_demo` | Checkout path; `deploy.yml` defaults to `/opt/master-suite` |

**On the host, in the demo environment file — names only:**

`APP_ENV`, `APP_URL`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`RLS_DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `FIELD_ENCRYPTION_KEY`,
`WEBHOOK_SIGNING_PEPPER`, `METRICS_TOKEN`, `S3_ENDPOINT`, `S3_REGION`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `DEMO_PASSWORD`,
`EMAIL_PROVIDER`, `WHATSAPP_PROVIDER`, `ANTIVIRUS_PROVIDER`.

Generated by `apps/web/scripts/generate-secrets.mjs`. **Every value is unique to
demo**; `SEC-005` forbids sharing one with any other environment, and a shared
`FIELD_ENCRYPTION_KEY` would be the worst of them.

## 6. Deployment workflow target

| Item | Requirement |
|---|---|
| Choice | `demo` added to `options: [staging, production]` |
| Dispatch | `workflow_dispatch` only — no push trigger, no schedule (`CL-005` option C) |
| Image | Demo path pulls `ghcr.io/<owner>/<repo>/{web,worker}:<full-sha>` and tags them `master-suite/{web,worker}:<tag>` before `release.sh` |
| `release.sh` | Additive `demo` case in `dc_for()`; **no change to staging or production behaviour**, asserted by `REG-001` |
| Compose | New **docker-compose.demo.yml** (new, under `apps/web/infra/`), a peer of the staging file |
| Preflight | The existing check that the commit's `verify` check-run is `success` |

## 7–9. Hostname, DNS, TLS

| Item | State today | Required |
|---|---|---|
| Domain | `youhan.in` resolves; DNS managed at GoDaddy (`ns53.domaincontrol.com`) | Written authorisation to create a subdomain |
| Hostname | `demo.youhan.in` is **NXDOMAIN** | One A record to the demo host |
| TLS | No certificate exists | Caddy obtains one via ACME on first boot |
| Caddyfile | `apps/web/infra/Caddyfile.staging` is explicitly *not* the model — it has `auto_https off` and no public name | A demo Caddyfile modelled on `apps/web/infra/Caddyfile`, which does terminate TLS |
| HSTS / redirect | HTTP redirects to HTTPS | Caddy default, verified after issue |

Measured 2026-09-09 by public DNS lookup only; nothing was created or
configured. Note also that `youhan.in` publishes **no MX record**, so
`demo@youhan.in` currently receives no mail — a fact of today, not a control.

## 10. Outbound mock providers

`EMAIL_PROVIDER=mock`, `WHATSAPP_PROVIDER=mock`, `ANTIVIRUS_PROVIDER=mock`, and
**no vendor credential present at all** — `GEMINI_API_KEY`, `SMTP_HOST`,
`TWILIO_*`, `META_*` and payment keys all absent rather than blank-but-declared.
`ST-008` asserts the selection; `ST-009` asserts the workspace holds zero
integration connections, which is the second, independent reason nothing can
dispatch.

## 11. Monitoring

| Item | Requirement |
|---|---|
| Scrape | Prometheus scrapes the demo `/api/metrics`, gated on `METRICS_TOKEN` |
| Labels | Every series labelled so demo cannot be mistaken for production (`OBS-001`) |
| Alerts | Liveness, error rate, queue depth, routed to the owning team |
| Build info | `masterapp_build_info{commit,built_at}` scraped — this is also the parity source |

## 12. Backups and recovery objectives

**No scheduled backup**, per `CL-004` — but that is only defensible with an
objective attached, so the objective is stated rather than implied.

| Objective | Value |
|---|---|
| **RPO** | **The last deployed commit.** Nothing a presenter types during a demonstration is durable, and that is accepted: the dataset is deterministic output of the seed, so the only recoverable state is the seed's input |
| **RTO** | **≤ 2 hours** from destroyed to verified-demonstrable, dominated by host creation rather than by data |

**Recovery procedure — reconstruction, not restoration:**

1. Provision an empty demo database.
2. Apply the deployed release's migrations.
3. Run the deterministic seed (`ALLOW_DEMO_SEED=yes`, `DEMO_PASSWORD` from the
   secret store).
4. Confirm `demo@youhan.in` exists with Sales and HRMS access, a tenant-scoped
   role, and no platform administration.
5. Run reset verification.
6. Run the Sales smoke test.
7. Run the HRMS smoke test.

Rehearsed and timed at least once before gate 5 (`OPS-018`), with the observed
duration recorded — an RTO nobody has measured is a guess.

**If in-session demonstration edits must survive, this model does not deliver
it and backups must be added.** Stated here so the choice is visible now rather
than discovered during an incident.

## 13. Rollback

| Item | Requirement |
|---|---|
| Mechanism | `release.sh rollback demo`, already implemented |
| Precondition | The previous image is still on the host, or re-pullable by tag |
| Schema | Deliberately **not** rolled back — `migrate deploy` has no down-path |
| Verification | A rehearsed rollback recorded before first client use (`FR-011`) |

## 14. `demo@youhan.in` provisioning

| Item | Requirement |
|---|---|
| Source | The governed seed's `DEMO_CLIENT_LOGIN`; no manual account creation |
| Role | `org_admin`, `platformRole USER`, one workspace membership |
| Password | From `DEMO_PASSWORD` in the secret store, so the seed neither generates nor prints one |
| Rotation | Rotated after each demonstration period, by re-seed |
| Proof | `ST-012` to `ST-016` and `E2E-006` from `SPEC-0007` |

## 15. Post-deployment E2E

Run against the **real HTTPS hostname**, not localhost:

1. `E2E-001` to `E2E-006` from `SPEC-0007` — the client walkthrough, including
   one session across Sales and HRMS as `demo@youhan.in`.
2. `ST-013` to `ST-017` — parity and isolation boundaries.
3. Negative surface probes: `/.env`, `/package.json`, `/prisma/schema.prisma`,
   `/.git/config` and a source map all 404; `/api/v1/platform/workspaces`
   refuses; no stack trace in any error page.
4. A demo reset, followed by a repeat of step 1, proving the environment is
   genuinely disposable.

## 16. Parity / version verification

1. Demo reports a **full** SHA from `masterapp_build_info`.
2. Production reports its SHA; **expand it to full form** before comparing —
   production's build arg is `GIT_SHA: ${IMAGE_TAG:-unknown}` and `release.sh`
   sets `IMAGE_TAG` from `--short=12`, so production reports 12 characters today
   (`AD-012`).
3. Compare full to full. Report `IN_SYNC`, `DEMO_BEHIND`, `DEMO_AHEAD` or
   `DIVERGED`.
4. Cross-check the reported commit against `release.sh`'s state file; report a
   disagreement rather than resolving it.
5. Confirm the parity job holds **no** deployment credential (`SEC-009`).

---

## Gate 5 becomes approvable when

1. B1, B2 and B3 are closed with the evidence named above.
2. Sections 1 to 6 exist and are recorded.
3. Sections 7 to 9 exist: hostname authorised, DNS resolving, certificate
   issued.
4. Sections 10 to 14 are configured and the rollback has been rehearsed.
5. Sections 15 and 16 have been run once against the provisioned environment,
   green.

Until then gate 5 stays HOLD. Holding it costs nothing — it blocks execution,
not preparation — and approving it against three absent prerequisites would put
something untrue in the record.
