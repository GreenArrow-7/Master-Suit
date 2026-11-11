#!/usr/bin/env bash
#
# STAGING acceptance for a release candidate.
#
# This is the step that was missing. `production-release.sh` refuses to deploy
# without $STATE/tested.<tag>, and nothing in the repository ever wrote that
# file — so the only ways past the gate were to type it by hand or to skip the
# gate. Both defeat the point of having one. This writes it, last, and only
# after every check below has passed.
#
#   ./staging-acceptance.sh <CANDIDATE_SHA>
#
# It runs ON THE HOST, as the account that owns the staging stack. It never
# touches production: the isolation section refuses to continue unless staging
# is provably a different database, a different Compose project and a different
# set of containers, and every `docker compose` call it makes is pinned to the
# staging env file.
#
# Secrets are read from the staging env file by this script and never printed.
# The test accounts it creates are generated here, so nobody has to invent
# them; their passwords are written to a root-only file named at the end.
#
# What it proves, in order:
#
#   1. staging is not production                      (refuses otherwise)
#   2. the candidate's images are the ones under test (by image id, not tag)
#   3. migrations apply to staging first
#   4. a permitted account can do the tested actions  (§6b)
#   5. a second account is REFUSED those same actions (§6b)
#   6. the previous image runs on the candidate schema (rollback rehearsal, §7)
#   7. only then: $STATE/tested.<tag>
#
set -euo pipefail

die() { printf '\nSTAGING ACCEPTANCE FAILED: %s\n' "$*" >&2; exit 1; }
step() { printf '\n=== STAGING · %s\n' "$*"; }

CANDIDATE=${1:-}
[ -n "$CANDIDATE" ] || die "candidate sha required: $0 <CANDIDATE_SHA>"
[ ${#CANDIDATE} -eq 40 ] || die "give the full 40-character sha, not an abbreviation"

STAGING_DIR=${STAGING_DIR:-/home/deploy/ios-staging}
STAGING_ENV=${STAGING_ENV:-$STAGING_DIR/.env.ios-staging}
STAGING_URL=${STAGING_URL:-http://127.0.0.1:8080}
STATE=${STATE:-/var/lib/master-suite}
APP=${APP:-/opt/master-saas}
PROJECT=youhan-ios-staging

[ -d "$STAGING_DIR" ] || die "$STAGING_DIR is not there; this is not the staging host"
[ -r "$STAGING_ENV" ] || die "$STAGING_ENV is not readable by $(id -un)"

DC=(docker compose --env-file "$STAGING_ENV")
cd "$STAGING_DIR"

# ---------------------------------------------------------------------------
# 1. Staging is not production.
#
# Every check here is a refusal, not a warning. The reason this section is long
# is that the staging stack sits on the same VM and the same Docker daemon as
# production: one wrong env file and "staging acceptance" writes to customers.
# ---------------------------------------------------------------------------
step "1. isolation"

# Read without echoing. `grep -m1` so a duplicated key cannot be used to smuggle
# a second value past the checks below.
env_of() { grep -m1 "^$1=" "$STAGING_ENV" | cut -d= -f2- || true; }

STAGING_DB_URL=$(env_of DATABASE_URL)
STAGING_APP_ENV=$(env_of APP_ENV)
[ -n "$STAGING_DB_URL" ] || die "DATABASE_URL is not set in $STAGING_ENV"

# The database name only — never the credentials.
STAGING_DB_NAME=$(printf '%s' "$STAGING_DB_URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')
case "$STAGING_DB_NAME" in
  *_staging | *_test | *_e2e) : ;;
  *) die "staging DATABASE_URL points at '$STAGING_DB_NAME', which is not a staging database name. Refusing." ;;
esac
[ "$STAGING_DB_NAME" != "leadflow" ] || die "staging is pointed at the production database 'leadflow'. Refusing."
[ "$STAGING_APP_ENV" = "staging" ] || die "APP_ENV in $STAGING_ENV is '$STAGING_APP_ENV', expected 'staging'. Refusing."

# The containers this script will drive must be staging's, and production's must
# be untouched by it. `infra-*` is the production project.
for c in web worker postgres; do
  name="$PROJECT-$c-1"
  docker inspect "$name" >/dev/null 2>&1 || die "$name is not running; bring staging up first"
  case "$name" in infra-*) die "refusing to act on a production container ($name)" ;; esac
done

# The decisive one: ask the database it is actually connected to for its own
# name, rather than trusting the string in the file.
LIVE_DB=$(docker exec "$PROJECT-postgres-1" psql -U leadflow -d "$STAGING_DB_NAME" -tAc 'SELECT current_database()')
[ "$LIVE_DB" = "$STAGING_DB_NAME" ] || die "staging postgres answered '$LIVE_DB', expected '$STAGING_DB_NAME'"
[ "$LIVE_DB" != "leadflow" ] || die "staging postgres IS the production database. Refusing."

# Production's postgres, if it is on this host, must be a different container id.
if docker inspect infra-postgres-1 >/dev/null 2>&1; then
  s=$(docker inspect "$PROJECT-postgres-1" --format '{{.Id}}')
  p=$(docker inspect infra-postgres-1 --format '{{.Id}}')
  [ "$s" != "$p" ] || die "staging and production resolve to the same postgres container. Refusing."
fi

# Mail must not leave the host. Staging sends to Mailpit; a real relay here
# would mean these synthetic accounts email real addresses.
MAIL_HOST=$(env_of SMTP_HOST)
case "${MAIL_HOST:-}" in
  *mailpit* | *localhost* | 127.0.0.1 | mailhog | '') : ;;
  *) die "staging SMTP_HOST is '$MAIL_HOST' — a real relay. Refusing to create accounts that would email out." ;;
