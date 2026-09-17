# Production release — root console procedure (Option B)

Run as **root** on `mastersuite-prod-01` (`89.167.94.197`) from **`/opt/mastersuite`**.
Nothing here changes ownership, permissions, groups or secrets, and the `deploy` account gains
nothing.

**Do not run Phase 2 onward yet.** The candidate is not accepted — see §8.

Fourth pass, 2026-09-17. Every statement about the two environments below was **read from the
host** (as `deploy`, read-only, no values printed) rather than assumed; §9 lists what was
actually run. Corrections from the owner's second review are marked **[C8]**…**[C17]**; this
pass adds **[C18]**…**[C21]** for what the host contradicted.

---

## 0. Verified facts — both environments live on the same host

| | Production (`infra`) | Staging (`youhan-ios-staging`) |
|---|---|---|
| Path | `/opt/mastersuite` | `/home/deploy/ios-staging` |
| Compose | `docker-compose.yml + prod.yml + azure.yml + small-host.yml`, `--env-file apps/web/.env.production` | one `docker-compose.yml`, `--env-file .env.ios-staging` |
| Images | **built locally** by `release.sh`: `master-suite/{web,worker}:<12-char tag>` | **pulled from ghcr.io** by `build-images.yml`: `ghcr.io/greenarrow-7/master-suit/{web,worker}:<full 40-char SHA>` via `IMAGE_SHA` |
| Running | `c879c6c7f7e8` (web `sha256:04f21d2f…`, worker `sha256:36b35cad…`) | `c43b06f496a878869c4aa3064fa491766d3e518b` — **frozen for the owner's iPhone round** |
| Database | container `infra-postgres-1`, volume `infra_pgdata`, db `leadflow`, 65 migrations applied | container `youhan-ios-staging-postgres-1`, volume `youhan-ios-staging_pgdata`, db `youhan_ios_demo`, 78 applied |
| Postgres published port | **none** | **none** |
| Migrations | inside the `migrate` service (gate + `prisma migrate deploy`) | **from the host**: `/home/deploy/ios-staging/prisma/{schema,migrations}` + `prisma.config.ts`, `npx prisma migrate deploy` |
| Deploy tooling | `apps/web/scripts/release.sh` (Option B, root) or `deploy.yml` over SSH (needs `DEPLOY_*` secrets — **not present**) | plain `docker compose … up -d`; `release.sh` does **not** control this stack **[C19]** |
| Required Compose interpolation variables (prod) | `POSTGRES_PASSWORD`, `ALERT_EMAIL_TO`, `APP_DOMAIN`, `ACME_EMAIL` (rehearsed, §9.4) | `REDIS_PASSWORD`, `IMAGE_SHA` (`:?` in the file) |

**Database isolation — verified, not inferred [C21]:** two containers, two named volumes, two
database names, two different applied-migration counts. Neither Postgres publishes a host port,
so nothing on the host can reach either database by address except through its own Compose
network.

**Consequence for the staging-first gate [C18]:** production's `migrate` service reads
`STAGING_DATABASE_URL` and the compose file documents it as `host.docker.internal:5433`. Staging
publishes **no** port, so as things stand the gate **cannot reach staging** and will exit 1
("never applied to staging") for every pending migration — or, if `ALLOW_UNSTAGED_MIGRATION` is
set to get past that, it is bypassed. **This must be resolved before Phase 3**, by a root
decision in §2a. It is not resolvable from the `deploy` account and it is not to be resolved
by touching staging during the owner's test round.

### The Compose invocation — an array, never `eval` **[C9]**

```bash
DC=(docker compose -p infra
    --env-file /opt/mastersuite/apps/web/.env.production
    -f /opt/mastersuite/apps/web/infra/docker-compose.yml
    -f /opt/mastersuite/apps/web/infra/docker-compose.prod.yml
    -f /opt/mastersuite/apps/web/infra/docker-compose.azure.yml
    -f /opt/mastersuite/apps/web/infra/docker-compose.small-host.yml)
# use:  "${DC[@]}" <subcommand> ...
```

