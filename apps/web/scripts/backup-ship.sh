#!/usr/bin/env bash
#
# Copies one backup run off this machine, and proves it arrived.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# scripts/backup.sh ended with `next: ship it off this machine`. That is an
# instruction to a person, which means it happens until the week it does not,
# and nothing anywhere notices. A backup on the same disk as the thing it backs
# up is a copy, not a backup: the single most likely reason to need it — the VM
# is gone — is also the reason it would not be there.
#
# ── Verification is the point, not the upload ───────────────────────────────
#
# `aws s3 sync` and `rsync` both exit 0 for a transfer that silently moved less
# than everything: a full disk at the far end, a truncated object, a
# prefix typo that wrote to nowhere anybody will look. An upload that exits 0 is
# not a backup that arrived.
#
# So every mode below re-reads what landed and compares it against the manifest
# the backup wrote — the same manifest restore-verify.sh reconciles against. For
# destinations this machine can read directly the artefacts are re-checksummed;
# for object stores the manifest is round-tripped and every artefact's size is
# compared, because re-downloading a hundred gigabytes daily to checksum it is a
# cost nobody will keep paying, and a size mismatch catches the truncation cases
# that actually happen.
#
# The strongest proof is not here: it is restore-verify.sh run against a copy
# pulled *back* from the remote. This script proves the bytes are there; that
# one proves they are a database.
#
# That sentence used to end "which the weekly unit does", and the weekly unit
# did not. It ran restore-verify.sh against `<backup-root>/latest` — the local
# directory — so what had been proven restorable was the copy on the disk that
# is gone in the disaster this whole feature exists for. Nothing had ever pulled
# a backup back. `--pull` below is the missing half, and
# `restore-verify.sh --prefer-remote` is what the unit runs now.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   BACKUP_REMOTE=... scripts/backup-ship.sh /var/backups/master-suite/20260820T031500Z
#
#   # Fetch one back — into a directory this creates, never over the original:
#   BACKUP_REMOTE=... BACKUP_SHIP_PULL=/var/tmp/pulled scripts/backup-ship.sh 20260820T031500Z
#
#   # What is actually on the remote, which is the first question in a disaster:
#   BACKUP_REMOTE=... BACKUP_SHIP_LIST=1 scripts/backup-ship.sh
#
# BACKUP_REMOTE takes any of:
#
#   /mnt/nas/master-suite          an absolute path — a mount, a second volume
#   file:///mnt/nas/master-suite   the same, written explicitly
#   backups@host:/srv/master-suite rsync over ssh
#   s3://bucket/prefix             any S3-compatible store, via the aws CLI
#   rclone:remote:path             anything rclone speaks (Azure Blob, B2, GCS)
#
# Called automatically at the end of scripts/backup.sh when BACKUP_REMOTE is
# set. Run by hand to re-ship a backup that failed to leave.
set -Eeuo pipefail

PULL_TO="${BACKUP_SHIP_PULL:-}"
LIST_ONLY="${BACKUP_SHIP_LIST:-0}"

SRC="${1:-}"
[ "${LIST_ONLY}" = "1" ] || SRC="${1:?usage: backup-ship.sh <backup-directory>}"
SRC="${SRC%/}"
# For a pull the argument is a stamp, not a directory: the local copy is exactly
# what a real disaster no longer has, so requiring one would make this work only
# when it is not needed.
STAMP="$(basename "${SRC}")"
REMOTE="${BACKUP_REMOTE:?BACKUP_REMOTE is not set — there is nowhere to ship to.}"

fail() { printf '\n[ship] %s\n\n' "$1" >&2; exit 1; }
say()  { printf '[ship] %s\n' "$1"; }

if [ -z "${PULL_TO}" ] && [ "${LIST_ONLY}" != "1" ]; then
  [ -d "${SRC}" ]                || fail "no such backup directory: ${SRC}"
  [ -f "${SRC}/manifest.txt" ]   || fail "${SRC} has no manifest.txt — refusing to ship an incomplete backup."
fi

# The manifest is written last by backup.sh, so its presence means the dump, the
# mirror and the encryption all finished. Shipping a directory mid-write would
# put a half-backup off-host under a name that looks complete.

