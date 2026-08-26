#!/usr/bin/env bash
#
# The off-host round trip: ship a backup out, list what is there, fetch it back.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# `backup-ship.sh` and `restore-verify.sh` had no tests at all — the two scripts
# that decide whether this deployment can be recovered. They were written, read,
# and believed, and one of the things believed about them was false:
# `backup-ship.sh` said the strongest proof "is restore-verify.sh run against a
# copy pulled back from the remote, which the weekly unit does", and the weekly
# unit ran restore-verify.sh against the local directory. Nothing had ever
# pulled a backup back, because nothing could.
#
# So this exercises the direction that was missing, on the one transport a test
# can drive without a vendor: `local`, which is also the mode most likely to be
# a cheap disk or a flaky mount.
#
# ── What it cannot cover, said plainly ──────────────────────────────────────
#
# The s3, rclone and rsync branches need those binaries and a real remote; they
# are exercised by an operator with `BACKUP_SHIP_LIST=1` and a pull, not here.
# The database half of restore-verify.sh needs a live Compose stack. What is
# covered is the shell: which files move, in which order, and what is refused —
# which is where every failure this feature has actually had has lived.
#
#   scripts/test-backup-roundtrip.sh
#
# Exit 0 all checks passed · 1 otherwise.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIP="${HERE}/backup-ship.sh"
VERIFY="${HERE}/restore-verify.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

FAILURES=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

# A backup run as backup.sh leaves one: some artefacts, a nested directory, and
# the manifest that means it finished.
make_backup() {
  local dir="$1"
  mkdir -p "${dir}/objects/t-1/2026-08"
  printf 'not really a dump, but a stable %s bytes\n' "$$" > "${dir}/database.dump"
  head -c 2048 /dev/urandom > "${dir}/objects/t-1/2026-08/recording.bin"
  printf 'blob\n' > "${dir}/objects/t-1/2026-08/note.txt"
  {
    printf 'objects=2\n'
    printf 'rows.Lead=17\n'
    printf '%s  ./database.dump\n' "$(sha256sum "${dir}/database.dump" | awk '{print $1}')"
  } > "${dir}/manifest.txt"
}

STAMP=20260820T031500Z
SRC="${WORK}/backups/${STAMP}"
REMOTE="${WORK}/remote"
mkdir -p "${REMOTE}"
make_backup "${SRC}"

echo "backup round trip (local transport)"

# ── 1 · a shipment lands, and the manifest lands last ───────────────────────
if BACKUP_REMOTE="${REMOTE}" "${SHIP}" "${SRC}" >/dev/null 2>&1; then
  ok "shipped ${STAMP} to the remote"
else
  bad "shipping failed outright"
fi
[ -f "${REMOTE}/${STAMP}/manifest.txt" ] && ok "the manifest is present at the destination" \
  || bad "no manifest at the destination"
[ -f "${SRC}/.shipped-at" ] && ok "a .shipped-at marker was written beside the source" \
  || bad "no .shipped-at marker — backup-status.sh would report this backup as never shipped"

# ── 2 · listing, which a disaster needs before anything else ────────────────
LISTED="$(BACKUP_REMOTE="${REMOTE}" BACKUP_SHIP_LIST=1 "${SHIP}" 2>/dev/null || true)"
[ "${LISTED}" = "${STAMP}" ] && ok "the remote lists exactly the stamp that was shipped" \
  || bad "listing returned '${LISTED}', expected '${STAMP}'"

# ── 3 · the pull, which is the half that did not exist ──────────────────────
PULLED_ROOT="${WORK}/pulled"
if BACKUP_REMOTE="${REMOTE}" BACKUP_SHIP_PULL="${PULLED_ROOT}" "${SHIP}" "${STAMP}" >/dev/null 2>&1; then
  ok "pulled ${STAMP} back from the remote"
else
  bad "pulling the backup back failed"
fi

