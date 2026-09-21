#!/usr/bin/env bash
#
# Disk-space preflight for master-suite deployments.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# On 2026-09-21 this host reached 94% (67 G of 75 G) on nothing but stale release
# images and build cache. A deploy writes a ~1.6 GB image pair plus cache; run
# that with a few hundred MB spare and the build dies on ENOSPC having already
# written a partial layer the next attempt has to redo. The failure lands in the
# middle of a release, which is the worst time to discover it.
#
# ── Modes ───────────────────────────────────────────────────────────────────
#
#   ms-disk-preflight.sh              deploy gate: warn >=75%, FAIL >=90% or <8 GB
#   ms-disk-preflight.sh --warn-only  report and always exit 0
#
# `--warn-only` is what rollback uses. A rollback starts an image that is already
# on disk: it writes almost nothing, and refusing one because the disk is full
# would disable the recovery path at exactly the moment it is needed. So an
# incident gets the warning and proceeds.
#
# ALLOW_LOW_DISK=yes overrides the gate and says so in the log.
set -euo pipefail

WARN_PCT=${WARN_PCT:-75}
FAIL_PCT=${FAIL_PCT:-90}
MIN_FREE_GB=${MIN_FREE_GB:-8}
TARGET=${TARGET:-/}

WARN_ONLY=0
[ "${1:-}" = '--warn-only' ] && WARN_ONLY=1

# One df call, both numbers. `--output` keeps this independent of the column
# layout df prints for long device names, which wraps and breaks positional awk.
read -r pct free_kb < <(df --output=pcent,avail "$TARGET" | tail -1 | tr -d '%')
free_gb=$(( free_kb / 1024 / 1024 ))

printf '[preflight] disk %s: %s%% used, %s GB free\n' "$TARGET" "$pct" "$free_gb"

critical=0
if [ "$pct" -ge "$FAIL_PCT" ] || [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  critical=1
fi

if [ "$critical" -eq 1 ]; then
  if [ "$WARN_ONLY" -eq 1 ]; then
    printf '[preflight] WARNING: %s%% used, %s GB free — below the deploy threshold.\n' "$pct" "$free_gb"
    printf '[preflight] proceeding anyway: this path does not build (rollback starts an image already on disk).\n'
    exit 0
  fi
  if [ "${ALLOW_LOW_DISK:-}" = 'yes' ]; then
    printf '[preflight] BELOW THRESHOLD but ALLOW_LOW_DISK=yes — continuing.\n'
    exit 0
  fi
  cat >&2 <<MSG

[preflight] STOP: ${pct}% used, ${free_gb} GB free.
            A deploy needs <${FAIL_PCT}% and >=${MIN_FREE_GB} GB free.

            Reclaim first:
                ms-image-retention.sh            # dry run — what would go
                ms-image-retention.sh --apply    # reclaim it

            A rollback is NOT blocked by this and never needs the override:
                scripts/release.sh rollback production

            Override for a deploy only if you know the build fits:
                ALLOW_LOW_DISK=yes <command>

MSG
  exit 1
fi

if [ "$pct" -ge "$WARN_PCT" ]; then
  printf '[preflight] WARNING: %s%% used — run ms-image-retention.sh soon.\n' "$pct"
fi
exit 0