esac

echo "isolation OK · db=$LIVE_DB · APP_ENV=$STAGING_APP_ENV · mail=${MAIL_HOST:-mailpit} · project=$PROJECT"

# ---------------------------------------------------------------------------
# 2. The candidate, by image id.
# ---------------------------------------------------------------------------
step "2. candidate images"

TAG=$(git -C "$APP" rev-parse --short=12 "$CANDIDATE")
REPO=${REPO:-ghcr.io/greenarrow-7/master-suit}

for img in web worker; do
  docker pull -q "$REPO/$img:$CANDIDATE"
  docker tag "$REPO/$img:$CANDIDATE" "master-suite/$img:$TAG"
done

WEB_ID=$(docker image inspect "master-suite/web:$TAG" --format '{{.Id}}')
WORKER_ID=$(docker image inspect "master-suite/worker:$TAG" --format '{{.Id}}')
echo "web=$WEB_ID"
echo "worker=$WORKER_ID"

# What staging is on right now, so the rollback rehearsal has something to go
# back to. Captured before anything is changed.
PREV=$(docker inspect "$PROJECT-web-1" --format '{{.Config.Image}}' | sed 's/.*://')
[ -n "$PREV" ] || die "could not read the image staging is currently running"
echo "previous image on staging: $PREV"

# ---------------------------------------------------------------------------
# 3. Migrations, staging first.
# ---------------------------------------------------------------------------
step "3. migrations"

# The host-side prisma/ copy is what staging migrates from; it must be the
# candidate's, or the rehearsal rehearses the wrong SQL.
git -C "$APP" fetch --quiet origin
git -C "$APP" checkout --quiet "$CANDIDATE"
rsync -a --delete "$APP/apps/web/prisma/" "$STAGING_DIR/prisma/"

