#!/usr/bin/env bash
#
# Fails when the backups have stopped arriving.
#
# ── The failure this exists for ─────────────────────────────────────────────
#
# A backup job that stops running is silent by construction. Nothing errors,
# nothing pages, the directory that was there yesterday is still there — it is
# just not getting any newer. The usual way this is discovered is during a
# restore, which is the one moment it cannot be fixed.
#
# `backup.sh` failing is covered by the systemd unit's own status, and by the
# OnFailure= handler in infra/systemd. This covers the case that status cannot:
# the timer never fired at all. A masked or disabled unit, a host that was off,
# a clock that moved — none of those produce a failed service, because no
# service ran.
#
# So this asks the only question that cannot be answered by the job itself: is
# there a complete backup on disk that is newer than BACKUP_MAX_AGE_HOURS?
#
#   scripts/backup-status.sh [/var/backups/master-suite]
#
# Exit 0 healthy · 1 stale, missing or incomplete. Run by
# master-suite-backup-status.timer daily, so `systemctl --failed` on the VM
# answers "are we backed up?" without anybody reading a log.

set -Eeuo pipefail

ROOT="${1:-/var/backups/master-suite}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-48}"

say()  { printf '[backup-status] %s\n' "$1"; }
fail() { printf '[backup-status] FAIL  %s\n' "$1" >&2; exit 1; }

[ -d "${ROOT}" ] || fail "${ROOT} does not exist. Backups have never run here, or the disk is not mounted."

# Same pattern backup.sh writes and prunes by, so a partial transfer or an
# operator's notes directory cannot be mistaken for a backup.
mapfile -t ALL < <(find "${ROOT}" -mindepth 1 -maxdepth 1 -type d \
  -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z$' -printf '%f\n' | sort)

[ "${#ALL[@]}" -gt 0 ] || fail "no backup directories in ${ROOT}."

NEWEST="${ALL[-1]}"
NEWEST_AT="$(date -u -d "${NEWEST:0:8} ${NEWEST:9:2}:${NEWEST:11:2}:${NEWEST:13:2}" +%s)"
AGE_HOURS=$(( ( $(date -u +%s) - NEWEST_AT ) / 3600 ))

# A directory with no manifest is a run that died partway through. Counting it
# as the newest backup would hide the fact that the last *complete* one is
# older — which is exactly the number this is here to report.
[ -s "${ROOT}/${NEWEST}/manifest.txt" ] ||
  fail "the newest run ${NEWEST} has no manifest — it did not finish. Check journalctl -u master-suite-backup."

# Encrypted or not, one of these two must be present, or the manifest is
# describing a backup whose payload is gone.
[ -s "${ROOT}/${NEWEST}/database.dump" ] || [ -s "${ROOT}/${NEWEST}/database.dump.gpg" ] ||
  fail "the newest run ${NEWEST} has a manifest but no database dump."

say "${#ALL[@]} backup(s) retained, newest ${NEWEST} (${AGE_HOURS}h old)"

if [ "${AGE_HOURS}" -gt "${MAX_AGE_HOURS}" ]; then
  fail "the newest backup is ${AGE_HOURS}h old, over the ${MAX_AGE_HOURS}h threshold.
        The schedule has stopped: systemctl status master-suite-backup.timer"
fi

# ── Did it leave the machine? ───────────────────────────────────────────────
#
# Enforced, unlike the verification below, and the difference is deliberate. A
# backup that never left is not a weaker backup — on the failure it exists for,
# the host being gone, it is no backup at all. So when a remote is configured
# and the newest complete run has no `.shipped-at`, that is the same class of
# problem as no backup existing.
#
# Only when one is configured: a deployment that has deliberately not set
# BACKUP_REMOTE gets the warning backup.sh already prints, not a red status
# check every morning for a choice somebody made.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if [ -f "${ROOT}/${NEWEST}/.shipped-at" ]; then
    say "shipped off-host: $(cat "${ROOT}/${NEWEST}/.shipped-at")"
  else
    fail "the newest backup ${NEWEST} has never been shipped off this machine.
        BACKUP_REMOTE is set, so this should have happened automatically:
        journalctl -u master-suite-backup, then scripts/backup-ship.sh ${ROOT}/${NEWEST}"
  fi
else
  say "note: BACKUP_REMOTE is unset — nothing has left this machine."
fi

# Reported, not enforced. Whether a verify has run recently is a judgement about
# how much the restore path is trusted, and a hard failure here would make the
# status check red for a reason that is not "we have no backup".
LATEST_MARKER="$(find "${ROOT}" -maxdepth 2 -name '.verified-at' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1)"
if [ -n "${LATEST_MARKER}" ]; then
  MARKER_AGE="$(( ( $(date -u +%s) - ${LATEST_MARKER%% *} ) / 86400 ))"
  MARKER_PATH="${LATEST_MARKER#* }"
  # Which copy, not just when. "Verified 3 days ago" means two different things
  # depending on whether the bytes had left this machine, and the weaker of the
  # two is the one that was true for every verification before this existed.
  # Markers written then hold nothing, hence the fallback.
  PROVEN="$(awk '{print $2}' "${MARKER_PATH}" 2>/dev/null)"
  say "last restore verification: ${MARKER_AGE}d ago (${PROVEN:-copy on this host})"
  if [ -n "${BACKUP_REMOTE:-}" ] && [ "${PROVEN:-local}" != "off-host" ]; then
    say "note: the last proven restore was of the copy on this host. The off-host copy is
        the one that exists when this host does not — the weekly timer proves that one now,
        or: scripts/restore-verify.sh --from-remote ${NEWEST}"
  fi
else
  say "note: no restore has been verified yet — scripts/restore-verify.sh, or the weekly timer."
fi
