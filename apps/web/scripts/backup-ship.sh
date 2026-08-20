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
# pulled back from the remote, which the weekly unit does. This script proves
# the bytes are there; that one proves they are a database.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   BACKUP_REMOTE=... scripts/backup-ship.sh /var/backups/master-suite/20260820T031500Z
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

SRC="${1:?usage: backup-ship.sh <backup-directory>}"
SRC="${SRC%/}"
STAMP="$(basename "${SRC}")"
REMOTE="${BACKUP_REMOTE:?BACKUP_REMOTE is not set — there is nowhere to ship to.}"

fail() { printf '\n[ship] %s\n\n' "$1" >&2; exit 1; }
say()  { printf '[ship] %s\n' "$1"; }

[ -d "${SRC}" ]                  || fail "no such backup directory: ${SRC}"
[ -f "${SRC}/manifest.txt" ]     || fail "${SRC} has no manifest.txt — refusing to ship an incomplete backup."

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
# Verification without copying: confirms a shipment that already happened is
# still intact. Worth having on its own — "is last night's copy still there and
# still the right bytes" is a question with an answer, and bit rot on a cheap
# remote disk is a real thing that no upload-time check can catch. It is also
# what makes the verification below testable in isolation.
VERIFY_ONLY="${BACKUP_SHIP_VERIFY_ONLY:-0}"

say "${VERIFY_ONLY:+re-}$([ "${VERIFY_ONLY}" = "1" ] && echo "verifying" || echo "shipping") ${STAMP} $([ "${VERIFY_ONLY}" = "1" ] && echo "at" || echo "to") ${REMOTE} (${MODE})"

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
