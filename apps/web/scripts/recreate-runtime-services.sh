#!/usr/bin/env bash
#
# Recreate the services whose runtime state does not survive a host reboot.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# Nothing brings this stack up at boot. Docker's `restart: unless-stopped` does
# it, and that **restarts** containers — it never **recreates** them. A restarted
# container keeps the mount setup it was created with.
#
# On 2026-09-07 08:42:36 the host booted into kernel 6.8.0-139 (from -138).
# `infra-prometheus-1` and `infra-alertmanager-1` had been created on 09-04, and
# after that boot their `tmpfs` mounts were no longer applied as they had been:
# both entrypoints render their config into `/run/prom` and `/run/am` and both
# died on the first write, as `nobody`, 1112 times over two days. Production had
# no metrics and no alerting until someone read `docker ps`.
#
# They are the only two services in the stack that use `tmpfs`, which is exactly
# why nothing else was affected despite every container being the same age.
#
# ── Why only those two ──────────────────────────────────────────────────────
#
# `docker-compose.prod.yml` resolves the application images as
# `${IMAGE_TAG:-dev}`. A whole-stack `up -d` at boot with IMAGE_TAG unset would
# silently recreate web and worker from `master-suite/web:dev` — a stale image
# that has already caused one outage on this host. Naming exactly the two
# services that need it means the application containers are never touched, and
# the fallback cannot reach them.
#
# IMAGE_TAG is still resolved and still required, because Compose interpolates
# the whole file before it selects services. It is read from what is actually
# running rather than guessed, and this fails closed if it cannot be determined.
#
# ── What it deliberately does not do ────────────────────────────────────────
#
# No root containers, no world-writable directories, no cron loop, no periodic
# restarts. It runs once, after Docker, and is a no-op when nothing needs
# recreating.
set -euo pipefail

INFRA="${INFRA:-/opt/mastersuite/apps/web/infra}"
ENV_FILE="${ENV_FILE:-../.env.production}"
SERVICES=(prometheus alertmanager)

cd "$INFRA"

# The tag that is actually deployed, from a running container — never a default.
TAG=""
for c in infra-worker-1 infra-web-1; do
  TAG="$(docker inspect "$c" --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://')" || true
  [ -n "$TAG" ] && break
done
if [ -z "$TAG" ] || [ "$TAG" = "dev" ]; then
  echo "recreate-runtime-services: refusing to run — could not determine the deployed IMAGE_TAG." >&2
  echo "recreate-runtime-services: a Compose run without it resolves the application images to :dev." >&2
  exit 1
fi

echo "recreate-runtime-services: IMAGE_TAG=${TAG}; recreating ${SERVICES[*]}"
IMAGE_TAG="$TAG" docker compose --env-file "$ENV_FILE" \
  -f docker-compose.yml -f docker-compose.prod.yml \
  -f docker-compose.azure.yml -f docker-compose.small-host.yml \
  up -d --force-recreate "${SERVICES[@]}"

# Prove it, rather than assume it. Both declare a healthcheck.
for svc in "${SERVICES[@]}"; do
  name="infra-${svc}-1"
  for _ in $(seq 1 60); do
    state="$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    [ "$state" = "healthy" ] && break
    sleep 2
  done
  restarts="$(docker inspect "$name" --format '{{.RestartCount}}' 2>/dev/null || echo '?')"
  echo "recreate-runtime-services: ${name} health=${state:-unknown} restarts=${restarts}"
  [ "${state:-}" = "healthy" ] || { echo "recreate-runtime-services: ${name} did not become healthy" >&2; exit 1; }
done
