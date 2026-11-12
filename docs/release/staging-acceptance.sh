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
STATE=${STATE:-/var/lib/master-suite}
# The checkout on the host. production-release.sh:16 is the authority for this
# path, and it says /opt/mastersuite; /opt/master-saas does not exist there.
APP=${APP:-/opt/mastersuite}
PROJECT=youhan-ios-staging

# Asked of docker, not assumed: this stack publishes web on the bridge address
# (172.18.0.1:8090), not on loopback, and PRODUCTION-RELEASE-PROCEDURE.md's
# table records every other port but not this one.
STAGING_URL=${STAGING_URL:-http://$(docker port "$PROJECT-web-1" 3000/tcp 2>/dev/null | head -1)}
case "$STAGING_URL" in
  http://*:*) ;;
  *) die "could not read the published web port from $PROJECT-web-1; set STAGING_URL yourself" ;;
esac

# Checked here rather than discovered at minute nine of a run.
for tool in docker jq curl openssl rsync cmp psql_in_container; do
  case "$tool" in
    psql_in_container) : ;;
    *) command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed; this script needs docker, jq, curl, openssl, rsync and cmp" ;;
  esac
done

# Discovered here rather than at minute nine: without a terminal there is
# nowhere to ask for the second factor when phase 5 needs it.
[ -n "${PLATFORM_OWNER_TOTP:-}" ] || [ -r /dev/tty ] || die "no terminal to read the authenticator code from; pass PLATFORM_OWNER_TOTP"

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

# This host's own identifiers, from docs/PRODUCTION-RELEASE-PROCEDURE.md:18-24,
# which describes what is actually deployed rather than what a design document
# intended. Overridable, because a second host will not share them.
PRODUCTION_DB=${PRODUCTION_DB:-leadflow}
PRODUCTION_PG=${PRODUCTION_PG:-infra-postgres-1}
STAGING_DB_EXPECTED=${STAGING_DB_EXPECTED:-youhan_ios_demo}

# Every finding, not the first. A guard that dies on finding one costs a round
# trip per problem, and the person running it is on a different continent.
problems=()
note() { problems+=("$1"); }

STAGING_DB_URL=$(env_of DATABASE_URL)
STAGING_APP_ENV=$(env_of APP_ENV)
[ -n "$STAGING_DB_URL" ] || die "DATABASE_URL is not set in $STAGING_ENV"

# The database name only — never the credentials.
STAGING_DB_NAME=$(printf '%s' "$STAGING_DB_URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')

# The decisive refusal: it must not be production's database.
if [ "$STAGING_DB_NAME" = "$PRODUCTION_DB" ]; then
  note "DATABASE_URL points at the production database '$PRODUCTION_DB'."
fi
# And it must be a database this host recognises as staging's. A naming
# convention is not required — this host does not use one — but an unknown
# name is still refused, because "not production" is not the same as "staging".
case "$STAGING_DB_NAME" in
  "$STAGING_DB_EXPECTED" | *_staging | *_test | *_e2e) : ;;
  *)
    note "DATABASE_URL points at '$STAGING_DB_NAME', which this host does not know as a staging database (expected '$STAGING_DB_EXPECTED'). Set STAGING_DB_EXPECTED if that is wrong."
    ;;
esac

# Not "must equal staging": this host's staging env may legitimately say
# something else. What must never be true is that it says production.
case "${STAGING_APP_ENV:-}" in
  production) note "APP_ENV in $STAGING_ENV is 'production'." ;;
esac

# The containers this script will drive must be staging's, and production's
# must be untouched by it. `infra-*` is the production project.
containers_ok=yes
for c in web worker postgres; do
  name="$PROJECT-$c-1"
  case "$name" in infra-*) note "refusing to act on a production container ($name)." ;; esac
  docker inspect "$name" >/dev/null 2>&1 || {
    note "$name is not running; bring staging up first."
    containers_ok=no
  }
done