need() { command -v "$1" >/dev/null || fail "$1 is required for BACKUP_REMOTE=${REMOTE} but is not installed."; }

# ── Which mode ──────────────────────────────────────────────────────────────
case "${REMOTE}" in
  s3://*)            MODE=s3     ;;
  rclone:*)          MODE=rclone ;;
  file://*)          MODE=local  ; REMOTE="${REMOTE#file://}" ;;
  /*)                MODE=local  ;;
  *:*)               MODE=rsync  ;;
  *) fail "BACKUP_REMOTE=${REMOTE} is not a destination this understands. See the header of this script." ;;
esac
remote_dir() {
  case "${MODE}" in
    rclone) local d="${REMOTE#rclone:}"; printf '%s/%s' "${d%/}" "$1" ;;
    *)      printf '%s/%s' "${REMOTE%/}" "$1" ;;
  esac
}

# ── What is on the remote ───────────────────────────────────────────────────
#
# The first question in an actual disaster, and until now one with no answer
# from here: the operator had to know the transport and drive it by hand at the
# worst possible moment. Newest last, matching the stamp order everything else
# in this feature sorts by.
if [ "${LIST_ONLY}" = "1" ]; then
  case "${MODE}" in
    local)  find "${REMOTE%/}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort ;;
    rsync)  ${BACKUP_SSH:-ssh} "${REMOTE%%:*}" "ls -1 '${REMOTE#*:}'" 2>/dev/null | sort ;;
    s3)     need aws
            aws s3 ls "${REMOTE%/}/" 2>/dev/null | awk '$1=="PRE"{gsub("/","",$2); print $2}' | sort ;;
    rclone) need rclone
            rclone lsd "$(remote_dir '')" 2>/dev/null | awk '{print $NF}' | sort ;;
  esac
  exit 0
fi

# ── Fetching one back ───────────────────────────────────────────────────────
#
# The half that was missing. `backup-ship.sh` could put a backup off-host and
# prove the bytes landed; nothing could bring one home, so nothing had ever
# demonstrated that the off-host copy is a restorable database rather than a
# directory of the right size.
#
# Into a directory of its own, never over the source: a pull that overwrote the
# local backup would destroy the good copy with the one under suspicion.
#
# What comes back is checked by restore-verify.sh against the manifest that came
# back with it, which is internal consistency rather than fidelity to the
# original — a remote holding a consistently-corrupted pair would pass that
# check. What catches it is the step after: the row counts are reconciled
# against a database actually restored from those bytes, and a truncated dump
# cannot produce the manifest's counts.
if [ -n "${PULL_TO}" ]; then
  OUT="${PULL_TO%/}/${STAMP}"
  [ -e "${OUT}" ] && fail "${OUT} already exists — refusing to pull over it."
  mkdir -p "${OUT}" || fail "cannot create ${OUT}"
  FROM="$(remote_dir "${STAMP}")"
  say "pulling ${STAMP} back from ${FROM} ..."
  case "${MODE}" in
    local)  [ -d "${FROM}" ] || fail "${FROM} does not exist on the remote."
            cp -a "${FROM}/." "${OUT}/" || fail "could not copy ${FROM}" ;;
    rsync)  need rsync
            rsync -a -e "${BACKUP_SSH:-ssh}" "${FROM}/" "${OUT}/" || fail "rsync from ${FROM} failed." ;;
    s3)     need aws
            aws s3 sync "${FROM}/" "${OUT}/" --only-show-errors || fail "aws s3 sync from ${FROM} failed." ;;
    rclone) need rclone
            rclone copy "${FROM}/" "${OUT}/" || fail "rclone copy from ${FROM} failed." ;;
  esac

  # The same rule the ship path applies in the other direction, and for the same
  # reason: the manifest is placed last, so a copy without one is a shipment
  # that never finished. Better to say so here than to have restore-verify.sh
  # discover it after decrypting a hundred gigabytes.
  [ -f "${OUT}/manifest.txt" ] || fail "the copy at ${FROM} has no manifest.txt — it is incomplete. Do not restore from it."

  say "pulled $(find "${OUT}" -type f | wc -l | tr -d ' ') artefact(s) into ${OUT}"
  printf '%s\n' "${OUT}"
  exit 0
fi

# Verification without copying: confirms a shipment that already happened is
# still intact. Worth having on its own — "is last night's copy still there and
# still the right bytes" is a question with an answer, and bit rot on a cheap
# remote disk is a real thing that no upload-time check can catch. It is also
# what makes the verification below testable in isolation.
VERIFY_ONLY="${BACKUP_SHIP_VERIFY_ONLY:-0}"

# `${VERIFY_ONLY:+re-}` was here and always expanded: the variable holds the
# string "0" when off, which is non-empty, so every ordinary shipment announced
# itself as a *re*-shipment. Harmless until somebody reads a log to work out
# whether a backup left the machine once or twice.
if [ "${VERIFY_ONLY}" = "1" ]; then
  say "re-verifying ${STAMP} at ${REMOTE} (${MODE})"
else
  say "shipping ${STAMP} to ${REMOTE} (${MODE})"
fi

# Every artefact the backup produced, relative to SRC. Used both to copy and to
# check, so the two cannot disagree about what "everything" means.
mapfile -t ARTEFACTS < <(cd "${SRC}" && find . -type f -printf '%P\n' | sort)
[ "${#ARTEFACTS[@]}" -gt 0 ] || fail "${SRC} contains no files."

local_size() { stat -c %s "${SRC}/$1"; }

if [ "${VERIFY_ONLY}" = "1" ]; then
  case "${MODE}" in
    local)  DEST="${REMOTE%/}/${STAMP}" ;;
    rsync)  DEST="${REMOTE%/}/${STAMP}" ;;
    s3)     DEST="${REMOTE%/}/${STAMP}" ;;
    rclone) DEST="${REMOTE#rclone:}"; DEST="${DEST%/}/${STAMP}" ;;
  esac
else
case "${MODE}" in
  local)
    # `cp -a`, not rsync. A backup run directory is written once and never
    # changed, so rsync's incremental machinery buys nothing here — and a
    # minimal VM that has docker and gpg does not necessarily have rsync. Every
    # byte is re-checksummed below regardless of how it got there.
    DEST="${REMOTE%/}/${STAMP}"
    PARTIAL="${DEST}.partial"
    rm -rf "${PARTIAL}"
    mkdir -p "${PARTIAL}" || fail "cannot create ${PARTIAL} — is the destination mounted?"
    cp -a "${SRC}/." "${PARTIAL}/" || fail "copy to ${PARTIAL} failed."
    rm -f "${PARTIAL}/manifest.txt"
    ;;
  rsync)
    need rsync
    DEST="${REMOTE%/}/${STAMP}"
    rsync -a --checksum --delete --exclude manifest.txt -e "${BACKUP_SSH:-ssh}" \
      --rsync-path="mkdir -p '${DEST}' && rsync" \
      "${SRC}/" "${DEST}/" || fail "rsync to ${DEST} failed."
    ;;
  s3)
    need aws
    DEST="${REMOTE%/}/${STAMP}"
    aws s3 sync "${SRC}/" "${DEST}/" --exclude manifest.txt --only-show-errors \
      || fail "aws s3 sync to ${DEST} failed."
    ;;
  rclone)
    need rclone
    DEST="${REMOTE#rclone:}"; DEST="${DEST%/}/${STAMP}"
    rclone copy "${SRC}/" "${DEST}/" --exclude manifest.txt || fail "rclone copy to ${DEST} failed."
    ;;
esac

# ── The manifest goes last, deliberately ────────────────────────────────────
#
# Every mode above excludes it, and it is placed only once the rest has landed.
# So a shipment interrupted halfway — the link drops, the disk fills, the VM is
# terminated mid-copy — leaves a directory with no manifest, and both
# restore-verify.sh and this script's own preflight refuse a backup without one.
#
# The alternative is a copy that is missing an object nobody will discover until
# a restore, which is the one moment discovering it is useless.
say "placing the manifest ..."
case "${MODE}" in
  local)  cp -a "${SRC}/manifest.txt" "${PARTIAL}/manifest.txt" || fail "could not place the manifest."
          rm -rf "${DEST}" && mv "${PARTIAL}" "${DEST}" || fail "could not finalise ${DEST}." ;;
  rsync)  rsync -a -e "${BACKUP_SSH:-ssh}" "${SRC}/manifest.txt" "${REMOTE%/}/${STAMP}/manifest.txt" \
            || fail "could not place the manifest." ;;
  s3)     aws s3 cp "${SRC}/manifest.txt" "${DEST}/manifest.txt" --only-show-errors \
            || fail "could not place the manifest." ;;
  rclone) rclone copyto "${SRC}/manifest.txt" "${DEST}/manifest.txt" \
            || fail "could not place the manifest." ;;
esac
fi

# ── Verify what landed ──────────────────────────────────────────────────────
say "verifying the copy at ${DEST} ..."
PROBLEMS=0
note_bad() { printf '[ship]   ✗ %s\n' "$1" >&2; PROBLEMS=$((PROBLEMS + 1)); }

case "${MODE}" in
  local)
    # Readable from here, so checksum everything. This is the mode most likely
    # to be a cheap disk or a flaky mount, and the one where a full check costs
    # nothing but local IO.
    for rel in "${ARTEFACTS[@]}"; do
      [ -f "${DEST}/${rel}" ] || { note_bad "missing at the destination: ${rel}"; continue; }
      a="$(sha256sum "${SRC}/${rel}"  | awk '{print $1}')"
      b="$(sha256sum "${DEST}/${rel}" | awk '{print $1}')"
      [ "${a}" = "${b}" ] || note_bad "checksum differs: ${rel}"
    done
    ;;
  rsync)
    # rsync --checksum already compared every file it sent. What it cannot tell
    # us is whether the far end then ran out of disk writing the last one, so
    # the manifest is fetched back and compared byte for byte.
    tmp="$(mktemp)"; trap 'rm -f "${tmp}"' EXIT
    rsync -q -e "${BACKUP_SSH:-ssh}" "${REMOTE%/}/${STAMP}/manifest.txt" "${tmp}" 2>/dev/null \
      || note_bad "manifest.txt could not be read back from the destination"
    cmp -s "${SRC}/manifest.txt" "${tmp}" || note_bad "manifest.txt differs at the destination"
    ;;
  s3)
    listing="$(aws s3 ls "${DEST}/" --recursive 2>/dev/null || true)"
    [ -n "${listing}" ] || note_bad "nothing listed under ${DEST}"
    for rel in "${ARTEFACTS[@]}"; do
      remote_size="$(printf '%s\n' "${listing}" | awk -v k="/${STAMP}/${rel}" '$4 ~ k"$" {print $3; exit}')"
      [ -n "${remote_size}" ] || { note_bad "missing at the destination: ${rel}"; continue; }
      [ "${remote_size}" = "$(local_size "${rel}")" ] || note_bad "size differs: ${rel}"
    done
    tmp="$(mktemp)"; trap 'rm -f "${tmp}"' EXIT
    aws s3 cp "${DEST}/manifest.txt" "${tmp}" --only-show-errors 2>/dev/null \
      || note_bad "manifest.txt could not be read back from the destination"
    cmp -s "${SRC}/manifest.txt" "${tmp}" || note_bad "manifest.txt differs at the destination"
    ;;
  rclone)
    # rclone's own check compares hashes where the backend exposes them and
    # falls back to size where it does not, which is exactly the trade the s3
    # branch makes by hand.
    rclone check "${SRC}/" "${DEST}/" --one-way 2>&1 | grep -qiE '0 differences|no differences' \
      || note_bad "rclone check reported differences at the destination"
    ;;
esac

[ "${PROBLEMS}" -eq 0 ] || fail "the copy at ${DEST} does not match this backup (${PROBLEMS} problem(s) above).
       The local backup is intact; the off-host copy is not. Do not prune."

# A marker beside the backup that was shipped, so scripts/backup-status.sh can
# report how long ago one last left the machine. Written only on success — a
# failed shipment must not leave evidence that one happened.
[ "${VERIFY_ONLY}" = "1" ] || date -u +%Y-%m-%dT%H:%M:%SZ > "${SRC}/.shipped-at" 2>/dev/null || true

say "$([ "${VERIFY_ONLY}" = "1" ] && echo "verified" || echo "shipped and verified"): ${#ARTEFACTS[@]} artefact(s) at ${DEST}"