`eval "$DC"` re-parsed every argument; the inline `node -e '…'` programs below contain spaces,
quotes and `$`. Rehearsed: §9.4.

### Every stop condition is a script exit, not a line that prints and continues **[C20]**

All checks below are written to run under `set -euo pipefail`; a failed check exits non-zero
and nothing after it runs. Put each block in a file and run it, or paste it into a shell started
with `bash -euo pipefail`. Nothing relies on the operator reading a `STOP` line.

---

## 1. Artifact identity — the bytes staging tested are the bytes production starts **[C1] [C15] [C16] [C19]**

The earlier drafts assumed production and staging shared image digests. They do not: staging
runs a **ghcr.io** image built by `build-images.yml`; `release.sh production` **builds a new
image locally** whenever `master-suite/web:<tag>` is absent. A locally built image is a
different artifact from the one tested, even from the same commit.

The supported way to deploy the tested bytes is what `release.sh` already does when the tag
**exists**: it promotes rather than builds. So pull the tested image and tag it first.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/mastersuite
SHA=$(git rev-parse HEAD)                       # must already be <CANDIDATE_SHA> (Phase 2)
TAG=$(git rev-parse --short=12 HEAD)
REPO=ghcr.io/greenarrow-7/master-suit
for img in web worker; do
  docker pull "$REPO/$img:$SHA"
  docker tag  "$REPO/$img:$SHA" "master-suite/$img:$TAG"
done
# Same bytes as staging: compare image IDs, not tags. Staging's IDs are read on the host
# from the running containers, so this needs no record to have been kept.
for img in web worker; do
  local_id=$(docker image inspect "master-suite/$img:$TAG" --format '{{.Id}}')
  staging_id=$(docker inspect "youhan-ios-staging-$img-1" --format '{{.Image}}')
  [ "$local_id" = "$staging_id" ] || { echo "$img: local $local_id != staging $staging_id — not the tested bytes"; exit 1; }
  echo "$img OK $local_id"
