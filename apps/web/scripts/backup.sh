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
# Restore and verification: scripts/restore-verify.sh, which this script's
# output is designed to be fed to directly.

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

fail() { printf '\n[backup] %s\n\n' "$1" >&2; exit 1; }
say()  { printf '[backup] %s\n' "$1"; }

command -v docker >/dev/null || fail "docker is not on PATH."
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
  say "WARNING: BACKUP_PASSPHRASE is unset — this backup is NOT encrypted."
  say "         Acceptable only while it stays on a disk already trusted with live data."
fi

say "done: ${DEST}"
say "next: ship it off this machine, then prove it with"
say "      scripts/restore-verify.sh ${DEST}"
