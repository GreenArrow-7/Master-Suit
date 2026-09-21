#!/usr/bin/env bash
#
# Docker image retention for the master-suite production host.
#
# ── The rule this exists to protect ─────────────────────────────────────────
#
# There is no image registry for production (scripts/release.sh says so in its
# own header): a rollback works because the previous image is still on this
# disk. So every deletion here is a deletion of rollback capability, and the
# protected set below is not a nicety — it is the recovery path.
#
# Never `docker system prune -a`. Never `rmi -f`: a tag a container holds must
# refuse to be removed, not be forced out from under it. Volumes, databases,
# uploads, secrets, backups and configuration are never touched.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   ms-image-retention.sh              dry run — print what would go
#   ms-image-retention.sh --apply      reclaim it
#   ms-image-retention.sh --auto       apply only at/above AUTO_PCT (for the timer)
#
# ── Protected, unconditionally ──────────────────────────────────────────────
#
#   production.current, production.previous        $STATE_DIR
#   newest $RETAIN verified releases               $STATE_DIR/tested.<sha>
#   ios-staging.current, ios-staging.previous      $STAGING_DIR
#   IMAGE_SHA in the LIVE staging env file         $STAGING_DIR/.env.ios-staging
#   IMAGE_SHA in recent staging env backups        see BAK_KEEP / BAK_MAX_AGE_DAYS
#   infra-migrate:latest                           built from the tree, no registry to pull from
#   every image any container references           running or exited
#
# ── Why backup env files expire ─────────────────────────────────────────────
#
# An earlier revision protected every IMAGE_SHA in every historical .bak-* env
# file. That is a ratchet: each deploy leaves another backup, each backup pins
# another image pair forever, and the disk fills again on exactly the images
# this script was written to remove. A backup now protects its image only while
# it is one of the newest $BAK_KEEP AND younger than $BAK_MAX_AGE_DAYS.
set -euo pipefail

STATE_DIR=${MS_STATE_DIR:-/var/lib/master-suite}
STAGING_DIR=${MS_STAGING_DIR:-/home/deploy/ios-staging}
RETAIN=${RETAIN:-5}
AUTO_PCT=${AUTO_PCT:-80}
BAK_KEEP=${BAK_KEEP:-2}
BAK_MAX_AGE_DAYS=${BAK_MAX_AGE_DAYS:-30}

log() { printf '%s\n' "$*"; }

# ── Seams ───────────────────────────────────────────────────────────────────
# The decision is a pure function of three inputs: the metadata on disk, the
# image list, and the ids containers hold. Tests supply all three as files so
# the protected-SHA calculation can be exercised without a Docker daemon and
# without deleting anything. See test/retention-test.sh.
image_list() {
  if [ -n "${MS_IMAGE_LIST_FILE:-}" ]; then cat "$MS_IMAGE_LIST_FILE"
  else docker images --no-trunc --format '{{.ID}}|{{.Repository}}|{{.Tag}}'
  fi
}
held_ids() {
  if [ -n "${MS_HELD_IDS_FILE:-}" ]; then cat "$MS_HELD_IDS_FILE"
  else docker ps -aq | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null
  fi
}
remove_tag() {
  if [ -n "${MS_RMI_LOG:-}" ]; then printf '%s\n' "$1" >> "$MS_RMI_LOG"; return 0; fi
  docker rmi "$1" >/dev/null 2>&1
}

# ── Refuse to race a build or a deploy ──────────────────────────────────────
# Pulling a layer out from under a running build, or removing a tag a deploy is
# about to start, is the one way this script can cause the incident it prevents.
busy() {
  [ "${MS_BUSY:-}" = '1' ] && return 0
  [ "${MS_BUSY:-}" = '0' ] && return 1

  # In-flight buildkit work: the ACTIVE column of the `Build Cache` row. The
  # {{.BuildCacheActive}} template field does not exist -- it renders a parse
  # error, which compares unequal to "0" and wedges this permanently busy.
  local active
  active=$(docker system df 2>/dev/null | awk '/^Build Cache/{print $4}')
  if [ -n "$active" ] && [ "$active" != "0" ]; then return 0; fi

  # A deploy in progress. Matched on the scripts' paths, not a bare "release.sh":
  # pgrep -f reads every cmdline including the shell holding this very pattern,
  # so a loose pattern reliably matches itself.
  local pids
  pids=$(pgrep -f '/stage-run\.sh|/scripts/release\.sh' 2>/dev/null \
         | grep -vx "$$" | grep -vx "$PPID" || true)
  [ -n "$pids" ] && return 0
  return 1
}