done
```

This exits non-zero if a pull fails, if either tag is missing, or if either digest differs
from what staging is running **[C15]**. Only after it prints two `OK` lines may Phase 3 run.
Because both tags then exist, `release.sh` takes its "promoting, not rebuilding" branch;
`up -d --no-build` (which can never build) has both images **[C16]**.

What `release.sh` actually does, in order (lines 184–200): web image present? → promote, else
`build`; `run --rm migrate` (**migrations before anything starts**; no `--no-build`, so the
`migrate` service — which has its own `build:` target — is built if absent); `up -d --no-build`;
record tag. A missing worker image therefore fails **after** the schema has moved, which is the
"schema fully moved, later step failed" row in §5 — the check above exists so that state is
never reached.

---

## 2. Phase 0 — Preflight

### 2a. The staging-first gate — reachable, proven, then run **[corrected] [C2] [C10] [C18]**

`scripts/check-staging-first.mjs` reads exactly `STAGING_DATABASE_URL`, `MIGRATION_DATABASE_URL`
(fallback `DATABASE_URL`) and `PRISMA_MIGRATIONS_DIR`. For every migration in the repo not yet
applied in production, staging's ledger must carry it finished, not rolled back, checksum-matched.

**Reachability — the private-network overlay, nothing published [C18, superseding A/B].**
Neither option A (publishing a port) nor B (an ad-hoc `--network` flag that `release.sh`'s own
gate run would not use) is executed. PR #62 adds `infra/docker-compose.staging-gate.yml`, which
joins **only the one-off `migrate` container** to the staging project's network (`external`,
named by `STAGING_NETWORK`), and `release.sh` includes it for production whenever
`.env.production` carries `STAGING_NETWORK` — so the standalone preflight and `release.sh`'s
internal gate use the **same** Compose configuration. Rehearsed locally with the tools profile
active (§9.6). The self-contained root script `docs/release/production-release.sh` builds this
file list itself and refuses to run without `STAGING_NETWORK`.

Root sets, in `.env.production` (never echoed):

```
STAGING_NETWORK=youhan-ios-staging_default
STAGING_DATABASE_URL=postgresql://<staging user>:<pw>@youhan-ios-staging-postgres-1:5432/youhan_ios_demo
```

The endpoint is the staging **container name**. Both projects give their Postgres the alias
`postgres`; once `migrate` is on both networks that alias is ambiguous, and the script refuses
it. The check runs inside the real `migrate` container with the real overlay and proves
**both** connections by database name and applied-migration count.

**Prove it before trusting it**, by name only:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/mastersuite
[ "$(git rev-parse HEAD)" = "<CANDIDATE_SHA>" ] || { echo "not at the candidate"; exit 1; }
"${DC[@]}" --profile tools run --rm --no-deps --entrypoint node migrate -e '
const need = ["STAGING_DATABASE_URL", "MIGRATION_DATABASE_URL", "PRISMA_MIGRATIONS_DIR"];
let bad = 0;
for (const k of need) { const ok = !!process.env[k]; console.log(k, ok ? "set" : "MISSING"); if (!ok) bad++; }
if (process.env.ALLOW_UNSTAGED_MIGRATION) { console.log("ALLOW_UNSTAGED_MIGRATION is SET — gate would be bypassed"); bad++; }
const s = new URL(process.env.STAGING_DATABASE_URL), p = new URL(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
console.log("staging   ", s.hostname, s.pathname); console.log("production", p.hostname, p.pathname);
if (s.pathname === p.pathname && s.hostname === p.hostname) { console.log("SAME DATABASE"); bad++; }
process.exit(bad ? 1 : 0);'
# Reachability: a real connection, one row, no data.
"${DC[@]}" --profile tools run --rm --no-deps --entrypoint node migrate -e '
const { Client } = require("pg");
(async () => { const c = new Client({ connectionString: process.env.STAGING_DATABASE_URL, connectionTimeoutMillis: 5000 });
  await c.connect(); const { rows } = await c.query("select current_database() db, count(*)::int applied from _prisma_migrations where finished_at is not null and rolled_back_at is null");
  console.log("staging reachable:", rows[0]); await c.end(); })().catch(e => { console.error("staging NOT reachable:", e.code || e.message); process.exit(1); });'
# Then the gate itself. Read-only; --no-deps so it cannot start anything.
"${DC[@]}" --profile tools run --rm --no-deps --entrypoint node migrate scripts/check-staging-first.mjs
```

Expected: three `set`, two different host/path pairs, `staging reachable: { db: 'youhan_ios_demo', applied: <n> }`,
then `pending` listed and `problems` empty. Any `problems` entry exits 1 and stops the release
(never applied / rolled back / unfinished / edited after staging ran it).

### 2b. State and capacity

```bash
cd /opt/mastersuite
git rev-parse HEAD; git status --short        # expect empty
apps/web/scripts/release.sh status
df -h / /var/backups /var/lib/docker | sort -u; free -m
```

---

## 3. Phase 1 — Backup, and a restore that is proven

```bash
cd /opt/mastersuite
apps/web/scripts/backup.sh /var/backups/master-suite
apps/web/scripts/backup-status.sh /var/backups/master-suite
```

### The recovery boundary is the dump's start, read from the manifest **[C12]**

`pg_dump -Fc` reads a snapshot fixed when the dump **starts**; `backup.sh` sets `STAMP` before
the dump and writes it as `taken_at=`. Rehearsed on the exact format: §9.2.

```bash
LATEST=$(readlink -f /var/backups/master-suite/latest)
STAMP=$(sed -n 's/^taken_at=//p' "$LATEST/manifest.txt")
BACKUP_AT=$(date -u -d "${STAMP:0:8} ${STAMP:9:2}:${STAMP:11:2}:${STAMP:13:2}" +%Y-%m-%dT%H:%M:%SZ)
echo "recovery boundary (dump start): $BACKUP_AT"
```

