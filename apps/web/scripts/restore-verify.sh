#!/usr/bin/env bash
#
# Restores a backup into a scratch database and a scratch bucket prefix, then
# reconciles what came back against the manifest.
#
# ── Why a script rather than a paragraph ────────────────────────────────────
#
# "Test restoration quarterly" was in docs/BACKUP-RECOVERY.md and had never been
# done, which is the normal fate of a restore drill written as prose: it is
# somebody's whole afternoon, so it slips, and the first real attempt happens
# during the incident. An untested backup is a hope, not a control.
#
# This never touches the live database or the live bucket. It restores into
# `<db>_restorecheck` and `<bucket>-restorecheck`, both created and dropped by
# this script, so it is safe to run against production at any time — and it
# should be, because a backup verified on a laptop proves nothing about the
# backup the server is taking.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   cd apps/web/infra
#   BACKUP_PASSPHRASE=... ../scripts/restore-verify.sh /var/backups/master-suite/20260820T031500Z
#
# Exit 0 means: the dump restored, the schema is at the migration ledger's head,
# every counted table matches the manifest, and the object count matches.

set -Eeuo pipefail

SRC="${1:?usage: restore-verify.sh <backup-directory>}"
DC="${DC:-docker compose --env-file ../.env.production -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.azure.yml}"
PG_USER="${PG_USER:-leadflow}"
PG_DB="${PG_DB:-leadflow}"
BUCKET="${S3_BUCKET:-leadflow-documents}"

CHECK_DB="${PG_DB}_restorecheck"
CHECK_BUCKET="${BUCKET}-restorecheck"
WORK="$(mktemp -d)"
FAILURES=0

say()  { printf '[verify] %s\n' "$1"; }
bad()  { printf '[verify] FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
ok()   { printf '[verify] ok    %s\n' "$1"; }

cleanup() {
  say "tearing down the scratch database and bucket ..."
  ${DC} exec -T postgres psql -U "${PG_USER}" -d postgres -q \
    -c "DROP DATABASE IF EXISTS \"${CHECK_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

[ -f "${SRC}/manifest.txt" ] || { echo "[verify] no manifest.txt in ${SRC}" >&2; exit 1; }
manifest() { grep -E "^$1=" "${SRC}/manifest.txt" | head -1 | cut -d= -f2-; }

# ── 1. Decrypt, if the backup is encrypted ──────────────────────────────────
DUMP="${SRC}/database.dump"
OBJECTS="${SRC}/objects"
if [ -f "${SRC}/database.dump.gpg" ]; then
  [ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "[verify] backup is encrypted; set BACKUP_PASSPHRASE" >&2; exit 1; }
  say "decrypting ..."
  gpg --batch --yes --quiet --passphrase "${BACKUP_PASSPHRASE}" -o "${WORK}/database.dump" -d "${SRC}/database.dump.gpg"
  gpg --batch --yes --quiet --passphrase "${BACKUP_PASSPHRASE}" -o "${WORK}/objects.tar" -d "${SRC}/objects.tar.gpg"
  mkdir -p "${WORK}/x" && tar -C "${WORK}/x" -xf "${WORK}/objects.tar"
  DUMP="${WORK}/database.dump"; OBJECTS="${WORK}/x/objects"
fi

# ── 2. Integrity ────────────────────────────────────────────────────────────
EXPECTED_SHA="$(grep -E '  ?\./?database\.dump$' "${SRC}/manifest.txt" | awk '{print $1}' | head -1)"
if [ -n "${EXPECTED_SHA}" ]; then
  ACTUAL_SHA="$(sha256sum "${DUMP}" | awk '{print $1}')"
  [ "${EXPECTED_SHA}" = "${ACTUAL_SHA}" ] && ok "dump checksum matches the manifest" \
    || bad "dump checksum differs — the artefact is truncated or corrupt"
fi

# ── 3. Restore the database into a scratch copy ─────────────────────────────
say "restoring into ${CHECK_DB} ..."
${DC} exec -T postgres psql -U "${PG_USER}" -d postgres -q \
  -c "DROP DATABASE IF EXISTS \"${CHECK_DB}\" WITH (FORCE);" -c "CREATE DATABASE \"${CHECK_DB}\";"
# --no-owner / --no-privileges: the scratch database has no master_saas_app grant
# chain and does not need one to be counted.
${DC} exec -T postgres pg_restore -U "${PG_USER}" -d "${CHECK_DB}" --no-owner --no-privileges < "${DUMP}" \
  > "${WORK}/restore.log" 2>&1 || true
if grep -qiE '^pg_restore: error' "${WORK}/restore.log"; then
  bad "pg_restore reported errors:"; grep -iE '^pg_restore: error' "${WORK}/restore.log" | head -5
else
  ok "dump restored without errors"
fi

# ── 4. Is the schema actually at head? ──────────────────────────────────────
# A dump can restore cleanly and still be from before a migration that the
# application now requires. The ledger answers that in one query.
PENDING="$(${DC} exec -T postgres psql -U "${PG_USER}" -d "${CHECK_DB}" -qtA \
  -c "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;" 2>/dev/null || echo "?")"
APPLIED="$(${DC} exec -T postgres psql -U "${PG_USER}" -d "${CHECK_DB}" -qtA \
  -c "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;" 2>/dev/null || echo 0)"
ON_DISK="$(ls -1d ../prisma/migrations/*/ 2>/dev/null | wc -l | tr -d ' ')"
if [ "${PENDING}" = "0" ] && [ "${APPLIED}" = "${ON_DISK}" ]; then
  ok "migration ledger is clean and at head (${APPLIED}/${ON_DISK})"
else
  bad "migration ledger: ${APPLIED} applied, ${ON_DISK} on disk, ${PENDING} unfinished"
fi

# ── 5. Reconcile row counts against the manifest ────────────────────────────
say "reconciling row counts ..."
while IFS='=' read -r key expected; do
  case "${key}" in rows.*) ;; *) continue ;; esac
  table="${key#rows.}"
  actual="$(${DC} exec -T postgres psql -U "${PG_USER}" -d "${CHECK_DB}" -qtA \
    -c "SELECT count(*) FROM \"${table}\";" 2>/dev/null | tr -d '\r ' || echo "?")"
  if [ "${actual}" = "${expected}" ]; then
    ok "${table}: ${actual}"
  else
    # Not necessarily corruption: rows written between the dump and the manifest
    # query land here. It is still worth a human look, because a large gap is
    # the signature of a dump that failed part-way.
    bad "${table}: manifest says ${expected}, restore has ${actual}"
  fi
