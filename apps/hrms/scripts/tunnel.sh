#!/usr/bin/env bash
# Expose the local HRMS over an HTTPS URL with Cloudflare Tunnel (macOS/Linux).
#
#   ./scripts/tunnel.sh
#
# Browsers only allow the camera over HTTPS or on localhost, so a LAN IP blocks
# face check-in. cloudflared gives a real https:// URL that works network-wide.
set -euo pipefail
PORT="${1:-8000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed."
  echo "  macOS:  brew install cloudflared"
  echo "  Linux:  https://github.com/cloudflare/cloudflared/releases/latest"
  exit 1
fi

if ! curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  echo "Nothing is answering on http://localhost:${PORT}."
  echo "Start the HRMS first (./run.sh), then run this in a second terminal."
  exit 1
fi

echo "Starting a Cloudflare Tunnel to http://localhost:${PORT}"
echo "Look for the https://<random>.trycloudflare.com URL below. Ctrl-C stops it."
echo
exec cloudflared tunnel --url "http://localhost:${PORT}" \
     --http-host-header "localhost:${PORT}"
