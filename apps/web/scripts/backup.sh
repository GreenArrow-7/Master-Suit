#!/usr/bin/env bash
#
# Backs up everything a restore needs: the database AND the object store.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# docs/DEPLOY-AZURE.md offered a single `pg_dump` line and asked the operator to
# put it in cron. That line covers the database and nothing else — so every call
# recording, every HR document, every payslip attachment and every biometric
# capture lived in exactly one place, on one VM's disk, with no copy anywhere.
# The database backup carried only their *metadata*: restore it and you get rows
# pointing at objects that no longer exist.
#
# A backup that omits half the data is worse than none, because it produces the
# feeling of having one.
#
# ── What it produces ────────────────────────────────────────────────────────
#
#   <out>/<stamp>/database.dump     pg_dump custom format (compressed)
#   <out>/<stamp>/objects/          the bucket, mirrored
#   <out>/<stamp>/manifest.txt      versions, counts, sha256 of every artefact
#
# With BACKUP_PASSPHRASE set, database.dump and objects/ are additionally
# written as .gpg (AES-256) and the plaintext removed. Without it the script
# warns: unencrypted backups are acceptable only while they never leave a disk
# you already trust with the live data.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   cd apps/web/infra
#   BACKUP_PASSPHRASE=... ../scripts/backup.sh /var/backups/master-suite
#
# Then ship the directory off the machine. A backup on the same disk as the
# thing it backs up is a copy, not a backup.
#
# On a schedule: scripts/install-backup-schedule.sh installs systemd units that
# run this daily at 02:30, verify a restore weekly, and check daily that the
# backups are still arriving. A cron line in a runbook is not a schedule — it is
# a suggestion that somebody once wrote down.
#
# Restore and verification: scripts/restore-verify.sh, which this script's
# output is designed to be fed to directly.
#
# ── Retention ───────────────────────────────────────────────────────────────
#
# BACKUP_RETENTION_DAYS (default 30, the number docs/ENVIRONMENTS.md promises)
# prunes older runs after a successful one. Two guards on that, because a prune
# is the one step here that destroys data:
#
#   * It runs only after this run has produced a manifest, so a failed backup
#     can never be the thing that clears the older ones.
#   * BACKUP_KEEP_MIN (default 3) is kept whatever their age. If the schedule
#     broke forty days ago, an age-only rule would delete every backup in
#     existence on the day somebody noticed.

set -Eeuo pipefail

OUT_ROOT="${1:-/var/backups/master-suite}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${OUT_ROOT}/${STAMP}"

# The compose invocation the Azure runbook uses. Overridable for a stack that
# was brought up differently.
DC="${DC:-docker compose --env-file ../.env.production -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.azure.yml}"

PG_USER="${PG_USER:-leadflow}"
PG_DB="${PG_DB:-leadflow}"
BUCKET="${S3_BUCKET:-leadflow-documents}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
KEEP_MIN="${BACKUP_KEEP_MIN:-3}"

fail() { printf '\n[backup] %s\n\n' "$1" >&2; exit 1; }
say()  { printf '[backup] %s\n' "$1"; }

command -v docker >/dev/null || fail "docker is not on PATH."

# Checked here rather than at the encryption step, which is the last one. The
# scheduled unit sets BACKUP_REQUIRE_ENCRYPTION=1; refusing after the dump and
# the mirror have already run would waste an hour of disk and leave a plaintext
# copy of every customer's data sitting in the destination directory — the exact
# outcome the flag exists to prevent.
if [ "${BACKUP_REQUIRE_ENCRYPTION:-0}" = "1" ]; then
  [ -n "${BACKUP_PASSPHRASE:-}" ] ||
    fail "BACKUP_REQUIRE_ENCRYPTION=1 but BACKUP_PASSPHRASE is unset. Refusing to write an unencrypted backup.
          Set it in /etc/master-suite/backup.env (see scripts/install-backup-schedule.sh)."
  command -v gpg >/dev/null || fail "BACKUP_REQUIRE_ENCRYPTION=1 but gpg is not installed."
fi

mkdir -p "${DEST}/objects"

# ── 1. Database ─────────────────────────────────────────────────────────────
# Custom format, not plain SQL: it compresses, and pg_restore can then be told
# to restore selectively, which is what makes the verification step cheap.
say "dumping ${PG_DB} ..."
${DC} exec -T postgres pg_dump -U "${PG_USER}" -Fc "${PG_DB}" > "${DEST}/database.dump"
[ -s "${DEST}/database.dump" ] || fail "pg_dump produced an empty file."

# ── 2. Object store ─────────────────────────────────────────────────────────
# `mc mirror` rather than a volume tarball. The volume is a MinIO-internal
# layout; the mirror is the objects themselves, which restores into MinIO, AWS
# S3 or Azure Blob equally. That matters because the most likely reason to need
# this backup is moving storage off the VM.
#
# The mc container joins the compose network so it reaches `minio:9000` by
# service name, exactly as the application does. Credentials come from the same
# .env.production the stack reads.
say "mirroring bucket ${BUCKET} ..."
NETWORK="$(${DC} ps --format '{{.Name}}' minio | head -1 | xargs -r docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
[ -n "${NETWORK}" ] || fail "could not determine the compose network — is the stack running?"

