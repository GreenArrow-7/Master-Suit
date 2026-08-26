#!/usr/bin/env bash
#
# Build, promote and roll back a release by commit.
#
# ── What deployment was before this ─────────────────────────────────────────
#
#   git pull && dc build && dc run --rm migrate && dc up -d
#
# Four correct commands with one property missing: nothing identifies what is
# running. Compose auto-names an image after the project and service and
# overwrites it on every build, so the previous release stopped existing the
# moment the next one was built. The assessment recorded the consequence:
# "rollback means rebuilding a previous commit — there is no image registry and
# no tagged artifact to roll back to". Rebuilding takes 10–20 minutes on the
# deployment VM, which is 10–20 minutes into an incident before anything
# improves.
#
# ── What it is now ──────────────────────────────────────────────────────────
#
#   scripts/release.sh staging                 build this commit, deploy to staging
#   scripts/release.sh production              deploy the tag staging is running
#   scripts/release.sh production <commit>     deploy a specific commit
#   scripts/release.sh rollback production     start the previous tag again
#   scripts/release.sh status                  what is running, and what can be rolled back to
#
# Images are tagged `master-suite/web:<commit>`. No registry: on a single VM the
# two Compose projects share one Docker daemon and therefore one image store, so
# promotion is production *starting the tag staging built* rather than building
# its own copy of the same source. That is the difference between "the same
# commit" and "the same bytes", and it is the whole point of promoting.
#
# On separate hosts this needs a registry — push after the staging build and pull
# before the production start. The tag scheme does not change; see
# docs/DEPLOY-STAGING.md.

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="${APP_DIR}/infra"
STATE_DIR="${RELEASE_STATE_DIR:-/var/lib/master-suite}"

say()  { printf '[release] %s\n' "$1"; }
fail() { printf '\n[release] %s\n\n' "$1" >&2; exit 1; }

dc_for() {
  case "$1" in
    staging)
      echo "docker compose --env-file ${APP_DIR}/.env.staging -f ${INFRA}/docker-compose.yml -f ${INFRA}/docker-compose.prod.yml -f ${INFRA}/docker-compose.staging.yml" ;;
    production)
      echo "docker compose --env-file ${APP_DIR}/.env.production -f ${INFRA}/docker-compose.yml -f ${INFRA}/docker-compose.prod.yml -f ${INFRA}/docker-compose.azure.yml" ;;
    *) fail "Unknown environment '$1'. Use staging or production." ;;
  esac
}

# The tag currently deployed to an environment, recorded at deploy time rather
# than inferred: `docker ps` shows the image a container started with, which is
# the same answer until somebody retags, and then quietly is not.
current_file() { echo "${STATE_DIR}/$1.current"; }
previous_file() { echo "${STATE_DIR}/$1.previous"; }
read_tag() { [ -f "$1" ] && cat "$1" || echo ''; }

# ── status ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = 'status' ]; then
  for envname in staging production; do
    printf '  %-11s current=%-14s previous=%-14s\n' \
      "${envname}" "$(read_tag "$(current_file "${envname}")" || echo '-')" \
      "$(read_tag "$(previous_file "${envname}")" || echo '-')"
  done
  echo
  say 'images available to roll back to:'
  docker image ls 'master-suite/web' --format '  {{.Tag}}  {{.CreatedSince}}  {{.Size}}' 2>/dev/null || true
  exit 0
fi

# ── rollback ────────────────────────────────────────────────────────────────
#
# Deliberately does not touch the database. `migrate deploy` has no down-path,
# and a migration is written backward-compatible where practical precisely so
# the application can go back without the schema going back. If a release
# shipped a migration the previous code cannot live with, that is a
# forward-fix — see docs/ENVIRONMENTS.md.
if [ "${1:-}" = 'rollback' ]; then
  ENVIRONMENT="${2:?usage: release.sh rollback <staging|production>}"
  DC="$(dc_for "${ENVIRONMENT}")"
  PREVIOUS="$(read_tag "$(previous_file "${ENVIRONMENT}")")"
  [ -n "${PREVIOUS}" ] || fail "No previous tag recorded for ${ENVIRONMENT}. Nothing to roll back to."
  docker image inspect "master-suite/web:${PREVIOUS}" >/dev/null 2>&1 ||
    fail "Image master-suite/web:${PREVIOUS} is no longer on this host. Rebuild that commit: release.sh ${ENVIRONMENT} ${PREVIOUS}"

  CURRENT="$(read_tag "$(current_file "${ENVIRONMENT}")")"
  say "rolling ${ENVIRONMENT} back: ${CURRENT:-unknown} -> ${PREVIOUS}"
  say 'the database is NOT rolled back — migrate deploy has no down-path (docs/ENVIRONMENTS.md)'

  IMAGE_TAG="${PREVIOUS}" ${DC} up -d --no-build
  install -d -m 755 "${STATE_DIR}"
  echo "${PREVIOUS}" > "$(current_file "${ENVIRONMENT}")"
  # The tag we just left becomes the thing to roll *forward* to, so a rollback
  # can be undone with the same command.
  echo "${CURRENT}" > "$(previous_file "${ENVIRONMENT}")"
  say "done. ${ENVIRONMENT} is on ${PREVIOUS}"
  exit 0
