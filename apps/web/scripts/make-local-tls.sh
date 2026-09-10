#!/usr/bin/env bash
#
# Local test certificates: one CA, two leaves.
#
# ── Why two leaves and not one ───────────────────────────────────────────────
#
# The browser talks HTTPS to the application; the application talks SMTP to the
# Mailpit capture server. Those are different trust decisions with different
# failure modes, and giving them one certificate hides that. A key that leaks
# from the terminator should not also be the mail server's key, and a hostname
# mistake on one should not be masked by the other happening to match.
#
# ── Why a CA at all, rather than two self-signed certificates ────────────────
#
# So both ends can be *verified* rather than waived. `NODE_EXTRA_CA_CERTS`
# points Node at this CA, which adds a trust anchor — it does not disable
# verification, and hostname checking still applies. That is the difference
# between trusting a specific certificate and turning the check off, and only
# the first is acceptable.
#
# Nothing here is committed: apps/web/infra/tls-local/ is gitignored.
#
#   bash scripts/make-local-tls.sh            # 30-day certificates
#   bash scripts/make-local-tls.sh --days 7
set -euo pipefail

DAYS=30
[ "${1:-}" = "--days" ] && DAYS="${2:-30}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/tls-local"
mkdir -p "$DIR"
cd "$DIR"

# MSYS_NO_PATHCONV stops Git Bash on Windows rewriting the /CN=… subject into a
# filesystem path, which turns the subject into gibberish and the SAN check into
# a mystery.
export MSYS_NO_PATHCONV=1

openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days "$DAYS" \
  -subj "/CN=Master Suite Local Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1

leaf() {
  local name="$1" cn="$2" san="$3"
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > "$name.ext"
  openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" -subj "/CN=$cn" >/dev/null 2>&1
  openssl x509 -req -in "$name.csr" -CA ca.pem -CAkey ca.key -CAcreateserial \
    -out "$name.pem" -days "$DAYS" -extfile "$name.ext" >/dev/null 2>&1
  rm -f "$name.csr" "$name.ext"
  echo "  $name.pem  CN=$cn  $san"
}

# The SMTP name is what SMTP_HOST must be set to, or hostname verification fails
# — which is the check working, not a problem to route around.
leaf smtp  mailpit.test "DNS:mailpit.test,DNS:localhost,IP:127.0.0.1"
leaf https localhost    "DNS:localhost,IP:127.0.0.1"

chmod 600 ./*.key 2>/dev/null || true
echo
echo "Wrote $DIR (gitignored, valid $DAYS days):"
echo "  ca.pem     trust anchor — NODE_EXTRA_CA_CERTS for the app, and the"
echo "             certificate to import for the browser"
echo "  smtp.*     Mailpit STARTTLS (MP_SMTP_TLS_CERT / MP_SMTP_TLS_KEY)"
echo "  https.*    the local HTTPS terminator in front of the app"
