# Root-console handoff — production web release (Option B)

Everything below is run by **root on `mastersuite-prod-01`**. `<SHA>` is the final candidate
(main after #59, #62, #65 and any other accepted change), supplied with this handoff together
with the accepted image identities. Nothing here is run by anyone but you; nothing prints a
secret.

## 0. One-time preparation (before the release window)

1. Put the staging-gate values in `/opt/mastersuite/apps/web/.env.production` (edit as root):
   ```
   STAGING_NETWORK=youhan-ios-staging_default
   STAGING_DATABASE_URL=postgresql://<staging db user>:<staging db password>@youhan-ios-staging-postgres-1:5432/youhan_ios_demo
   ```
   The user/password are the ones in `/home/deploy/ios-staging/.env.ios-staging`
   (`POSTGRES_USER`/`POSTGRES_PASSWORD`). Never echo either file.
2. Record the accepted image identities for the candidate tag (values come from the
   `build-images.yml` run summary I send you):
   ```bash
   TAG=<12-char tag>; install -d -m 700 /var/lib/master-suite
   printf 'web=%s\nworker=%s\n' '<sha256:web image id>' '<sha256:worker image id>' > /var/lib/master-suite/tested.$TAG
   ```
3. Credential hygiene check (the public repository carries local-dev default DB passwords;
   staging was verified different by hash; production is **unverified until you run this**):
   ```bash
   cd /opt/mastersuite/apps/web
   for u in master_saas_app leadflow; do
     repo=$(grep -hoE "postgresql://$u:[^@]+@postgres:5432/leadflow" infra/docker-compose.prod.yml | head -1 | sed -E "s#postgresql://$u:([^@]+)@.*#\1#" | sha256sum | cut -c1-16)
     live=$(grep -E "^(DATABASE_URL|MIGRATION_DATABASE_URL)=" .env.production | grep -oE "postgresql://$u:[^@]+@" | head -1 | sed -E "s#postgresql://$u:([^@]+)@#\1#" | sha256sum | cut -c1-16)
     [ "$repo" = "$live" ] && echo "$u: SAME AS COMMITTED DEFAULT — rotate before release" || echo "$u: differs from committed default (ok)"
   done
   ```
4. Backup policy evidence (F5): `apps/web/scripts/backup-status.sh /var/backups/master-suite`
   and `grep -E '^BACKUP_(RETENTION_DAYS|KEEP_MIN)=' /etc/master-suite/backup.env` — send me the
   two numbers and the newest run's `taken_at`.

## 1. Preflight (idempotent; exits on the first failed check)

```bash
cd /opt/mastersuite
git fetch --all --tags --prune && git checkout --detach <SHA>
bash apps/web/docs/release/production-release.sh preflight <SHA>
```
It: checks out and verifies a clean tree → pulls the ghcr images for `<SHA>`, tags them for
`release.sh`, builds the migrate image, compares image IDs with `tested.<tag>` → proves both
database connections and the gate from inside the real `migrate` container with the real
overlay → takes a backup, derives the recovery boundary, runs the restore drill (asks for the
backup passphrase once, in a subshell). It ends with `PREFLIGHT OK — deploy may run`.
**Send me the full output** (it contains no secrets).

## 2. Deploy

```bash
bash apps/web/docs/release/production-release.sh deploy <SHA>
```
Runs `release.sh production <SHA>` (promotes the tagged images, runs the gate + migrations,
starts the new containers) and then verifies `BUILD_COMMIT`, both running image IDs against
`tested.<tag>`, and `https://one.youhan.in/login` = 200. **Send me the output.** I then run the
application smoke checks (login, 403 for the restricted account, worker sweep, clean
upload/read-back) against the designated synthetic records and report.

## 3. If anything fails

```bash
bash apps/web/docs/release/production-release.sh rollback     # previous images; schema untouched
```
The candidate's schema was rehearsed with the current production images (runbook §9.7:
image-rollback-safe). If a migration itself failed, stop and send me the preflight/deploy
output — do not retry.