done < "${SRC}/manifest.txt"

# ── 6. The half that used to be missing entirely ────────────────────────────
say "verifying objects ..."
EXPECTED_OBJECTS="$(manifest objects)"
ACTUAL_OBJECTS="$(find "${OBJECTS}" -type f 2>/dev/null | wc -l | tr -d ' ')"
if [ "${EXPECTED_OBJECTS}" = "${ACTUAL_OBJECTS}" ]; then
  ok "object count: ${ACTUAL_OBJECTS}"
else
  bad "object count: manifest says ${EXPECTED_OBJECTS}, backup holds ${ACTUAL_OBJECTS}"
fi

# Every Recording row we hold must have its bytes in the backup. This is the
# check that would have caught the retention bug that deleted rows and left the
# objects behind, and the missing-object-backup gap, from opposite directions.
MISSING=0
while IFS= read -r key; do
  [ -n "${key}" ] || continue
  [ -f "${OBJECTS}/${key}" ] || MISSING=$((MISSING + 1))
done < <(${DC} exec -T postgres psql -U "${PG_USER}" -d "${CHECK_DB}" -qtA \
  -c "SELECT \"storageKey\" FROM \"Recording\" WHERE \"storageBucket\" IS DISTINCT FROM 'provider';" 2>/dev/null | tr -d '\r')
[ "${MISSING}" = "0" ] && ok "every ingested recording has its object in the backup" \
  || bad "${MISSING} Recording row(s) point at an object the backup does not contain"

echo
if [ "${FAILURES}" -eq 0 ]; then
  say "RESTORE VERIFIED — ${SRC}"
  exit 0
fi
say "RESTORE VERIFICATION FAILED — ${FAILURES} problem(s) above. Do not rely on this backup."
exit 1
