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
#
# The release preflight (docs/release/production-release.sh) runs it too, so
# every release records from production, with nobody signing in: the nightly
# timer's state and last run, how many of the last seven days have a backup, and
# the newest copy that left the machine. Those lines are evidence, not checks —
# they never change the exit code.

set -Eeuo pipefail

ROOT="${1:-/var/backups/master-suite}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-48}"

say()  { printf '[backup-status] %s\n' "$1"; }
fail() { printf '[backup-status] FAIL  %s\n' "$1" >&2; exit 1; }
stamp_epoch() { date -u -d "${1:0:8} ${1:9:2}:${1:11:2}:${1:13:2}" +%s; }
# One property out of `systemctl show` output; systemd prints "n/a" or nothing
# for a timestamp that never happened.
prop() { awk -F= -v k="$2" '$1 == k { sub(/^[^=]*=/, ""); if ($0 != "n/a") print; exit }' <<< "$1"; }

# ── Is the nightly timer alive? ─────────────────────────────────────────────
#
# First, so it is printed even when a check below fails — that is when it is
# wanted. Where there is no systemd (CI, containers) it says so and moves on:
# its absence must never be what turns this red.
if ! command -v systemctl >/dev/null 2>&1; then
  say "timer: systemctl is not available here — timer state not checked"
elif ! TIMER="$(systemctl show master-suite-backup.timer \
         -p LoadState,ActiveState,LastTriggerUSec,NextElapseUSecRealtime 2>/dev/null)" || [ -z "${TIMER}" ]; then
  say "timer: systemctl could not answer (no running systemd?) — timer state not checked"
elif [ "$(prop "${TIMER}" LoadState)" = "not-found" ]; then
  say "note: master-suite-backup.timer is not installed here — scripts/install-backup-schedule.sh"
else
  STATE="$(prop "${TIMER}" ActiveState)"
  LAST="$(prop "${TIMER}" LastTriggerUSec)"
  NEXT="$(prop "${TIMER}" NextElapseUSecRealtime)"
  say "timer master-suite-backup.timer: ${STATE:-unknown}, last fired ${LAST:-never}, next ${NEXT:-not scheduled}"
  if [ "${STATE}" != "active" ]; then
    say "note: the nightly backup timer is not active — nothing will take tonight's backup:
        systemctl enable --now master-suite-backup.timer"
  fi
  # systemd keeps a unit's last result only since boot, hence the wording.
  RUN="$(systemctl show master-suite-backup.service -p Result,ExecMainExitTimestamp,ExecMainStatus 2>/dev/null || true)"
  EXITED="$(prop "${RUN}" ExecMainExitTimestamp)"
  if [ -z "${EXITED}" ]; then
    say "last nightly run: none recorded since boot"
  else
    RESULT="$(prop "${RUN}" Result)"
    say "last nightly run: ${RESULT:-unknown}, exited ${EXITED} (status $(prop "${RUN}" ExecMainStatus))"
    if [ "${RESULT}" != "success" ]; then
      say "note: the last nightly backup did not succeed — journalctl -u master-suite-backup"
    fi
  fi
fi

[ -d "${ROOT}" ] || fail "${ROOT} does not exist. Backups have never run here, or the disk is not mounted."

# Same pattern backup.sh writes and prunes by, so a partial transfer or an
# operator's notes directory cannot be mistaken for a backup.
mapfile -t ALL < <(find "${ROOT}" -mindepth 1 -maxdepth 1 -type d \
  -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z$' -printf '%f\n' | sort)

[ "${#ALL[@]}" -gt 0 ] || fail "no backup directories in ${ROOT}."

NEWEST="${ALL[-1]}"
NOW="$(date -u +%s)"
AGE_HOURS=$(( ( NOW - $(stamp_epoch "${NEWEST}") ) / 3600 ))

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

# ── One restore point a day? ────────────────────────────────────────────────
#
# The recovery point objective is 24 hours: one complete backup per UTC day.
# Freshness only proves the newest is recent; this proves the timer fired every
# night. The seven full days before today are counted — today is left out, or a
# check run before the 02:30 backup would call it missing.
declare -A HAVE=()
for d in "${ALL[@]}"; do
  if [ -s "${ROOT}/${d}/manifest.txt" ]; then HAVE["${d:0:8}"]=1; fi
done
TODAY0=$(( NOW / 86400 * 86400 ))
MISSING=()
for i in 7 6 5 4 3 2 1; do
  day="$(date -u -d "@$(( TODAY0 - i * 86400 ))" +%Y%m%d)"
  [ -n "${HAVE[${day}]:-}" ] || MISSING+=("${day:0:4}-${day:4:2}-${day:6:2}")
done
say "daily cadence: $(( 7 - ${#MISSING[@]} )) of the last 7 full days have a complete backup"
if [ "${#MISSING[@]}" -gt 0 ]; then
  say "note: no complete backup on ${MISSING[*]} — those days have no restore point"
fi

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
#
# What is reported comes from the `.shipped-at` markers backup-ship.sh leaves
# after a verified shipment, not from BACKUP_REMOTE. The release preflight runs
# this without the backup environment, right after taking a backup it does not
# ship, and so printed "nothing has left this machine" while the nightly timer
# shipped every night. The newest marker anywhere answers the real question.
SHIPPED=""
for (( i = ${#ALL[@]} - 1; i >= 0; i-- )); do
  if [ -f "${ROOT}/${ALL[i]}/.shipped-at" ]; then SHIPPED="${ALL[i]}"; break; fi
done
if [ -n "${SHIPPED}" ]; then
  SHIPPED_AGE=$(( ( NOW - $(stamp_epoch "${SHIPPED}") ) / 3600 ))
  say "off-site: newest shipped backup ${SHIPPED} (${SHIPPED_AGE}h old), shipped $(cat "${ROOT}/${SHIPPED}/.shipped-at")"
  if [ "${SHIPPED_AGE}" -gt "${MAX_AGE_HOURS}" ]; then
    say "note: nothing newer than ${MAX_AGE_HOURS}h has left this machine — journalctl -u master-suite-backup"
  fi
fi
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if [ "${SHIPPED}" != "${NEWEST}" ]; then
    fail "the newest backup ${NEWEST} has never been shipped off this machine.
        BACKUP_REMOTE is set, so this should have happened automatically:
        journalctl -u master-suite-backup, then scripts/backup-ship.sh ${ROOT}/${NEWEST}"
  fi
elif [ -z "${SHIPPED}" ]; then
  say "note: BACKUP_REMOTE is unset — nothing has left this machine."
fi

# Reported, not enforced. Whether a verify has run recently is a judgement about
# how much the restore path is trusted, and a hard failure here would make the
# status check red for a reason that is not "we have no backup".
LATEST_MARKER="$(find "${ROOT}" -maxdepth 2 -name '.verified-at' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1)"
if [ -n "${LATEST_MARKER}" ]; then
  # `%T@` prints a float (`1788971107.8108650830`) and shell arithmetic cannot
  # parse one, so this aborted the moment a `.verified-at` marker first existed
  # — which, until restore verification was repaired, it never had. The bug was
  # invisible precisely because the thing it depends on had never succeeded.
  MARKER_EPOCH="${LATEST_MARKER%% *}"
  MARKER_AGE="$(( ( $(date -u +%s) - ${MARKER_EPOCH%%.*} ) / 86400 ))"
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
