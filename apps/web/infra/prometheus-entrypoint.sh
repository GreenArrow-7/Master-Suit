#!/bin/sh
# Renders prometheus.yml into a tmpfs and starts the server.
#
# Two things have to be injected at start rather than checked in:
#
#   1. METRICS_TOKEN, the bearer credential for /api/metrics. Prometheus reads
#      it from a file (`credentials_file`), never from an argument, so it does
#      not appear in `ps` or in `docker inspect`'s Cmd.
#   2. APP_ENV, as the `environment` external label, so staging's alerts are
#      distinguishable from production's.
#
# Both are written to /run/prom, which docker-compose.yml mounts as tmpfs. The
# token never touches this host's disk and does not survive the container.
set -eu

# Overridable so the render can be exercised outside its image; in the
# container both stay on the tmpfs at /run/prom.
OUT_DIR="${PROMETHEUS_OUT_DIR:-/run/prom}"
SOURCE="${PROMETHEUS_CONFIG_SOURCE:-/etc/prometheus/prometheus.yml}"
RENDERED="$OUT_DIR/prometheus.yml"
TOKEN_FILE="$OUT_DIR/metrics-token"

if [ -z "${METRICS_TOKEN:-}" ]; then
  # Fail here rather than 60 seconds later as ApplicationDown. The metrics route
  # answers 404 with no token configured, which a scraper cannot tell apart from
  # a process that is down — so an unconfigured Prometheus would spend its life
  # paging about an application that is fine.
  echo 'prometheus: METRICS_TOKEN is empty.' >&2
  echo '  /api/metrics answers 404 without it, so every scrape would fail and' >&2
  echo '  ApplicationDown would fire against a healthy application.' >&2
  echo '  Set METRICS_TOKEN in the env file this stack was started with, on the' >&2
  echo '  web, worker and prometheus services alike (`npm run secrets` emits one).' >&2
  exit 1
fi

if [ -z "${APP_ENV:-}" ]; then
  echo 'prometheus: APP_ENV is empty — alerts would carry no environment label.' >&2
  exit 1
fi

# 0600 on everything this creates. The tmpfs is mode 1777 so an unprivileged
# process can write to it at all; umask is what keeps the token unreadable to
# anything else that ends up in this namespace.
umask 077

printf '%s' "$METRICS_TOKEN" > "$TOKEN_FILE"

# `sed` rather than envsubst: busybox has one and not the other, and there is
# exactly one placeholder. APP_ENV is a closed enum in src/lib/env.ts
# (development|test|demo|staging|production), so it cannot carry a delimiter.
sed "s|@APP_ENV@|${APP_ENV}|g" "$SOURCE" > "$RENDERED"

# The render half, on its own, for the test suite.
[ -z "${PROMETHEUS_RENDER_ONLY:-}" ] || exit 0

exec /bin/prometheus \
  --config.file="$RENDERED" \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time="${PROMETHEUS_RETENTION:-30d}" \
  --web.listen-address=0.0.0.0:9090 \
  --web.enable-lifecycle
