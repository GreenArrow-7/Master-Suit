#!/usr/bin/env bash
#
# Rotates FACE_SERVICE_TOKEN without a failed check-in.
#
# ── Why a script rather than "edit the env file" ────────────────────────────
#
# The face sidecar turns camera frames into biometric vectors, and the only
# thing between it and the network is one shared bearer token. The assessment
# records the problem as M-7: there was no rotation path. Both sides read a
# single value, so changing it meant a window where the application sent the old
# token and the service accepted only the new one — every check-in a 401, nobody
# able to start their shift. Faced with that, nobody rotates it, and the secret
# lives forever.
#
# apps/face/tokens.py now accepts a second, outgoing token, which makes the
# rotation three ordered steps with no window. This script performs them, in
# order, against one env file, restarting the right container between each:
#
#   1. face: new token in, old token still accepted
#   2. web:  start sending the new token
#   3. face: stop accepting the old one
#
# Step 3 is the one that gets skipped when this is done by hand, and skipping it
# leaves a second live credential nobody is watching — which is most of the risk
# the rotation was for. The script does not offer a way to stop after step 2.
#
#   scripts/rotate-face-token.sh /opt/master-suite/.env.production
#
# ── What it does not do ─────────────────────────────────────────────────────
#
# It does not run itself. There is no timer, deliberately: this restarts the
# service that attendance depends on, twice, and an unattended job that rewrites
# a secret and bounces containers at 03:00 is a worse failure than a stale token.
# The schedule is enforced by noticing instead — FACE_SERVICE_TOKEN_ROTATED_AT is
# written here, the metrics endpoint publishes its age, and the
# FaceServiceTokenStale alert fires when it exceeds FACE_TOKEN_MAX_AGE_DAYS.
set -euo pipefail

ENV_FILE="${1:-${ENV_FILE:-.env}}"
COMPOSE="${COMPOSE:-docker compose}"
# The overlay set the deployment runs. Azure and staging each layer one on the
# base file, and restarting with the wrong set would start a different stack.
COMPOSE_FILES="${COMPOSE_FILES:--f infra/docker-compose.yml}"
# Set to anything to print the steps without touching the file or the containers.
DRY_RUN="${ROTATE_FACE_TOKEN_DRY_RUN:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf '\nrotate-face-token: %s\n\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE — pass the path as the first argument."

# ── Read the token being retired ────────────────────────────────────────────
#
# Read, never printed. The value is a live credential; it goes from the file to
# the file, and the only thing this script says about it is its length.
current="$(sed -n 's/^FACE_SERVICE_TOKEN=//p' "$ENV_FILE" | head -1)"
[ -n "$current" ] || die "FACE_SERVICE_TOKEN is empty or absent in $ENV_FILE — there is nothing to rotate."

previous_line="$(sed -n 's/^FACE_SERVICE_TOKEN_PREVIOUS=//p' "$ENV_FILE" | head -1)"
[ -z "$previous_line" ] || die \
  "FACE_SERVICE_TOKEN_PREVIOUS is already set in $ENV_FILE.
   A rotation is already in progress, or the last one never finished step 3.
   Finish it first: confirm the application is sending the current token, then
   clear FACE_SERVICE_TOKEN_PREVIOUS and restart the face service."

# base64url, so the value is safe in an env file, a URL and a shell without
# quoting — the same reasoning as scripts/generate-secrets.mjs.
new="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')"
[ "${#new}" -ge 43 ] || die "generated token is implausibly short (${#new} chars); refusing to install it."

stamp="$(date -u +%Y-%m-%d)"

say "Rotating FACE_SERVICE_TOKEN in $ENV_FILE"
note "retiring a token of ${#current} characters"
note "installing a token of ${#new} characters"
note "env file:  $ENV_FILE"
note "compose:   $COMPOSE $COMPOSE_FILES"
[ -n "$DRY_RUN" ] && note "DRY RUN — nothing will be written or restarted"

# ── A backup, before anything is edited ─────────────────────────────────────
#
# This file holds every secret the deployment has. A sed that goes wrong here is
# an outage of everything, not just attendance.
backup="${ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
if [ -z "$DRY_RUN" ]; then
  cp -p "$ENV_FILE" "$backup"
  chmod 600 "$backup"
  note "backup:    $backup"
else
  # A dry run has no backup to name, and the closing note must not send an
  # operator looking for a file that was never written.
  backup="(none — dry run)"
fi

# Writes `KEY=value` into the env file, replacing any existing line for KEY.
#
# A temp file in the same directory then `mv`, rather than `sed -i`: the move is
# atomic, so a process reading the file never sees it half-written, and an
# interrupted run leaves the original intact rather than truncated.
#
# The line is replaced where it already sits, and only appended when the key is
# new. Deleting and re-appending is simpler and was what this did first, but it
# reshuffles the file on every rotation — and this is the file an operator reads
# during an incident, so it should look the same each time they open it.
set_var() {
  local key="$1" value="$2" tmp
  [ -n "$DRY_RUN" ] && return 0
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  chmod 600 "$tmp"
  KEY="$key" VALUE="$value" awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; done = 0 }
    # Substring, not a regex or a sub(): a token can contain any base64url
    # character, and & in a replacement means "the whole match" to sub().
    index($0, key "=") == 1 { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

restart() {
  local service="$1"
  [ -n "$DRY_RUN" ] && { note "would restart: $service"; return 0; }
  # shellcheck disable=SC2086 — COMPOSE_FILES is a deliberate word-split list of -f flags.
  $COMPOSE $COMPOSE_FILES up -d --force-recreate "$service"
}

# ── Step 1: the face service accepts both ───────────────────────────────────
say "1/3  face: accept the new token, keep accepting the old one"
set_var FACE_SERVICE_TOKEN_PREVIOUS "$current"
set_var FACE_SERVICE_TOKEN "$new"
set_var FACE_SERVICE_TOKEN_ROTATED_AT "$stamp"
restart face
note "the application is still sending the retired token, and it is still accepted."

# ── Step 2: the application sends the new one ───────────────────────────────
say "2/3  web: send the new token"
# Same file, same variable — web and face read FACE_SERVICE_TOKEN from it. The
# step is a restart, not an edit: the value is already the new one.
restart web
[ -n "$DRY_RUN" ] || restart worker 2>/dev/null || true
note "check-in now authenticates with the new token."

# ── Step 3: retire the old one ──────────────────────────────────────────────
say "3/3  face: stop accepting the retired token"
set_var FACE_SERVICE_TOKEN_PREVIOUS ""
restart face

say "Done."
note "rotated on $stamp; the next one is due within FACE_TOKEN_MAX_AGE_DAYS."
note "verify with a real check-in before deleting $backup."