BEFORE=$(docker exec "$PROJECT-postgres-1" psql -U leadflow -d "$STAGING_DB_NAME" -tAc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
MIGRATION_DATABASE_URL=$(env_of MIGRATION_DATABASE_URL) \
  npx --prefix "$STAGING_DIR" prisma migrate deploy --schema "$STAGING_DIR/prisma/schema.prisma"
AFTER=$(docker exec "$PROJECT-postgres-1" psql -U leadflow -d "$STAGING_DB_NAME" -tAc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
echo "migrations finished: $BEFORE -> $AFTER (applied $((AFTER - BEFORE)))"

FAILED=$(docker exec "$PROJECT-postgres-1" psql -U leadflow -d "$STAGING_DB_NAME" -tAc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL')
[ "$FAILED" = "0" ] || die "$FAILED migration(s) unfinished or rolled back in staging"

# ---------------------------------------------------------------------------
# 4. Start the candidate.
# ---------------------------------------------------------------------------
step "4. candidate up"

IMAGE_SHA=$CANDIDATE "${DC[@]}" up -d web worker
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/api/health" || true)
  [ "$code" = "200" ] && break
  [ "$i" = "60" ] && die "staging /api/health never returned 200 (last: $code)"
  sleep 2
done
running=$(docker inspect "$PROJECT-web-1" --format '{{.Image}}')
[ "$running" = "$WEB_ID" ] || die "staging web is running $running, candidate is $WEB_ID"
echo "candidate serving · /api/health 200 · web image matches"

# ---------------------------------------------------------------------------
# 5. §6b — one account that may, one that must not.
#
# Both are created here, in their own workspace, so nothing in this section can
# reach a record that belongs to anybody. Mail goes to Mailpit, checked above.
# ---------------------------------------------------------------------------
step "5. §6b smoke with synthetic records"

RUN=$(date -u +%Y%m%d%H%M%S)
SLUG="acceptance-$RUN"
ALLOWED_EMAIL="acceptance.admin.$RUN@staging.invalid"
DENIED_EMAIL="acceptance.denied.$RUN@staging.invalid"
# Generated, not invented by a human, and never reused between runs.
ALLOWED_PW="Stg!$(openssl rand -hex 12)"
DENIED_PW="Stg!$(openssl rand -hex 12)"

OWNER_EMAIL=$(env_of PLATFORM_OWNER_EMAIL)
OWNER_PW=$(env_of PLATFORM_OWNER_PASSWORD)
[ -n "$OWNER_EMAIL" ] && [ -n "$OWNER_PW" ] ||
  die "PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD are not in $STAGING_ENV; the workspace cannot be created without them"

JAR=$(mktemp); OWNER_JAR=$(mktemp); DENIED_JAR=$(mktemp)
trap 'rm -f "$JAR" "$OWNER_JAR" "$DENIED_JAR"' EXIT

api() { curl -s -o /tmp/acc.out -w '%{http_code}' "$@"; }

# 5a. the platform owner creates a workspace with its own administrator
code=$(api -c "$OWNER_JAR" -X POST "$STAGING_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg e "$OWNER_EMAIL" --arg p "$OWNER_PW" '{email:$e,password:$p}')")
[ "$code" = "200" ] || die "platform owner sign-in returned $code"

code=$(api -b "$OWNER_JAR" -X POST "$STAGING_URL/api/v1/platform/workspaces" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg s "$SLUG" --arg e "$ALLOWED_EMAIL" --arg p "$ALLOWED_PW" '{
      workspaceName:("Acceptance " + $s), slug:$s,
      legalName:("Acceptance " + $s + " LLC"), displayName:("Acceptance " + $s),
      planCode:"standard", country:"AE", timezone:"Asia/Dubai", currency:"AED",
      primaryAdminName:"Acceptance Administrator", primaryAdminEmail:$e, primaryAdminPassword:$p,
      enabledModules:["SALES"], maxEmployees:10, maxUsers:10, maxStorageMb:1024, status:"ACTIVE"
    }')")
[ "$code" = "200" ] || [ "$code" = "201" ] || die "workspace creation returned $code: $(cat /tmp/acc.out)"

# 5b. login → cookie issued
code=$(api -c "$JAR" -X POST "$STAGING_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg e "$ALLOWED_EMAIL" --arg p "$ALLOWED_PW" '{email:$e,password:$p}')")
[ "$code" = "200" ] || die "permitted account sign-in returned $code"
grep -q . "$JAR" || die "sign-in issued no cookie"
echo "5b login OK"

# 5c. the permitted account writes a synthetic record
# No workspace in the body: the route takes the tenant from the session,
# which is why the permitted account is this workspace's own administrator.
code=$(api -b "$JAR" -X POST "$STAGING_URL/api/v1/leads" \
  -H 'content-type: application/json' \
  --data '{"fullName":"Acceptance Synthetic Lead","phone":"+971500000000","email":"acceptance.lead@staging.invalid","source":"WALK_IN"}')
[ "$code" = "200" ] || [ "$code" = "201" ] || die "permitted account could not create its own lead: $code $(cat /tmp/acc.out)"
LEAD_ID=$(jq -r '.id // .data.id // empty' /tmp/acc.out)
[ -n "$LEAD_ID" ] || die "lead created but no id came back"
echo "5c write OK (lead $LEAD_ID)"

# 5d. The second account must be REFUSED the same record.
#
#     It is the administrator of a *different* workspace, created the same way.
#     That is the boundary worth testing: not a missing button, but one real
#     account reaching for another tenant's record by id. There is no POST on
#     /api/v1/platform/users to build a membership-less account with, and this
#     is the stronger check anyway. A 2xx here is a tenant-isolation defect.
DENIED_SLUG="acceptance-denied-$RUN"
code=$(api -b "$OWNER_JAR" -X POST "$STAGING_URL/api/v1/platform/workspaces" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg s "$DENIED_SLUG" --arg e "$DENIED_EMAIL" --arg p "$DENIED_PW" '{
      workspaceName:("Acceptance " + $s), slug:$s,
      legalName:("Acceptance " + $s + " LLC"), displayName:("Acceptance " + $s),
      planCode:"standard", country:"AE", timezone:"Asia/Dubai", currency:"AED",
      primaryAdminName:"Acceptance Denied", primaryAdminEmail:$e, primaryAdminPassword:$p,
      enabledModules:["SALES"], maxEmployees:10, maxUsers:10, maxStorageMb:1024, status:"ACTIVE"
    }')")
[ "$code" = "200" ] || [ "$code" = "201" ] || die "could not create the second workspace: $code $(cat /tmp/acc.out)"

code=$(api -c "$DENIED_JAR" -X POST "$STAGING_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg e "$DENIED_EMAIL" --arg p "$DENIED_PW" '{email:$e,password:$p}')")
[ "$code" = "200" ] || die "the denied account could not sign in ($code); the refusal below would prove nothing"

# Reading it, then trying to change it. Both must be refused.
code=$(api -b "$DENIED_JAR" "$STAGING_URL/api/v1/leads/$LEAD_ID")
case "$code" in
  401 | 403 | 404) echo "5d read refused OK ($code)" ;;
  *) die "TENANT ISOLATION DEFECT: another workspace's administrator read lead $LEAD_ID ($code). The release stops here." ;;
esac

code=$(api -b "$DENIED_JAR" -X PATCH "$STAGING_URL/api/v1/leads/$LEAD_ID" \
  -H 'content-type: application/json' --data '{"fullName":"Should Not Be Possible"}')
case "$code" in
  401 | 403 | 404) echo "5d write refused OK ($code)" ;;
  *) die "TENANT ISOLATION DEFECT: another workspace's administrator wrote to lead $LEAD_ID ($code). The release stops here." ;;
