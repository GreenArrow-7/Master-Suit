#!/usr/bin/env bash
# Production release — Option B, run as root on mastersuite-prod-01 from /opt/mastersuite.
#
# Self-contained: every variable is set here, every check exits on failure, nothing is
# taken from another shell. Usage:
#
#   production-release.sh preflight <CANDIDATE_SHA>   # §1–§4: checkout, images, gate, backup+restore drill
#   production-release.sh deploy    <CANDIDATE_SHA>   # §5–§6: release.sh, then verification
#   production-release.sh rollback                    # §7: previous image, schema untouched
#
# Never prints a secret. The backup passphrase is read into a subshell and tested for
# presence only. Nothing here changes ownership, groups or files under /opt other than
# what release.sh itself writes.
set -euo pipefail

APP=/opt/mastersuite
WEB="$APP/apps/web"
INFRA="$WEB/infra"
ENVF="$WEB/.env.production"
STATE=/var/lib/master-suite
REPO=ghcr.io/greenarrow-7/master-suit
STAGING_WEB=youhan-ios-staging-web-1
STAGING_WORKER=youhan-ios-staging-worker-1
BACKUPS=/var/backups/master-suite

die() { echo "STOP: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"
[ -r "$ENVF" ] || die "$ENVF not readable"

# The same file list release.sh uses for production (dc_for + host_overlay + gate_overlay),
# as an array so no argument is ever re-parsed.
DC=(docker compose -p infra --env-file "$ENVF"
    -f "$INFRA/docker-compose.yml" -f "$INFRA/docker-compose.prod.yml" -f "$INFRA/docker-compose.azure.yml")
[ -f "$INFRA/docker-compose.small-host.yml" ] && DC+=(-f "$INFRA/docker-compose.small-host.yml")
if grep -qs '^STAGING_NETWORK=.' "$ENVF"; then
  [ -f "$INFRA/docker-compose.staging-gate.yml" ] || die "STAGING_NETWORK is set but the gate overlay is missing — candidate predates it"
  DC+=(-f "$INFRA/docker-compose.staging-gate.yml")
else
  die "STAGING_NETWORK is not set in $ENVF; the staging-first gate cannot reach staging (see runbook §2a)"
fi

node_in_migrate() { "${DC[@]}" --profile tools run --rm --no-deps --entrypoint node migrate -e "$1"; }

phase_checkout() {
  local sha=$1
  cd "$APP"
  git fetch --all --tags --prune -q
  git checkout -q --detach "$sha"
  [ "$(git rev-parse HEAD)" = "$sha" ] || die "HEAD is not $sha"
  [ -z "$(git status --short)" ] || die "working tree not clean"
  echo "checkout OK $sha"
}

phase_images() {
  local sha=$1 tag; tag=$(git -C "$APP" rev-parse --short=12 HEAD)
  local img local_id staging_id
  for img in web worker; do
    docker pull -q "$REPO/$img:$sha"
    docker tag "$REPO/$img:$sha" "master-suite/$img:$tag"
  done
  # The candidate's migrate image is built from the tree, not pulled: build it now so the
  # deploy step promotes rather than builds anything, and so a build failure stops here.
  "${DC[@]}" --profile tools build migrate
  # Same bytes as the images the candidate was accepted on. The accepted IDs are recorded in
  # $STATE/tested.<tag> by the acceptance step; staging's running IDs are a cross-check, not
  # the acceptance itself.
  local tested="$STATE/tested.$tag"
  [ -r "$tested" ] || die "no accepted image identities recorded at $tested"
  for img in web worker; do
    local_id=$(docker image inspect "master-suite/$img:$tag" --format '{{.Id}}')
    want=$(sed -n "s/^${img}=//p" "$tested")
    [ -n "$want" ] || die "$tested has no line for $img"
    [ "$local_id" = "$want" ] || die "$img: pulled $local_id but accepted $want"
    c=$([ "$img" = web ] && echo "$STAGING_WEB" || echo "$STAGING_WORKER")
    staging_id=$(docker inspect "$c" --format '{{.Image}}' 2>/dev/null || echo none)
    echo "$img OK $local_id (staging running $staging_id)"
  done
}

phase_gate() {
  # Names and reachability of both databases, from inside the real migrate container with
  # the real overlay — the configuration release.sh will use, not a standalone one.
  node_in_migrate '
const need = ["STAGING_DATABASE_URL", "MIGRATION_DATABASE_URL", "PRISMA_MIGRATIONS_DIR"];
let bad = 0;
for (const k of need) { const ok = !!process.env[k]; console.log(k, ok ? "set" : "MISSING"); if (!ok) bad++; }
if (process.env.ALLOW_UNSTAGED_MIGRATION) { console.log("ALLOW_UNSTAGED_MIGRATION is SET — gate would be bypassed"); bad++; }
const s = new URL(process.env.STAGING_DATABASE_URL), p = new URL(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
console.log("staging   ", s.hostname, s.pathname); console.log("production", p.hostname, p.pathname);
if (s.hostname === "postgres" || p.hostname === "postgres") { console.log("ambiguous alias postgres — use the container name"); bad++; }
if (s.hostname === p.hostname || s.pathname === p.pathname) { console.log("staging and production must differ in host AND database"); bad++; }
process.exit(bad ? 1 : 0);'
  node_in_migrate '
const { Client } = require("pg");
(async () => {
  for (const [label, url] of [["staging", process.env.STAGING_DATABASE_URL], ["production", process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL]]) {
    const c = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await c.connect();
    const { rows } = await c.query("select current_database() db, inet_server_addr()::text addr, count(*)::int applied from _prisma_migrations where finished_at is not null and rolled_back_at is null");
    console.log(label, rows[0]); await c.end();
  }
})().catch(e => { console.error("connection failed:", e.code || e.message); process.exit(1); });'
  "${DC[@]}" --profile tools run --rm --no-deps --entrypoint node migrate scripts/check-staging-first.mjs
  echo "gate OK"
}

phase_backup() {
  # backup.sh resolves ../.env.production and the compose files relative to apps/web/infra;
  # run from anywhere else and it looks for /<parent>/.env.production and stops.
  ( cd "$INFRA" && ../scripts/backup.sh "$BACKUPS" )
  ( cd "$INFRA" && ../scripts/backup-status.sh "$BACKUPS" )
  local latest stamp; latest=$(readlink -f "$BACKUPS/latest")
  stamp=$(sed -n 's/^taken_at=//p' "$latest/manifest.txt")
  [ -n "$stamp" ] || die "manifest has no taken_at"
  BACKUP_AT=$(date -u -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%Y-%m-%dT%H:%M:%SZ)
  echo "$BACKUP_AT" > "$STATE/backup_at.last"
  echo "recovery boundary (dump start): $BACKUP_AT"
  (
    set -euo pipefail; set +o xtrace
    cd "$INFRA"
    trap 'unset BACKUP_PASSPHRASE BACKUP_REMOTE' EXIT INT TERM
    read -rs -p 'Backup passphrase: ' BACKUP_PASSPHRASE && echo
    [ -n "${BACKUP_PASSPHRASE}" ] || { echo "empty passphrase" >&2; exit 1; }
    export BACKUP_PASSPHRASE
    ../scripts/restore-verify.sh "$latest"
  )
  [ -z "${BACKUP_PASSPHRASE:-}" ] || die "passphrase leaked into this shell"
  echo "restore drill OK"
}

phase_deploy() {
  local sha=$1
  cd "$APP"
  "$WEB/scripts/release.sh" production "$sha"
}

phase_verify() {
  local tag; tag=$(git -C "$APP" rev-parse --short=12 HEAD)
  "$WEB/scripts/release.sh" status
  docker exec infra-web-1 sh -c 'env | grep "^BUILD_COMMIT="'
  local img c id want
  for img in web worker; do
    c="infra-$img-1"; id=$(docker inspect "$c" --format '{{.Image}}')
    want=$(sed -n "s/^${img}=//p" "$STATE/tested.$tag")
    [ "$id" = "$want" ] || die "$c is running $id, accepted $want"
    echo "$c OK $id"
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' https://one.youhan.in/login); [ "$code" = 200 ] || die "login page returned $code"
  echo "platform verification OK; run the application smoke checks (§6b) with the designated synthetic records now"
}

case "${1:-}" in
  preflight) [ -n "${2:-}" ] || die "candidate sha required"; phase_checkout "$2"; phase_images "$2"; phase_gate; phase_backup; echo "PREFLIGHT OK — deploy may run" ;;
  deploy)    [ -n "${2:-}" ] || die "candidate sha required"; [ "$(git -C "$APP" rev-parse HEAD)" = "$2" ] || die "run preflight first"; phase_deploy "$2"; phase_verify ;;
  rollback)  "$WEB/scripts/release.sh" rollback production; "$WEB/scripts/release.sh" status ;;
  *) die "usage: $0 preflight|deploy <sha> | rollback" ;;
esac
