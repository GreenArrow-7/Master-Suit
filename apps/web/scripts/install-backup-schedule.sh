#!/usr/bin/env bash
#
# Installs the backup schedule as systemd units and starts it.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# docs/ENVIRONMENTS.md promises "automated pg_dump on a schedule with 30-day
# retention". What the repository actually had was a cron line in a runbook, for
# an operator to copy by hand, with no retention in it — and a cron line in a
# document is not a schedule, it is a suggestion somebody once wrote down. The
# only way to know whether a deployment is backed up was to ssh in and read
# crontab.
#
# ── Why systemd rather than cron ────────────────────────────────────────────
#
# Three properties cron does not have, each of which corresponds to a way this
# silently stops working:
#
#   Persistent=true      A VM that was off at 02:30 runs the backup at the next
#                        boot. Cron simply skips that day and says nothing.
#   systemctl --failed   A failed run is visible in one command, and stays
#                        visible. Cron mails root, on a box with no MTA.
#   list-timers          "When did this last run, when does it run next" is a
#                        question with an answer.
#
#   sudo scripts/install-backup-schedule.sh [backup-root]
#
# Idempotent: re-run it after moving the checkout or changing the backup root.

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${APP_DIR}/../.." && pwd)"
BACKUP_ROOT="${1:-/var/backups/master-suite}"
CONFIG="${BACKUP_CONFIG:-/etc/master-suite/backup.env}"
# Overridable so the installer itself can be exercised without writing to /etc.
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"

say()  { printf '[install] %s\n' "$1"; }
fail() { printf '\n[install] %s\n\n' "$1" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "Run as root: sudo scripts/install-backup-schedule.sh"
command -v systemctl >/dev/null || fail "systemd is not present. Use the cron line in docs/DEPLOY-AZURE.md instead."
[ -x "${APP_DIR}/scripts/backup.sh" ] || fail "${APP_DIR}/scripts/backup.sh is missing or not executable."

# ── Configuration ───────────────────────────────────────────────────────────
# In /etc rather than in the unit files, because unit files are world-readable
# and `systemctl cat` prints them — and this one holds the passphrase that the
# backups are encrypted with.
if [ ! -f "${CONFIG}" ]; then
  install -d -m 700 "$(dirname "${CONFIG}")"
  cat > "${CONFIG}" <<'ENVFILE'
# Read by the master-suite-backup systemd units. Mode 600, root-owned.
#
# BACKUP_PASSPHRASE encrypts the dump and the object mirror with AES-256 before
# they leave this machine. The scheduled unit sets BACKUP_REQUIRE_ENCRYPTION=1
# and will REFUSE to run while this is empty, rather than quietly writing a
# plaintext copy of every customer's data to a path that is going to be synced
# somewhere.
#
# Keep a copy in your secret store. A backup whose passphrase is only on the
# machine it backs up cannot be restored after that machine is gone, which is
# the case it exists for.
BACKUP_PASSPHRASE=

# 30 days, the number docs/ENVIRONMENTS.md promises. BACKUP_KEEP_MIN backups are
# retained whatever their age, so a schedule that broke a month ago does not get
# its remaining evidence pruned on the day somebody notices.
BACKUP_RETENTION_DAYS=30
BACKUP_KEEP_MIN=3

# How stale the newest backup may get before the daily freshness check fails.
# 48 rather than 24 so a single missed night is not a page, while two are.
BACKUP_MAX_AGE_HOURS=48
ENVFILE
  chmod 600 "${CONFIG}"
  say "wrote ${CONFIG} — set BACKUP_PASSPHRASE in it before the first run."
else
  say "keeping existing ${CONFIG}"
fi

install -d -m 750 "${BACKUP_ROOT}"

# ── Units ───────────────────────────────────────────────────────────────────
for unit in master-suite-backup master-suite-restore-verify master-suite-backup-status; do
  for kind in service timer; do
    src="${APP_DIR}/infra/systemd/${unit}.${kind}"
    [ -f "${src}" ] || fail "missing ${src}"
    sed -e "s|__APP_DIR__|${APP_DIR}|g" \
        -e "s|__REPO_DIR__|${REPO_DIR}|g" \
        -e "s|__BACKUP_ROOT__|${BACKUP_ROOT}|g" \
        -e "s|__CONFIG__|${CONFIG}|g" \
        "${src}" > "${UNIT_DIR}/${unit}.${kind}"
  done
done
say "installed 6 units into ${UNIT_DIR}"

systemctl daemon-reload
# The timers are enabled and started; the services are not, because a `.service`
# with no timer behind it would run at boot. `systemctl start <name>.service`
# runs one on demand.
for unit in master-suite-backup master-suite-restore-verify master-suite-backup-status; do
  systemctl enable --now "${unit}.timer" >/dev/null
done

say "schedule active:"
systemctl list-timers 'master-suite-*' --no-pager || true

cat <<NEXT

[install] Next:
  1. Put a real passphrase in ${CONFIG} — the backup unit refuses to run without one.
  2. Take one now and watch it:   systemctl start master-suite-backup.service
                                  journalctl -u master-suite-backup -f
  3. Prove it restores:           systemctl start master-suite-restore-verify.service
  4. Ship ${BACKUP_ROOT} off this machine. A backup on the same disk as
     the thing it backs up is a copy, not a backup — nothing installed here does
     that step for you.

[install] Health, in one command:  systemctl --failed
NEXT