# ── The protected set ───────────────────────────────────────────────────────
# Prints 12-character shas, one per line, sorted and unique. Release tags are
# 12 chars locally and 40 in the ghcr mirror, so everything is cut to 12 and
# compared on that prefix -- otherwise the mirror tag of a protected release
# reads as unprotected and the rollback pair is half-deleted.
protected_shas() {
  {
    cat "$STATE_DIR/production.current" "$STATE_DIR/production.previous" 2>/dev/null || true

    # Newest $RETAIN verified releases, by marker mtime.
    ls -1t "$STATE_DIR"/tested.* 2>/dev/null | head -n "$RETAIN" | sed 's#.*/tested\.##' || true

    # Canonical staging pointer and its rollback (namespaced: ios-staging.*).
    cat "$STAGING_DIR/ios-staging.current" "$STAGING_DIR/ios-staging.previous" 2>/dev/null || true

    # The live staging env file always counts.
    grep -hs '^IMAGE_SHA=' "$STAGING_DIR/.env.ios-staging" 2>/dev/null | cut -d= -f2 || true

    # Recent staging env backups only -- newest $BAK_KEEP and younger than
    # $BAK_MAX_AGE_DAYS. Anything older stops protecting its image.
    if [ "$BAK_KEEP" -gt 0 ]; then
      find "$STAGING_DIR" -maxdepth 1 -name '.env.ios-staging.bak-*' -type f \
           -mtime "-${BAK_MAX_AGE_DAYS}" -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | head -n "$BAK_KEEP" | cut -d' ' -f2- \
        | while read -r b; do grep -hs '^IMAGE_SHA=' "$b" | cut -d= -f2; done || true
    fi
  } | tr -d ' \t\r' | grep -oE '^[a-f0-9]{12}' | sort -u
}

# ── Selection ───────────────────────────────────────────────────────────────
# Only release images are ever candidates. Base images (postgres, redis, caddy,
# node ...) and infra-migrate:latest are out of scope by construction.
select_removals() {
  local prot held
  prot=$(protected_shas)
  held=$(held_ids)

  image_list | while IFS='|' read -r id repo tag; do
    [ -n "$repo" ] || continue
    case "$repo" in
      *master-suit*) ;;
      *) continue ;;
    esac
    printf '%s\n' "$held" | grep -qxF "$id" && continue
    printf '%s\n' "$prot" | grep -qxF "${tag:0:12}" && continue
    printf '%s:%s\n' "$repo" "$tag"
  done
}

# ── Env-backup retention ────────────────────────────────────────────────────
# Reported in dry run, pruned only under --apply. Both conditions must hold, so
# nothing recent is ever removed. The live .env.ios-staging is never a candidate.
expired_env_backups() {
  [ -d "$STAGING_DIR" ] || return 0
  find "$STAGING_DIR" -maxdepth 1 -name '.env.ios-staging.bak-*' -type f \
       -printf '%T@ %p\n' 2>/dev/null | sort -rn | tail -n "+$((BAK_KEEP + 1))" | cut -d' ' -f2- \
    | while read -r f; do
        if [ -n "$(find "$f" -maxdepth 0 -mtime "+${BAK_MAX_AGE_DAYS}" 2>/dev/null)" ]; then
          printf '%s\n' "$f"
        fi
      done
}

main() {
  local apply=0
  case "${1:-}" in
    --apply) apply=1 ;;
    --auto)
      local pct; pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
      if [ "$pct" -lt "$AUTO_PCT" ]; then
        log "[retention] ${pct}% used, below the ${AUTO_PCT}% threshold — nothing to do"; exit 0
      fi
      log "[retention] ${pct}% used, at/above the ${AUTO_PCT}% threshold — enforcing retention"
      apply=1 ;;
    ''|--dry-run) ;;
    *) log "usage: $(basename "$0") [--apply|--auto|--dry-run]"; exit 2 ;;
  esac

  if busy; then
    log "[retention] a build or deploy is in progress — refusing to prune"; exit 0
  fi

  local prot; prot=$(protected_shas)
  log "[retention] protected release shas ($(printf '%s\n' "$prot" | grep -c . || true)):"
  printf '%s\n' "$prot" | sed 's/^/             /'

  local removals n
  removals=$(select_removals)
  n=$(printf '%s\n' "$removals" | grep -c . || true)

  if [ "$n" -eq 0 ]; then
    log "[retention] no release image is outside the retention window"
  else
    log "[retention] $n tag(s) outside the retention window:"
    printf '%s\n' "$removals" | sed 's/^/             /'
    if [ "$apply" -eq 1 ]; then
      printf '%s\n' "$removals" | while read -r t; do
        [ -n "$t" ] || continue
        if remove_tag "$t"; then log "  removed $t"; else log "  kept    $t (still referenced)"; fi
      done
    fi
  fi

  local stale; stale=$(expired_env_backups)
  if [ -n "$stale" ]; then
    log "[retention] staging env backups past retention (newest $BAK_KEEP kept, >${BAK_MAX_AGE_DAYS}d):"
    printf '%s\n' "$stale" | sed 's/^/             /'
    if [ "$apply" -eq 1 ]; then
      printf '%s\n' "$stale" | while read -r f; do [ -n "$f" ] && rm -f -- "$f" && log "  removed $f"; done
    fi
  fi

  if [ "$apply" -eq 1 ] && [ -z "${MS_RMI_LOG:-}" ]; then
    docker image prune -f    >/dev/null 2>&1 && log "[retention] pruned dangling images"
    docker builder prune -af >/dev/null 2>&1 && log "[retention] pruned inactive build cache"
  fi

  df -h / | tail -1 | awk '{print "[retention] disk: "$3" used, "$4" free ("$5")"}'
  [ "$apply" -eq 1 ] || log "[retention] dry run — nothing was deleted; re-run with --apply to reclaim"
}

main "$@"
