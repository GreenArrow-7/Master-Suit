#!/usr/bin/env bash
#
# Tests for the retention decision and the deploy/rollback disk gate.
#
# No Docker daemon and no deletion. The scripts take their image list, their
# container-held ids and their removal command as injectable seams, so every
# case below is a pure function over fixture files. The destructive branch runs
# against MS_RMI_LOG, which records what *would* be removed instead of removing
# it -- the only safe way to test a branch whose real effect is the loss of a
# rollback image.
#
#   bash apps/web/infra/ops/test/retention-test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS="$(dirname "$HERE")"
RETENTION="$OPS/ms-image-retention.sh"
PREFLIGHT="$OPS/ms-disk-preflight.sh"

pass=0; fail=0
ok()    { printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
bad()   { printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; fail=$((fail+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3], got [$2]"; fi; }

FIX=$(mktemp -d); trap 'rm -rf "$FIX"' EXIT
STATE="$FIX/state"; STAGING="$FIX/staging"
mkdir -p "$STATE" "$STAGING"

# ── Fixture ─────────────────────────────────────────────────────────────────
#   production current  aaaaaaaaaaaa      production previous  bbbbbbbbbbbb
#   ios-staging current cccccccccccc      ios-staging rollback dddddddddddd
#   held by a container eeeeeeeeeeee
#   verified markers    6, of which only the newest RETAIN=3 stay protected
#   expected selectable ffffffffffff, 999999999999 (verified but outside window)
echo aaaaaaaaaaaa > "$STATE/production.current"
echo bbbbbbbbbbbb > "$STATE/production.previous"

for s in 999999999999 ffffffffffff 555555555555 444444444444 333333333333 aaaaaaaaaaaa; do
  printf 'web=sha256:%s\nworker=sha256:%s\n' "$s" "$s" > "$STATE/tested.$s"
done
# Explicit mtimes: `ls -1t` ranks these, so the window must be deterministic.
# With RETAIN=3 the window is {333333333333, 444444444444, 555555555555}; the two
# older verified releases fall outside it and become selectable. aaaaaaaaaaaa is
# deliberately the oldest marker -- it stays protected only because it is
# production.current, which proves the two rules are independent.
touch -d '2026-09-09 00:00' "$STATE/tested.aaaaaaaaaaaa"
touch -d '2026-09-10 00:00' "$STATE/tested.999999999999"
touch -d '2026-09-11 00:00' "$STATE/tested.ffffffffffff"
touch -d '2026-09-13 00:00' "$STATE/tested.555555555555"
touch -d '2026-09-14 00:00' "$STATE/tested.444444444444"
touch -d '2026-09-15 00:00' "$STATE/tested.333333333333"

echo cccccccccccc > "$STAGING/ios-staging.current"
echo dddddddddddd > "$STAGING/ios-staging.previous"
echo 'IMAGE_SHA=cccccccccccc0000000000000000000000000000' > "$STAGING/.env.ios-staging"

IMAGES="$FIX/images.txt"
cat > "$IMAGES" <<'EOF'
sha256:id-prodcur|master-suite/web|aaaaaaaaaaaa
sha256:id-prodcurw|master-suite/worker|aaaaaaaaaaaa
sha256:id-prodprev|master-suite/web|bbbbbbbbbbbb
sha256:id-prodprevw|master-suite/worker|bbbbbbbbbbbb
sha256:id-stagecur|ghcr.io/greenarrow-7/master-suit/web|cccccccccccc0000000000000000000000000000
sha256:id-stageprev|ghcr.io/greenarrow-7/master-suit/web|dddddddddddd0000000000000000000000000000
sha256:id-held|ghcr.io/greenarrow-7/master-suit/worker|eeeeeeeeeeee0000000000000000000000000000
sha256:id-v555|master-suite/web|555555555555
sha256:id-v444|master-suite/web|444444444444
sha256:id-v333|master-suite/web|333333333333
sha256:id-stale1|master-suite/web|ffffffffffff
sha256:id-stale2|master-suite/web|999999999999
sha256:id-base|postgres|16-alpine
sha256:id-migrate|infra-migrate|latest
EOF
HELD="$FIX/held.txt"; printf 'sha256:id-held\n' > "$HELD"

run() {
  MS_STATE_DIR="$STATE" MS_STAGING_DIR="$STAGING" MS_IMAGE_LIST_FILE="$IMAGES" \
  MS_HELD_IDS_FILE="$HELD" MS_BUSY=0 RETAIN=3 "$@"
}
# The candidate list is the indented block under "outside the retention window".
# Discriminated on the colon: a candidate is repo:tag, while a protected entry is
# a bare 12-char sha and an env-backup path has no colon either. (Matching on the
# repository name instead is a trap -- `^ +[a-z].*master-suit` consumes the "m" of
# "master-suite" with the [a-z] and can then never find "master-suit" again.)
selected() { run bash "$RETENTION" 2>/dev/null | grep -E '^[[:space:]]+[^[:space:]]+:[^[:space:]]+$' || true; }
verdict()  { if grep -q "$1" <<<"$2"; then echo selected; else echo protected; fi; }

echo "retention: the protected set"
SEL="$(selected)"
check "current production is never selected for deletion"   "$(verdict aaaaaaaaaaaa "$SEL")" protected
check "production rollback is never selected"               "$(verdict bbbbbbbbbbbb "$SEL")" protected
check "active staging is never selected"                    "$(verdict cccccccccccc "$SEL")" protected
check "staging rollback is never selected"                  "$(verdict dddddddddddd "$SEL")" protected
check "an image a container holds is never selected"        "$(verdict eeeeeeeeeeee "$SEL")" protected
check "newest verified release stays protected (1/3)"       "$(verdict 333333333333 "$SEL")" protected
check "newest verified release stays protected (2/3)"       "$(verdict 444444444444 "$SEL")" protected
check "newest verified release stays protected (3/3)"       "$(verdict 555555555555 "$SEL")" protected
check "base images and infra-migrate are out of scope"      "$(verdict 'postgres\|infra-migrate' "$SEL")" protected
check "a verified release outside the window IS selectable" "$(verdict ffffffffffff "$SEL")" selected
check "an older verified release is selectable too"         "$(verdict 999999999999 "$SEL")" selected
check "production.current survives being the OLDEST marker" "$(verdict aaaaaaaaaaaa "$SEL")" protected

echo "retention: staging env-backup expiry"
echo 'IMAGE_SHA=777777777777aaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$STAGING/.env.ios-staging.bak-2000000000"
echo 'IMAGE_SHA=888888888888aaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$STAGING/.env.ios-staging.bak-1000000000"
touch -d '2026-09-20 00:00' "$STAGING/.env.ios-staging.bak-2000000000"
touch -d '2025-01-01 00:00' "$STAGING/.env.ios-staging.bak-1000000000"
cat >> "$IMAGES" <<'EOF'
sha256:id-bakfresh|master-suite/web|777777777777
sha256:id-bakstale|master-suite/web|888888888888
EOF
SEL="$(selected)"
check "a recent staging env backup still protects its image" "$(verdict 777777777777 "$SEL")" protected
check "a stale .bak-* does NOT protect its image forever"    "$(verdict 888888888888 "$SEL")" selected

echo "retention: safety interlocks"
out="$(MS_STATE_DIR="$STATE" MS_STAGING_DIR="$STAGING" MS_IMAGE_LIST_FILE="$IMAGES" \
       MS_HELD_IDS_FILE="$HELD" MS_BUSY=1 bash "$RETENTION" --apply 2>&1)"
if grep -q 'refusing to prune' <<<"$out"; then r=refused; else r=proceeded; fi
check "a build or deploy in progress blocks cleanup"        "$r" refused

RMILOG="$FIX/rmi.log"; : > "$RMILOG"
run env MS_RMI_LOG="$RMILOG" bash "$RETENTION" >/dev/null 2>&1
check "a dry run deletes nothing"                           "$(wc -l < "$RMILOG" | tr -d ' ')" 0

run env MS_RMI_LOG="$RMILOG" bash "$RETENTION" --apply >/dev/null 2>&1
if [ "$(wc -l < "$RMILOG" | tr -d ' ')" -gt 0 ]; then r=removed; else r=none; fi
check "--apply does act on the selected tags"               "$r" removed
if grep -qE 'aaaaaaaaaaaa|bbbbbbbbbbbb|cccccccccccc|dddddddddddd|eeeeeeeeeeee' "$RMILOG"
  then r=leaked; else r=clean; fi
check "--apply never touches a protected sha"               "$r" clean

echo "preflight: deploy gate vs rollback availability"
FAIL_PCT=0 bash "$PREFLIGHT" >/dev/null 2>&1
check "a deploy is refused below the threshold"             "$?" 1
FAIL_PCT=0 bash "$PREFLIGHT" --warn-only >/dev/null 2>&1
check "a rollback still runs at the same disk level"        "$?" 0
FAIL_PCT=0 ALLOW_LOW_DISK=yes bash "$PREFLIGHT" >/dev/null 2>&1
check "ALLOW_LOW_DISK overrides the deploy gate"            "$?" 0
if WARN_PCT=0 FAIL_PCT=100 MIN_FREE_GB=0 bash "$PREFLIGHT" 2>&1 | grep -q WARNING
  then r=warned; else r=silent; fi
check "a warning is emitted at the warn threshold"          "$r" warned

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