### The restore drill — the passphrase lives in a subshell, is never expanded, and failure propagates **[corrected] [C6] [C11] [C20]**

```bash
(
  set -euo pipefail; set +o xtrace
  cd /opt/mastersuite/apps/web/infra
  trap 'unset BACKUP_PASSPHRASE BACKUP_REMOTE' EXIT INT TERM
  read -rs -p 'Backup passphrase: ' BACKUP_PASSPHRASE && echo
  [ -n "${BACKUP_PASSPHRASE}" ] || { echo "empty passphrase"; exit 1; }    # presence only — never the value
  export BACKUP_PASSPHRASE
  ../scripts/restore-verify.sh "$LATEST"                                   # non-zero here fails the subshell
)
rc=$?; [ -z "${BACKUP_PASSPHRASE:-}" ] || { echo "passphrase leaked into this shell"; exit 1; }
[ "$rc" -eq 0 ] || { echo "restore drill failed ($rc) — do not continue"; exit "$rc"; }
```

No line expands the variable; the only test is `-n`. The subshell owns the secret, so it dies
with the child whether the drill succeeds, fails or is interrupted; `rc` carries the drill's
exit code out. Rehearsed with a failing stand-in: §9.1 (present inside, absent outside, exit 3
preserved). `restore-verify.sh` restores into `<db>_restorecheck`, which it creates, marks and
drops; it refuses any target it did not create and reconciles rows and object files against
the manifest. Add `--prefer-remote` to prove the off-host copy.

---

## 4. Phase 2 — Check out the candidate

```bash
cd /opt/mastersuite
git fetch --all --tags --prune
git checkout --detach <CANDIDATE_SHA>
[ "$(git rev-parse HEAD)" = "<CANDIDATE_SHA>" ] && [ -z "$(git status --short)" ] || exit 1
```

Then §1's pull-tag-compare and §2a's proof and gate, in that order, before Phase 3.

---

## 5. Phase 3 — Deploy

```bash
cd /opt/mastersuite
apps/web/scripts/release.sh production <CANDIDATE_SHA>
```

### If migrations fail — inspect the schema, never infer it **[corrected] [C3]**

Do not re-run and do not `migrate resolve` on ledger evidence alone. Read the ledger, the
migrate container's log, and the schema itself (queries unchanged from the previous pass, run
through `"${DC[@]}"`), then:

| Observed | Action |
|---|---|
| Schema untouched, ledger has no row | Nothing applied. Fix and redeploy. |
| Schema untouched, ledger row unfinished | Mark rolled back, then redeploy. |
| **Schema partly moved** | **Stop.** Decide restore vs roll-forward in §7 with a human. |
| Schema fully moved, later step failed | Successful migration, failed deploy: the application may roll back, the schema does not. |

---

## 6. Phase 4 — Verification

### 6a. Platform

```bash
cd /opt/mastersuite
apps/web/scripts/release.sh status
docker exec infra-web-1 sh -c 'env | grep "^BUILD_COMMIT="'
for c in infra-web-1 infra-worker-1; do docker inspect "$c" --format '{{.Name}} {{.Config.Image}} {{.Image}}'; done
curl -s -o /dev/null -w 'one.youhan.in %{http_code}\n' https://one.youhan.in/login
```

Both `.Image` values must equal the `OK` lines from §1 — which are staging's.

### 6b. Application smoke checks — designated synthetic records only **[corrected]**

**Owner input required:** a designated production test account, records it may write to, and
a second account whose role should be refused. Login → cookie issued. Permissions → 403.
Worker → `docker logs --since 20m infra-worker-1 | grep -c 'sweep complete'` ≥ 1. Upload a clean
document to the designated record → `200/201`, read back, bytes match.

### 6c. Scanner tests — against the design as built; outage test on staging only **[C7] [C8] [C14]**

The upload path (`src/services/hr/documents.ts`) **always creates the row first**
(`PENDING`, quarantined, object under a quarantine key), then by verdict: `CLEAN` → moved to
`clean/`, row `CLEAN`; `INFECTED` → object deleted, `storageKey null`, row kept, API throws;
`ERROR` → object left quarantined, row `ERROR`, API throws. Download refused unless `CLEAN`.

