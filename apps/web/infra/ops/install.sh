#!/usr/bin/env bash
#
# Install (or update) the disk controls on a master-suite host.
#
#   apps/web/infra/ops/install.sh            show what would change
#   apps/web/infra/ops/install.sh --apply    install it
#
# Idempotent: safe to re-run after every deploy, which is how a replacement host
# ends up with the same configuration as this one. It installs executables and
# systemd units only -- it never touches release metadata, env files, volumes or
# any image.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(dirname "$HERE")"
SBIN=${SBIN:-/usr/local/sbin}
UNITS=${UNITS:-/etc/systemd/system}
APPLY=0; [ "${1:-}" = '--apply' ] && APPLY=1

say() { printf '[install] %s\n' "$*"; }
[ "$APPLY" -eq 1 ] || say 'dry run — nothing will be written (pass --apply)'

if [ "$APPLY" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
  echo '[install] must run as root to write /usr/local/sbin and /etc/systemd/system' >&2
  exit 1
fi

# ── Executables ─────────────────────────────────────────────────────────────
for f in ms-disk-preflight.sh ms-image-retention.sh; do
  src="$HERE/$f"; dst="$SBIN/$f"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    say "unchanged  $dst"
  else
    say "install    $dst"
    [ "$APPLY" -eq 1 ] && install -m 755 -o root -g root "$src" "$dst"
  fi
done

# ── The release wrapper ─────────────────────────────────────────────────────
# Convenience only. The real enforcement lives in scripts/release.sh, which
# calls the preflight itself -- an operator invoking release.sh directly is
# gated exactly the same way.
wrapper="$SBIN/ms-release"
if [ ! -f "$wrapper" ] || ! grep -qs 'release.sh' "$wrapper"; then
  say "install    $wrapper"
  if [ "$APPLY" -eq 1 ]; then
    cat > "$wrapper" <<'WRAP'
#!/usr/bin/env bash
# Convenience wrapper. scripts/release.sh performs the disk check itself; this
# only saves typing the path.
set -euo pipefail
exec /opt/mastersuite/apps/web/scripts/release.sh "$@"
WRAP
    chmod 755 "$wrapper"
  fi
else
  say "unchanged  $wrapper"
fi

# ── Migrate un-namespaced staging pointers ──────────────────────────────────
#
# A host provisioned before the staging names were separated keeps its pointer
# as staging.{current,previous}. The retention script now reads
# ios-staging.{current,previous}, and a pointer it cannot find is a pointer that
# stops protecting its image -- so this rename has to happen with the install,
# not after it. A fresh host has neither file and skips the whole block.
STAGING_DIR=${STAGING_DIR:-/home/deploy/ios-staging}
for n in current previous; do
  old="$STAGING_DIR/staging.$n"; new="$STAGING_DIR/ios-staging.$n"
  if [ -f "$old" ] && [ ! -f "$new" ]; then
    say "migrate    $old -> $new"
    if [ "$APPLY" -eq 1 ]; then
      mv -- "$old" "$new"
      chown --reference="$STAGING_DIR" "$new" 2>/dev/null || true
    fi
  fi
done

# ── systemd ─────────────────────────────────────────────────────────────────
changed=0
for u in master-suite-image-retention.service master-suite-image-retention.timer; do
  src="$INFRA/systemd/$u"; dst="$UNITS/$u"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    say "unchanged  $dst"
  else
    say "install    $dst"
    changed=1
    [ "$APPLY" -eq 1 ] && install -m 644 -o root -g root "$src" "$dst"
  fi
done

if [ "$APPLY" -eq 1 ]; then
  [ "$changed" -eq 1 ] && systemctl daemon-reload
  systemctl enable --now master-suite-image-retention.timer >/dev/null 2>&1 || true
  say "timer: $(systemctl is-enabled master-suite-image-retention.timer 2>/dev/null || echo unknown)/$(systemctl is-active master-suite-image-retention.timer 2>/dev/null || echo unknown)"
fi

# ── Verify ──────────────────────────────────────────────────────────────────
if [ "$APPLY" -eq 1 ]; then
  say 'verifying the installed preflight and a retention dry run:'
  "$SBIN/ms-disk-preflight.sh" || true
  "$SBIN/ms-image-retention.sh" | tail -3
fi
say 'done'
