# Deliberately NOT `set -e`: every gate must run and report, even after one fails.
set -uo pipefail
cd /w/apps/web
echo "REVISION=$(cat /w/.git/HEAD 2>/dev/null | head -c 60)"
echo "=== node $(node -v) on $(uname -sr) ==="
npm install --no-audit --no-fund >/dev/null 2>&1
npx prisma generate >/dev/null 2>&1
export MIGRATION_DATABASE_URL="$(grep -m1 '^MIGRATION_DATABASE_URL=' .env.test.local | cut -d= -f2-)"
export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.test.local | cut -d= -f2-)"
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
npx vitest run --reporter=default >/tmp/v.log 2>&1; UNIT_RC=$?
sed 's/\x1b\[[0-9;]*m//g' /tmp/v.log | grep -E 'Test Files|Tests ' | tail -2
printf '12 unit suite               exit=%s %s\n' "$UNIT_RC" "$([ $UNIT_RC -eq 0 ] && echo PASS || echo FAIL)"
[ $UNIT_RC -ne 0 ] && fail=1
grep -Eq '[0-9]+ (skipped|todo)' /tmp/v.log && echo '!! SKIPPED TESTS PRESENT' || echo 'no skipped tests'
printf '\n'
npx next build >/tmp/b.log 2>&1; BUILD_RC=$?
printf '15 build                    exit=%s %s\n' "$BUILD_RC" "$([ $BUILD_RC -eq 0 ] && echo PASS || echo FAIL)"
[ $BUILD_RC -ne 0 ] && { tail -15 /tmp/b.log; fail=1; }
echo "LINUX_GATES_FAIL=$fail"