# Byte for byte, including the nested object tree. `diff -r` rather than a
# count: a pull that brought back the right number of wrong files is the
# failure mode a count cannot see.
if diff -r --exclude=.shipped-at "${SRC}" "${PULLED_ROOT}/${STAMP}" >/dev/null 2>&1; then
  ok "what came back is identical to what went out, nested objects included"
else
  bad "the pulled copy differs from the source"
fi

# ── 4 · an interrupted shipment must not read as complete ───────────────────
#
# The manifest is placed last precisely so that a copy without one is known to
# be partial. If a pull accepted it, that ordering would buy nothing: the
# incomplete copy would be discovered during the restore instead, which is the
# one moment discovering it is useless.
HALF="${WORK}/remote-half"
mkdir -p "${HALF}/${STAMP}"
cp -a "${SRC}/database.dump" "${HALF}/${STAMP}/"
if BACKUP_REMOTE="${HALF}" BACKUP_SHIP_PULL="${WORK}/pulled-half" "${SHIP}" "${STAMP}" >/dev/null 2>&1; then
  bad "pulled a copy with no manifest — an unfinished shipment read as a backup"
else
  ok "refused a remote copy with no manifest"
fi

# ── 5 · a pull never lands on top of something ──────────────────────────────
#
# The local backup is the good copy at that moment; the remote one is the copy
# under suspicion. Writing the second over the first would destroy the evidence
# to test the doubt.
if BACKUP_REMOTE="${REMOTE}" BACKUP_SHIP_PULL="${PULLED_ROOT}" "${SHIP}" "${STAMP}" >/dev/null 2>&1; then
  bad "pulled over an existing directory"
else
  ok "refused to pull over an existing directory"
fi

# ── 6 · shipping refuses an unfinished source, in the other direction ───────
#
# Asserted on the message and on the remote, not on the exit code alone. Without
# the preflight this still exits non-zero — it copies the artefacts, then fails
# placing a manifest that does not exist — so an exit-code check passes for the
# wrong reason and proves nothing. The difference that matters is *where* it
# stops: with the guard the remote is never touched, without it a partial
# directory is left under a name that looks like a backup.
NOMAN_STAMP=20260101T000000Z
NOMAN="${WORK}/backups/${NOMAN_STAMP}"
mkdir -p "${NOMAN}" && printf 'x\n' > "${NOMAN}/database.dump"
NOMAN_OUT="$(BACKUP_REMOTE="${REMOTE}" "${SHIP}" "${NOMAN}" 2>&1 || true)"
case "${NOMAN_OUT}" in
  *"refusing to ship an incomplete backup"*) ok "refused to ship a directory with no manifest" ;;
  *) bad "shipping an unfinished directory was not refused up front; said: ${NOMAN_OUT}" ;;
esac
[ -e "${REMOTE}/${NOMAN_STAMP}" ] || [ -e "${REMOTE}/${NOMAN_STAMP}.partial" ] \
  && bad "an unfinished backup left something at the destination" \
  || ok "nothing was written to the remote for the unfinished backup"

# ── 7 · --from-remote is honest about having nowhere to pull from ───────────
#
# The distinction the two flags exist for: --prefer-remote degrades to the local
# copy and says so, because a weekly timer should not go red for a deployment
# that chose not to ship. --from-remote is somebody asking for the off-host copy
# specifically, and answering it with the local one would be a lie in the one
# situation where it matters most.
OUT="$(BACKUP_REMOTE= "${VERIFY}" --from-remote "${STAMP}" 2>&1 || true)"
case "${OUT}" in
  *"needs BACKUP_REMOTE"*) ok "--from-remote refuses when there is no remote configured" ;;
  *) bad "--from-remote did not refuse without a remote; said: ${OUT}" ;;
esac

echo
if [ "${FAILURES}" -eq 0 ]; then
  echo "backup round trip: all checks passed."
  exit 0
fi
echo "backup round trip: ${FAILURES} check(s) failed."
exit 1