LIVE_DB=''
if [ "$containers_ok" = yes ]; then
  # Ask the database it is actually connected to for its own name, rather than
  # trusting the string in the file. The role comes from the container, not
  # from production's name.
  PGUSER_IN_CONTAINER=$(docker inspect "$PROJECT-postgres-1" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^POSTGRES_USER=//p' | head -1)
  PGUSER_IN_CONTAINER=${PGUSER_IN_CONTAINER:-postgres}
  LIVE_DB=$(docker exec "$PROJECT-postgres-1" psql -U "$PGUSER_IN_CONTAINER" -d "$STAGING_DB_NAME" \
    -tAc 'SELECT current_database()' 2>/dev/null | tr -d '[:space:]')
  if [ -z "$LIVE_DB" ]; then
    note "could not ask $PROJECT-postgres-1 for its own database name as '$PGUSER_IN_CONTAINER'."
  elif [ "$LIVE_DB" != "$STAGING_DB_NAME" ]; then
    note "staging postgres answered '$LIVE_DB', expected '$STAGING_DB_NAME'."
  elif [ "$LIVE_DB" = "$PRODUCTION_DB" ]; then
    note "staging postgres IS the production database."
  fi

  # Production's postgres, if it is on this host, must be a different container.
  if docker inspect "$PRODUCTION_PG" >/dev/null 2>&1; then
    s=$(docker inspect "$PROJECT-postgres-1" --format '{{.Id}}')
    p=$(docker inspect "$PRODUCTION_PG" --format '{{.Id}}')
    [ "$s" != "$p" ] || note "staging and production resolve to the same postgres container."
  fi
fi

# Mail must not leave the host. Staging sends to Mailpit; a real relay here
# would mean these synthetic accounts email real addresses.
MAIL_HOST=$(env_of SMTP_HOST)
case "${MAIL_HOST:-}" in
  *mailpit* | *localhost* | 127.0.0.1 | mailhog | '') : ;;
  *) note "SMTP_HOST is '$MAIL_HOST' — a real relay, so these synthetic accounts would email out." ;;
esac