- **Test A (production, safe)** — `clamdscan -` on a clean stream then EICAR: `OK` then `FOUND`.
- **Test B (production, designated record)** — upload EICAR via the API: expect **4xx**, a row
  `INFECTED`/quarantined/`storageKey IS NULL`, no object under `clean/`, download refused. "No
  row" would **fail correct behaviour** — the row is the evidence.
- **Test C (staging only) [C8]** — the staging stack already carries the harness:
  `/home/deploy/ios-staging/outage-test.sh` stops and restarts `clamav` via
  `docker compose --env-file .env.ios-staging` and `upload-tests.sh` drives the uploads. Run
  them **after the owner's round ends**, at the candidate revision; expect refusal with row
  `ERROR` while stopped, `CLEAN` after restart. Never stop `infra-clamav-1`.

---

## 7. Rollback, roll-forward, and what a restore would cost **[corrected] [C4] [C5] [C13] [C17] [C19]**

```bash
apps/web/scripts/release.sh rollback production   # previous image; schema untouched
```

### Compatibility is proven by running the old image on the new schema — on staging, with staging's own tooling **[C4] [C17] [C19]**

The `[C4]` SQL table is the first screen (a `DROP`/`RENAME` is roll-forward with no rehearsal).
It is not the verdict. `release.sh rollback` does not exist for the staging stack; the same
rehearsal in staging's terms, run as `deploy` **after the owner's round ends**:

```bash
cd /home/deploy/ios-staging
PREV=$(docker inspect youhan-ios-staging-web-1 --format '{{.Config.Image}}' | sed 's/.*://')   # currently c43b06f…
# 1. migrations for the candidate: refresh the host-side copy from the candidate commit, then apply
#    (the copy at prisma/ is what staging migrates from; it must match <CANDIDATE_SHA>'s apps/web/prisma)
MIGRATION_DATABASE_URL=… npx prisma migrate deploy            # value from .env.ios-staging, not typed here
# 2. candidate images
IMAGE_SHA=<CANDIDATE_SHA> docker compose --env-file .env.ios-staging up -d web worker
#    → §6b smoke on staging
# 3. previous image on the candidate schema — the rollback rehearsal
IMAGE_SHA=$PREV docker compose --env-file .env.ios-staging up -d web worker
#    → §6b smoke again; docker logs --since 10m youhan-ios-staging-worker-1 | grep -ci "prisma\|error" → 0
# 4. back to the candidate
IMAGE_SHA=<CANDIDATE_SHA> docker compose --env-file .env.ios-staging up -d web worker
```

