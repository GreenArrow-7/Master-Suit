# Deliberately NOT `set -e`: every gate must run and report, even after one fails.
set -uo pipefail
cd /w/apps/web
echo "REVISION=$(cat /w/.git/HEAD 2>/dev/null | head -c 60)"
echo "=== node $(node -v) on $(uname -sr) ==="
# node_modules must be the container's own, never the bind-mounted host copy.
# One tree cannot hold two platforms' native binaries: a Linux run replaces
# @rolldown/binding-win32-* and @esbuild/win32-x64 with their linux builds, the
# next Windows run swaps them back, and whichever ran second leaves the other
# broken in a way that reads as "cannot resolve entry module" or a bare esbuild
# TransformError. Run this container with an anonymous volume over
# /w/apps/web/node_modules and the two stop fighting.
if [ -d node_modules/@esbuild/win32-x64 ] || ls -d node_modules/@rolldown/binding-win32-* >/dev/null 2>&1; then
  echo 'REFUSED: node_modules is the Windows host copy, reached through the bind mount.'
  echo 'Installing over it would swap its native binaries for Linux ones and break'
  echo 'every Windows gate afterwards. Re-run with an anonymous volume:'
  echo '  docker run ... -v "$(pwd -W):/w" -v /w/apps/web/node_modules ...'
  exit 2
fi
npm install --no-audit --no-fund >/dev/null 2>&1
npx prisma generate >/dev/null 2>&1
# Connection strings come from the environment when the caller supplies them
# (`docker run -e ...`), falling back to whichever env file is present. They are
# never echoed: this log goes into the release evidence.
envfile=""
for f in .env.test.local .env.test; do [ -f "$f" ] && { envfile="$f"; break; }; done
: "${MIGRATION_DATABASE_URL:=$([ -n "$envfile" ] && grep -m1 '^MIGRATION_DATABASE_URL=' "$envfile" | cut -d= -f2-)}"
: "${DATABASE_URL:=$([ -n "$envfile" ] && grep -m1 '^DATABASE_URL=' "$envfile" | cut -d= -f2-)}"
export MIGRATION_DATABASE_URL DATABASE_URL
[ -n "$DATABASE_URL" ] || { echo 'No DATABASE_URL: pass it with -e, or provide .env.test'; exit 2; }
echo "database=$(node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.host+u.pathname)')"
npx prisma migrate deploy >/dev/null 2>&1
fail=0
gate() { local n="$1"; shift; "$@" >/tmp/g.log 2>&1; local rc=$?; printf '%-26s exit=%s %s\n' "$n" "$rc" "$([ $rc -eq 0 ] && echo PASS || echo FAIL)"; [ $rc -ne 0 ] && { tail -8 /tmp/g.log; fail=1; }; return 0; }
gate "1  schema drift"      npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
gate "2  tenant isolation"  node scripts/check-rls.mjs
gate "3  raw SQL scope"     node scripts/check-raw-sql-scope.mjs
gate "4  typecheck"         npx tsc --noEmit
gate "5  lint"              npm run lint
gate "6  format check"      npm run format:check
gate "7  README counts"     node scripts/schema-stats.mjs --check
gate "8  observability"     npm run check:observability
gate "9  redis auth"        npm run check:redis-auth
gate "10 face token"        python3 ../face/test_tokens.py
gate "11 backup roundtrip"  bash scripts/test-backup-roundtrip.sh
gate "16 audit"             npm audit --omit=dev --audit-level=high
printf '\n12 unit suite\n'
# Kept outside the container, deliberately. A gate that reports "1 failed" and
# discards which one costs a forty-minute re-run to answer the first question
# anybody asks.
EV=/w/validation-evidence/release-candidate
mkdir -p "$EV" 2>/dev/null
npx vitest run --reporter=default >"$EV/gate12-unit-detail.log" 2>&1; UNIT_RC=$?
cp "$EV/gate12-unit-detail.log" /tmp/v.log
sed 's/\x1b\[[0-9;]*m//g' /tmp/v.log | grep -E 'Test Files|Tests ' | tail -2
printf '12 unit suite               exit=%s %s\n' "$UNIT_RC" "$([ $UNIT_RC -eq 0 ] && echo PASS || echo FAIL)"
[ $UNIT_RC -ne 0 ] && fail=1
grep -Eq '[0-9]+ (skipped|todo)' /tmp/v.log && echo '!! SKIPPED TESTS PRESENT' || echo 'no skipped tests'
printf '\n'
npx next build >/tmp/b.log 2>&1; BUILD_RC=$?
printf '15 build                    exit=%s %s\n' "$BUILD_RC" "$([ $BUILD_RC -eq 0 ] && echo PASS || echo FAIL)"
[ $BUILD_RC -ne 0 ] && { tail -15 /tmp/b.log; fail=1; }
echo "LINUX_GATES_FAIL=$fail"