if [ ${#problems[@]} -gt 0 ]; then
  printf '\nSTAGING ACCEPTANCE FAILED: staging is not provably isolated from production.\n\n' >&2
  for p in "${problems[@]}"; do printf '  - %s\n' "$p" >&2; done
  printf '\nNothing was created or changed.\n' >&2
  exit 1
fi

echo "isolation OK · db=$LIVE_DB · APP_ENV=${STAGING_APP_ENV:-unset} · mail=${MAIL_HOST:-mailpit} · project=$PROJECT"

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
PREV=${PREVIOUS_IMAGE:-$(docker inspect "$PROJECT-web-1" --format '{{.Config.Image}}' | sed 's/.*://')}
[ -n "$PREV" ] || die "could not read the image staging is currently running"
# A failed earlier run can leave the candidate itself running, and then the
# rollback rehearsal in phase 6 rolls back to the candidate: it passes having
# rehearsed nothing, and phase 7 writes a marker that was never earned.
[ "$PREV" != "$CANDIDATE" ] || die "staging is already running the candidate, so there is no previous image to
rehearse the rollback against. A run that got as far as phase 4 and then failed
leaves it this way. Name the image to roll back to:

    PREVIOUS_IMAGE=<the 40-char sha staging ran before> $0 $CANDIDATE"
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

# Everything that talks to staging's database goes through the container: it
# publishes no port, so the host cannot reach it, and the role is the one the
# container was built with rather than production's.
sql() { docker exec "$PROJECT-postgres-1" psql -U "$PGUSER_IN_CONTAINER" -d "$STAGING_DB_NAME" -tAc "$1"; }

# What this candidate carries that staging has not finished, by name.
PENDING=$(comm -23 \
  <(ls -1 "$STAGING_DIR/prisma/migrations" 2>/dev/null | grep -E '^[0-9]+_' | sort) \
  <(sql 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL' | tr -d '\r' | sort))

if [ -z "$PENDING" ]; then
  echo "migrations: nothing pending — staging already has every migration this candidate carries"
else
  # shortcut: a candidate with pending migrations cannot be applied from here,
  # because MIGRATION_DATABASE_URL names the compose hostname `postgres` and
  # staging publishes no port to the host. Upgrade this to a one-off container
  # on the staging network when a release actually carries a migration.
  printf '\nSTAGING ACCEPTANCE FAILED: this candidate carries migrations staging has not applied:\n\n' >&2
  printf '  %s\n' $PENDING >&2
  printf '\nApply them the way docs/DEPLOY-STAGING.md describes, then run this again.\n' >&2
  printf 'They cannot be applied from here: MIGRATION_DATABASE_URL points at the\n' >&2
  printf 'compose hostname postgres:5432, which only resolves inside the stack.\n' >&2
  exit 1
fi

FAILED=$(sql 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL' | tr -d '[:space:]')
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

OWNER_EMAIL=${PLATFORM_OWNER_EMAIL:-$(env_of PLATFORM_OWNER_EMAIL)}
OWNER_PW=${PLATFORM_OWNER_PASSWORD:-$(env_of PLATFORM_OWNER_PASSWORD)}
[ -n "$OWNER_EMAIL" ] && [ -n "$OWNER_PW" ] ||
  die "PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD are neither in the
environment nor in $STAGING_ENV. Pass them for this run only, without writing
them to disk:

    read -rsp 'owner password: ' P && echo
    PLATFORM_OWNER_EMAIL=<owner email> PLATFORM_OWNER_PASSWORD=\"\$P\" \
      PLATFORM_OWNER_TOTP=<code> $0 $CANDIDATE"

JAR=$(mktemp); OWNER_JAR=$(mktemp); DENIED_JAR=$(mktemp)
trap 'rm -f "$JAR" "$OWNER_JAR" "$DENIED_JAR"' EXIT

api() { curl -s -o /tmp/acc.out -w '%{http_code}' "$@"; }

# A wizard-issued credential is administrator-known, so the product forces a
# change at first sign-in (passwordChangedAt null -> /profile/security) and
# nothing else opens until it happens. Both accounts are settled through the
# real endpoints, exactly as tests/e2e/helpers.ts does it.
settle() {
  local slug=$1 who=$2 pw=$3 jar=$4
  local tmp="$pw-tmp0"
  local j; j=$(mktemp)
  code=$(api -c "$j" -X POST "$STAGING_URL/api/v1/auth/login" \
    -H 'content-type: application/json' \
    --data "$(jq -nc --arg e "$who" --arg p "$tmp" '{email:$e,password:$p}')")
  [ "$code" = "200" ] || die "settling sign-in for $who returned $code"
  code=$(api -b "$j" -X POST "$STAGING_URL/api/v1/workspaces/$slug/identity/self/password-change" \
    -H 'content-type: application/json' \
    --data "$(jq -nc --arg c "$tmp" --arg n "$pw" '{currentPassword:$c,newPassword:$n}')")
  [ "$code" = "200" ] || [ "$code" = "204" ] || die "password settle for $who returned $code: $(cat /tmp/acc.out)"
  rm -f "$j"
  # And now the real password, which is also proof the change took.
  code=$(api -c "$jar" -X POST "$STAGING_URL/api/v1/auth/login" \
    -H 'content-type: application/json' \
    --data "$(jq -nc --arg e "$who" --arg p "$pw" '{email:$e,password:$p}')")
  [ "$code" = "200" ] || die "sign-in for $who after the password change returned $code"
}


# 5a. the platform owner creates a workspace with its own administrator
#
# The owner is a privileged platform role, and `src/lib/auth/login.ts` requires
# a second factor for those unconditionally — enrolled or not. The endpoint
# takes email, password and mfaCode in one request, so the code comes from the
# operator's authenticator at run time and is never stored anywhere.
# Asked for here rather than before phase 1: a TOTP code lives 30 seconds and
# phases 1-4 take minutes, so a code given at the start has always rotated by
# the time this sign-in happens. The earlier version of this script collected it
# up front and could only ever return 401.
if [ -z "${PLATFORM_OWNER_TOTP:-}" ]; then
  printf '
The platform owner always needs a second factor. Six digits showing now: ' >/dev/tty
  read -r PLATFORM_OWNER_TOTP </dev/tty
  printf '
' >/dev/tty
fi
case "${PLATFORM_OWNER_TOTP:-}" in
  [0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) die "the authenticator code must be six digits" ;;
esac

code=$(api -c "$OWNER_JAR" -X POST "$STAGING_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg e "$OWNER_EMAIL" --arg p "$OWNER_PW" --arg m "$PLATFORM_OWNER_TOTP" \
      '{email:$e,password:$p,mfaCode:$m}')")
case "$code" in
  200) : ;;
  401 | 422) die "platform owner sign-in returned $code — a wrong password, or a code that had already rotated. Take a fresh one and run again." ;;
  *) die "platform owner sign-in returned $code" ;;
esac

code=$(api -b "$OWNER_JAR" -X POST "$STAGING_URL/api/v1/platform/workspaces" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg s "$SLUG" --arg e "$ALLOWED_EMAIL" --arg p "$ALLOWED_PW" '{
      workspaceName:("Acceptance " + $s), slug:$s,
      legalName:("Acceptance " + $s + " LLC"), displayName:("Acceptance " + $s),
      planCode:"standard", country:"AE", timezone:"Asia/Dubai", currency:"AED",
      primaryAdminName:"Acceptance Administrator", primaryAdminEmail:$e, primaryAdminPassword:($p + "-tmp0"),
      enabledModules:["SALES","HRMS"], maxEmployees:10, maxUsers:10, maxStorageMb:1024, status:"ACTIVE"
    }')")
[ "$code" = "200" ] || [ "$code" = "201" ] || die "workspace creation returned $code: $(cat /tmp/acc.out)"

# 5b. the password is settled, then the account signs in -> cookie issued
settle "$SLUG" "$ALLOWED_EMAIL" "$ALLOWED_PW" "$JAR"
grep -q . "$JAR" || die "sign-in issued no cookie"
echo "5b login OK (password settled)"

# 5c. the permitted account writes a synthetic record
# No workspace in the body: the route takes the tenant from the session,
# which is why the permitted account is this workspace's own administrator.
code=$(api -b "$JAR" -X POST "$STAGING_URL/api/v1/leads" \
  -H 'content-type: application/json' \
  --data '{"fullName":"Acceptance Synthetic Lead","phone":"+971500000000","email":"acceptance.lead@staging.invalid","source":"MANUAL"}')
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
      primaryAdminName:"Acceptance Denied", primaryAdminEmail:$e, primaryAdminPassword:($p + "-tmp0"),
      enabledModules:["SALES"], maxEmployees:10, maxUsers:10, maxStorageMb:1024, status:"ACTIVE"
    }')")
[ "$code" = "200" ] || [ "$code" = "201" ] || die "could not create the second workspace: $code $(cat /tmp/acc.out)"

settle "$DENIED_SLUG" "$DENIED_EMAIL" "$DENIED_PW" "$DENIED_JAR"

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
#
# The upload needs an employee and a kind, not just a file, and an employee
# needs HRMS — which is why this workspace is created with both modules. An
# unknown roleKey is the documented path: the endpoint creates a starter role
# at the lowest rank and issues an invitation rather than an account.
code=$(api -b "$JAR" -X POST "$STAGING_URL/api/v1/workspaces/$SLUG/hr/employees" \
  -H 'content-type: application/json' \
  --data "$(jq -nc --arg r "acceptance-staff-$RUN" --arg e "acceptance.staff.$RUN@staging.invalid" \
      '{fullName:"Acceptance Staff", employeeNumber:("E-" + ($r|split("-")|last)), email:$e, roleKey:$r}')")
[ "$code" = "200" ] || [ "$code" = "201" ] || die "could not create the employee for the document check: $code $(cat /tmp/acc.out)"
EMPLOYEE_ID=$(jq -r '.id // .employee.id // .data.id // empty' /tmp/acc.out)
[ -n "$EMPLOYEE_ID" ] || die "employee created but no id came back: $(cat /tmp/acc.out)"

TMPDOC=$(mktemp); printf 'acceptance %s\n' "$RUN" > "$TMPDOC"
code=$(api -b "$JAR" -X POST "$STAGING_URL/api/v1/workspaces/$SLUG/hr/documents/upload" \
  -F "employeeId=$EMPLOYEE_ID" -F "kind=CONTRACT" -F "file=@$TMPDOC;filename=acceptance-$RUN.txt")
[ "$code" = "200" ] || [ "$code" = "201" ] || die "document upload returned $code: $(cat /tmp/acc.out)"
DOC_ID=$(jq -r '.id // .document.id // .data.id // empty' /tmp/acc.out)
[ -n "$DOC_ID" ] || die "document uploaded but no id came back: $(cat /tmp/acc.out)"

# The scanner marks a fresh upload PENDING and only then CLEAN; download is
# refused until it is CLEAN, so this waits rather than calling it a failure.
OUT=$(mktemp); dl=000
for _ in $(seq 1 30); do
  dl=$(curl -s -b "$JAR" -o "$OUT" -w '%{http_code}' \
    "$STAGING_URL/api/v1/workspaces/$SLUG/hr/documents/$DOC_ID/download")
  [ "$dl" = "200" ] && break
  sleep 2
done
[ "$dl" = "200" ] || die "document download returned $dl after 60s (scan never reached CLEAN)"
cmp -s "$TMPDOC" "$OUT" || die "downloaded bytes differ from what was uploaded"
echo "5f upload/download OK (bytes identical)"
rm -f "$TMPDOC" "$OUT"

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