fi

# ── deploy ──────────────────────────────────────────────────────────────────
ENVIRONMENT="${1:?usage: release.sh <staging|production|rollback|status> [commit]}"
DC="$(dc_for "${ENVIRONMENT}")"

if [ -n "${2:-}" ]; then
  TAG="$(git -C "${APP_DIR}" rev-parse --short=12 "$2")" || fail "Not a commit: $2"
elif [ "${ENVIRONMENT}" = 'production' ]; then
  # Promotion. Production does not choose its own commit — it takes the one
  # staging is running, which is what makes "staging first" mean the same
  # artefact rather than the same branch name.
  TAG="$(read_tag "$(current_file staging)")"
  [ -n "${TAG}" ] || fail "Staging has no recorded release. Deploy there first: release.sh staging"
  say "promoting the tag staging is running: ${TAG}"
else
  TAG="$(git -C "${APP_DIR}" rev-parse --short=12 HEAD)"
fi

# A build from a dirty tree is not the commit it claims to be, and the tag is
# the only thing anyone will have to go on afterwards.
if [ -n "$(git -C "${APP_DIR}" status --porcelain)" ] && [ "${ALLOW_DIRTY_RELEASE:-}" != 'yes' ]; then
  fail "The working tree has uncommitted changes, so the image would be tagged with a commit it does not contain.
        Commit them, or say ALLOW_DIRTY_RELEASE=yes if you know what this is."
fi

# ── The tree and the tag have to agree ──────────────────────────────────────
#
# Migrations are read from `prisma/migrations` in the working tree, not from the
# image. Deploying tag X while the tree sits at Y would apply Y's migrations to a
# deployment running X's code — a schema from the future under an application
# that has never seen it.
#
# The normal flow cannot hit this: `git pull` puts HEAD at the commit staging
# built, and promotion takes that same tag. It is reachable only by naming an
# older commit explicitly, which is a rollback wearing a deploy's clothes.
HEAD_TAG="$(git -C "${APP_DIR}" rev-parse --short=12 HEAD)"
if [ "${TAG}" != "${HEAD_TAG}" ]; then
  fail "You asked to deploy ${TAG}, but the working tree is at ${HEAD_TAG}.
        Migrations are read from the tree, so this would apply ${HEAD_TAG}'s migrations under
        ${TAG}'s code. Check that commit out first:

            git -C ${APP_DIR} checkout ${TAG}

        Going backwards? Use 'release.sh rollback ${ENVIRONMENT}', which starts the previous
        image and deliberately leaves the schema alone."
fi

BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export IMAGE_TAG="${TAG}" BUILD_TIME

# ── 1. Image ────────────────────────────────────────────────────────────────
# Skipped when the tag already exists, which is what makes a production deploy a
# promotion: the bytes staging exercised are the bytes production starts, not a
# second build of the same source that may differ by a base-image digest.
if docker image inspect "master-suite/web:${TAG}" >/dev/null 2>&1; then
  say "image master-suite/web:${TAG} already exists — promoting it, not rebuilding"
else
  say "building master-suite/{web,worker}:${TAG} ..."
  ${DC} build
fi

# ── 2. Migrations ───────────────────────────────────────────────────────────
# Before the new image starts, which is correct for additive migrations and
# unsafe for a drop or rename — the old container is still serving during it.
# On production this is also the staging-first gate (scripts/check-staging-first.mjs).
say 'running migrations ...'
${DC} --profile tools run --rm migrate

# ── 3. Start ────────────────────────────────────────────────────────────────
say "starting ${ENVIRONMENT} on ${TAG} ..."
${DC} up -d --no-build

# ── 4. Record ───────────────────────────────────────────────────────────────
install -d -m 755 "${STATE_DIR}"
PREVIOUS="$(read_tag "$(current_file "${ENVIRONMENT}")")"
[ -n "${PREVIOUS}" ] && [ "${PREVIOUS}" != "${TAG}" ] && echo "${PREVIOUS}" > "$(previous_file "${ENVIRONMENT}")"
echo "${TAG}" > "$(current_file "${ENVIRONMENT}")"

say "${ENVIRONMENT} is on ${TAG}"
[ -n "${PREVIOUS}" ] && say "roll back with: scripts/release.sh rollback ${ENVIRONMENT}   (-> ${PREVIOUS})"

# What the deployment says about itself, rather than what this script believes.
say 'confirm with: curl -H "Authorization: Bearer $METRICS_TOKEN" http://web:3000/api/metrics | grep build_info'