Only a candidate whose previous image ran clean on its schema is **image-rollback-safe**; else
**roll-forward only**. The account-deletion candidate adds one table, one enum, three indexes,
one partial unique index and one integer column (`attempts`), all read by new code only —
screen: rollback-safe; rehearsal: **not yet run** (owner's round).

### Quantifying what a restore would discard — audit counts are a lower bound **[C5] [C13]**

`AuditLog` records what the application chose to audit. Run both queries (unchanged from the
previous pass, through `"${DC[@]}"`): the audited floor, and the per-table `createdAt`/`updatedAt`
scan across every table (rehearsed: 187 tables, §9.3). Neither sees **deletes** or **uploaded
objects** — list the bucket for the window. State the loss as *at least* the audit counts,
*plus* the unaudited inserts/updates, *plus* an unknown number of deletes and the bucket delta.

| Situation | Response |
|---|---|
| Application defect, candidate image-rollback-safe by the staging rehearsal | **Roll back the image.** |
| Application defect, roll-forward only | **Roll forward.** |
| Data corruption caused by the release | **Restore — last resort**, after quantifying and explicitly accepting the loss. |

---

### 7b. Rollback rehearsal with the **current production** image identities, in isolation **[C17, as required]**

Staging's previous images are not production's. The rehearsal that answers "can what is
running now serve the candidate's schema?" uses `master-suite/web:c879c6c7f7e8` and
`master-suite/worker:c879c6c7f7e8` — the exact IDs in service — against a throwaway database
migrated to the candidate, on a throwaway network, touching neither stack. As `deploy` (docker
group) it needs no root and reads no production secret. Its actual run is recorded in §9.7 once
executed; until then the candidate is **not** labelled rollback-safe.

Outline: throwaway `postgres:16-alpine` on a throwaway network → candidate migrations applied
from the candidate's own image → `master-suite/web:c879c6c7f7e8` and `worker:c879c6c7f7e8`
started against it with a minimal boot env (placeholders, never real values) → `/api/health`
answers and neither log contains a Prisma/schema error → result recorded with both image IDs
and the candidate SHA.

## 8. The candidate **[corrected]**

The candidate is `main` containing every accepted release change. **Backend identity**: the
SHA on `one.youhan.in` and the two image IDs (= staging's). **Native identity**: TestFlight
build number and the backend URL compiled in (`MOBILE_SERVER_URL`).

State at the time of writing: `main` carries PR #56. Account deletion is PR #59 at
`0d21a45db6ee`, **not merged**; CI for it is running. It ships with erasure **disabled by
default** (`ACCOUNT_DELETION_EXECUTION_ENABLED`). Device acceptance for #56 is in progress on
the owner's iPhone against build 3 / `c43b06f`. **The candidate is not accepted.** When #59
merges, the candidate SHA is that merge commit; `build-images.yml` must be dispatched with its
full SHA so staging (and, via §1, production) run those bytes.

---

## 9. What was actually run, and what was not

Off-production, on the operator's machine, 2026-09-17 (scratch DB `master_suite_accdel`),
plus **read-only** SSH as `deploy` to the host — no values printed, nothing changed:

- **9.1** Subshell-scoped secret with a failing stand-in: `inside: present (len 23)`, `drill exit=3`, `outside: NO`, `history entries containing the secret: 0`.
- **9.2** Manifest boundary: `taken_at=20260917T031500Z → BACKUP_AT=2026-09-17T03:15:00Z`.
- **9.3** Mutation coverage: 187 tables scanned; boundary with no activity → 0; earlier boundary → per-table counts (`PlatformUser.updatedAt 269`, …).
- **9.4** Array Compose invocation: 14 argv words; Compose refused on each missing required variable in turn (`POSTGRES_PASSWORD`, `ALERT_EMAIL_TO`, `APP_DOMAIN`, `ACME_EMAIL`), then on the deliberately absent `.env.production`.
- **9.5 (host, read-only)** Containers, images and tags of both stacks; both Postgres containers' database name and applied-migration count (`youhan_ios_demo`/78, `leadflow`/65); distinct volumes; **no published Postgres port on either**; staging compose/env file names and env-var **names**; `outage-test.sh` / `upload-tests.sh` present; staging `BUILD_COMMIT=c43b06f…`.

- **9.6** Staging-gate overlay (PR #62): `docker compose --profile tools config` over the full production file list plus the overlay, with a throwaway external network: `migrate` networks `default` + `staging_gate`; `staging_gate` resolves to the external network by name; no other service references it. (A first run without `--profile tools` showed nothing — profile-only services are omitted — and was corrected on the PR.)

**Not run — and why:** §1 pull/tag/compare (needs the candidate built by `build-images.yml`);
§2a reachability + gate (needs the root decision A/B and `.env.production`); §3 backup +
restore drill (root, and the backup passphrase — owner-held); §7 staging migration + rollback
rehearsal and §6c Test C (would change staging during the owner's active round).

---

## Recorded separately — a pre-existing privilege issue

`deploy` is in `sudo` and `docker` (confirmed on the host: `id -nG` → `deploy sudo users docker`),
which is root-equivalent. The `-rw------- root:root` mode on production's env files is a nominal
boundary against that account, not a real one. Not introduced or changed here; nothing was read
through Docker. For a maintenance window, not mid-release.