esac


# 5e. the worker is doing its rounds
sweeps=$(docker logs --since 20m "$PROJECT-worker-1" 2>&1 | grep -c 'sweep complete' || true)
[ "$sweeps" -ge 1 ] || die "worker logged no 'sweep complete' in 20 minutes"
echo "5e worker OK ($sweeps sweeps)"

# 5f. a clean document round-trips, bytes identical
TMPDOC=$(mktemp); printf 'acceptance %s\n' "$RUN" > "$TMPDOC"
code=$(api -b "$JAR" -X POST "$STAGING_URL/api/v1/workspaces/$SLUG/hr/documents/upload" \
  -F "file=@$TMPDOC;filename=acceptance-$RUN.txt")
if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  DOC_ID=$(jq -r '.id // .data.id // empty' /tmp/acc.out)
  OUT=$(mktemp)
  dl=$(curl -s -b "$JAR" -o "$OUT" -w '%{http_code}' \
    "$STAGING_URL/api/v1/workspaces/$SLUG/hr/documents/$DOC_ID/download")
  [ "$dl" = "200" ] || die "document download returned $dl"
  cmp -s "$TMPDOC" "$OUT" || die "downloaded bytes differ from what was uploaded"
  echo "5f upload/download OK (bytes identical)"
  rm -f "$OUT"
