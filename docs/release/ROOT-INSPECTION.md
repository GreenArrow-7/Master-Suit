# Root inspection — facts to collect before the deployment window (prints no secret)

Run as root on `mastersuite-prod-01`. Every command prints names, numbers, hashes or presence
only. Paste the output back as-is.

```bash
cd /opt/mastersuite/apps/web

echo "== 1. backup policy (numbers only)"
grep -E '^BACKUP_(RETENTION_DAYS|KEEP_MIN)=' /etc/master-suite/backup.env 2>/dev/null || echo "backup.env: retention keys not set (script defaults: 30 days, keep 3)"
grep -qE '^BACKUP_REMOTE=.' /etc/master-suite/backup.env 2>/dev/null && echo "BACKUP_REMOTE: set" || echo "BACKUP_REMOTE: NOT set (no off-host copy)"
grep -qE '^BACKUP_PASSPHRASE=.' /etc/master-suite/backup.env 2>/dev/null && echo "BACKUP_PASSPHRASE: set (encrypted backups)" || echo "BACKUP_PASSPHRASE: NOT set (backups unencrypted)"

echo "== 2. backup runs actually taken"
scripts/backup-status.sh /var/backups/master-suite 2>&1 | tail -15
ls -1 /var/backups/master-suite | grep -E '^[0-9]{8}T' | sort | tail -3
grep -hE '^(taken_at|objects|rows\.)' "$(readlink -f /var/backups/master-suite/latest)/manifest.txt" 2>/dev/null
crontab -l 2>/dev/null | grep -i backup || grep -rl backup.sh /etc/cron* /etc/systemd/system 2>/dev/null | head -3

echo "== 3. production env: presence of the keys the release needs (never values)"
for k in DATABASE_URL MIGRATION_DATABASE_URL STAGING_NETWORK STAGING_DATABASE_URL ALLOW_UNSTAGED_MIGRATION ACCOUNT_DELETION_EXECUTION_ENABLED GEMINI_API_KEY EMAIL_PROVIDER S3_ENDPOINT APP_ENV; do
  v=$(grep -E "^$k=" .env.production | cut -d= -f2-); [ -n "$v" ] && echo "$k: set" || echo "$k: unset/empty"
done
echo "S3_ENDPOINT host: $(grep -E '^S3_ENDPOINT=' .env.production | cut -d= -f2- | sed -E 's#//[^@/]*@#//#' )"
echo "EMAIL_PROVIDER: $(grep -E '^EMAIL_PROVIDER=' .env.production | cut -d= -f2-)"

echo "== 4. committed-default DB password equality (hash compare, prints same/differs)"
for u in master_saas_app leadflow; do
  repo=$(grep -hoE "postgresql://$u:[^@]+@postgres:5432/leadflow" infra/docker-compose.prod.yml | head -1 | sed -E "s#postgresql://$u:([^@]+)@.*#\1#" | sha256sum | cut -c1-16)
  live=$(grep -E "^(DATABASE_URL|MIGRATION_DATABASE_URL)=" .env.production | grep -oE "postgresql://$u:[^@]+@" | head -1 | sed -E "s#postgresql://$u:([^@]+)@#\1#" | sha256sum | cut -c1-16)
  [ -n "$live" ] || { echo "$u: not present in .env.production URLs"; continue; }
  [ "$repo" = "$live" ] && echo "$u: SAME as committed default — rotate before release" || echo "$u: differs from committed default"
done

echo "== 5. AI / transcription connections configured in production (provider, status, count)"
docker exec infra-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select provider, status, count(*) from \"IntegrationConnection\" group by 1,2 order by 1"'
echo "(empty = none configured)"

echo "== 6. running release identity"
scripts/release.sh status
docker exec infra-web-1 sh -c 'env | grep ^BUILD_COMMIT='
for c in infra-web-1 infra-worker-1; do docker inspect "$c" --format '{{.Name}} {{.Config.Image}} {{.Image}}'; done
```