docker run --rm \
  --network "${NETWORK}" \
  --env-file ../.env.production \
  -v "${DEST}/objects:/backup" \
  --entrypoint sh minio/mc:latest -c "
    set -e
    mc alias set src http://minio:9000 \"\$S3_ACCESS_KEY_ID\" \"\$S3_SECRET_ACCESS_KEY\" >/dev/null
    mc mirror --overwrite --remove src/${BUCKET} /backup
  "

# ── 3. Manifest ─────────────────────────────────────────────────────────────
# Checksums, so a restore can prove it read what was written rather than a
# truncated transfer. Row counts, so the reconciliation in restore-verify.sh has
# something to compare against.
say "writing manifest ..."
{
  echo "taken_at=${STAMP}"
  echo "database=${PG_DB}"
  echo "bucket=${BUCKET}"
  echo "pg_version=$(${DC} exec -T postgres postgres --version | tr -d '\r')"
  echo "objects=$(find "${DEST}/objects" -type f | wc -l | tr -d ' ')"
  echo "objects_bytes=$(du -sb "${DEST}/objects" | cut -f1)"
  echo "# row counts, for reconciliation after a restore"
  ${DC} exec -T postgres psql -U "${PG_USER}" -d "${PG_DB}" -qtA -F= -c "
    SELECT 'rows.Tenant',      count(*) FROM \"Tenant\"      UNION ALL
    SELECT 'rows.PlatformUser', count(*) FROM \"PlatformUser\" UNION ALL
    SELECT 'rows.Lead',        count(*) FROM \"Lead\"        UNION ALL
    SELECT 'rows.Recording',   count(*) FROM \"Recording\"   UNION ALL
    SELECT 'rows.AuditLog',    count(*) FROM \"AuditLog\";" | tr -d '\r'
  echo "# sha256"
  ( cd "${DEST}" && sha256sum database.dump )
} > "${DEST}/manifest.txt"

# ── 4. Encryption ───────────────────────────────────────────────────────────
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  command -v gpg >/dev/null || fail "BACKUP_PASSPHRASE is set but gpg is not installed."
  say "encrypting ..."
  tar -C "${DEST}" -cf - objects | gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "${BACKUP_PASSPHRASE}" -o "${DEST}/objects.tar.gpg"
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "${BACKUP_PASSPHRASE}" -o "${DEST}/database.dump.gpg" "${DEST}/database.dump"
  rm -rf "${DEST}/objects" "${DEST}/database.dump"
  ( cd "${DEST}" && sha256sum ./*.gpg >> manifest.txt )
else
  # Unreachable under BACKUP_REQUIRE_ENCRYPTION=1 — the preflight above refused
  # long before this point. An interactive run on a disk already trusted with
  # live data may go unencrypted, and gets told so.
  say "WARNING: BACKUP_PASSPHRASE is unset — this backup is NOT encrypted."
  say "         Acceptable only while it stays on a disk already trusted with live data."
fi

# ── 5. Retention ────────────────────────────────────────────────────────────
# Only reached because every step above succeeded — `set -e` and the explicit
# `fail`s see to that. A prune that can run after a failed dump would turn one
# bad night into the loss of every backup.
[ -s "${DEST}/manifest.txt" ] || fail "no manifest was written; refusing to prune older backups."

# A stable name for "the most recent one", so the verify unit and any operator
# in a hurry do not have to parse timestamps.
ln -sfn "${STAMP}" "${OUT_ROOT}/latest"

# Only directories this script writes: 20260820T023000Z. Anything else in the
# root — a partial rsync, an operator's notes, a mount point — is left alone.
mapfile -t ALL < <(find "${OUT_ROOT}" -mindepth 1 -maxdepth 1 -type d \
  -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z$' -printf '%f\n' | sort)

KEPT=0
PRUNED=0
# Newest first, so the KEEP_MIN floor counts the ones worth keeping.
for ((i = ${#ALL[@]} - 1; i >= 0; i--)); do
  name="${ALL[i]}"
  KEPT=$((KEPT + 1))
  [ "${KEPT}" -le "${KEEP_MIN}" ] && continue
  # The directory name is the timestamp, so age needs no stat and cannot be
  # confused by a copy that touched mtimes.
  age_days=$(( ( $(date -u +%s) - $(date -u -d "${name:0:8} ${name:9:2}:${name:11:2}:${name:13:2}" +%s) ) / 86400 ))
  if [ "${age_days}" -gt "${RETENTION_DAYS}" ]; then
    say "pruning ${name} (${age_days}d old, retention ${RETENTION_DAYS}d)"
    rm -rf "${OUT_ROOT:?}/${name}"
    PRUNED=$((PRUNED + 1))
  fi
done
say "retained $((KEPT - PRUNED)) backup(s), pruned ${PRUNED}"

say "done: ${DEST}"
say "next: ship it off this machine, then prove it with"
say "      scripts/restore-verify.sh ${DEST}"