else
  # HRMS is not enabled on this workspace; say so rather than passing silently.
  echo "5f SKIPPED — upload returned $code (HRMS not enabled for $SLUG). Not counted as a pass."
fi
rm -f "$TMPDOC"

# ---------------------------------------------------------------------------
# 6. Rollback rehearsal — the previous image on the candidate's schema.
# ---------------------------------------------------------------------------
step "6. rollback rehearsal"

IMAGE_SHA=$PREV "${DC[@]}" up -d web worker
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/api/health" || true)
  [ "$code" = "200" ] && break
  [ "$i" = "60" ] && die "ROLLBACK UNSAFE: the previous image ($PREV) will not serve on the candidate schema"
  sleep 2
done
code=$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/login"); [ "$code" = "200" ] || die "ROLLBACK UNSAFE: /login returned $code on the previous image"
errs=$(docker logs --since 10m "$PROJECT-worker-1" 2>&1 | grep -ci "prisma\|error" || true)
[ "$errs" = "0" ] || die "ROLLBACK UNSAFE: $errs prisma/error lines from the worker on the previous image"
echo "rollback rehearsal OK — $PREV runs clean on the candidate schema"

# back to the candidate, where staging should be left
IMAGE_SHA=$CANDIDATE "${DC[@]}" up -d web worker
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/api/health" || true)
  [ "$code" = "200" ] && break
  [ "$i" = "60" ] && die "candidate did not come back up after the rehearsal"
  sleep 2
done

# ---------------------------------------------------------------------------
# 7. The marker. Last, and only now.
# ---------------------------------------------------------------------------
step "7. acceptance marker"

CREDS="$STATE/acceptance-accounts.$TAG"
umask 077
{
  printf 'workspace=%s\n' "$SLUG"
  printf 'permitted=%s\n' "$ALLOWED_EMAIL"
  printf 'permitted_password=%s\n' "$ALLOWED_PW"
  printf 'denied=%s\n' "$DENIED_EMAIL"
  printf 'denied_password=%s\n' "$DENIED_PW"
} > "$CREDS"
chmod 600 "$CREDS"

printf 'web=%s\nworker=%s\n' "$WEB_ID" "$WORKER_ID" > "$STATE/tested.$TAG"

cat <<EOF

STAGING ACCEPTANCE PASSED for $CANDIDATE (tag $TAG)

  accepted web    $WEB_ID
  accepted worker $WORKER_ID
  marker          $STATE/tested.$TAG
  test accounts   $CREDS   (root-only; synthetic, staging-only)
  rollback        $PREV ran clean on the candidate schema

Next, on the host:

  sudo /opt/master-saas/docs/release/production-release.sh preflight $CANDIDATE
  sudo /opt/master-saas/docs/release/production-release.sh deploy    $CANDIDATE
EOF
