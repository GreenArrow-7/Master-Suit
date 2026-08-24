#!/bin/sh
# Generates alertmanager.yml from the deployment's env file and starts the server.
#
# ── Why the config is generated rather than checked in ──────────────────────
#
# Alertmanager, like Prometheus, does not expand environment variables in its
# own configuration. Everything that differs between deployments here is either
# a secret (the SMTP password, a chat webhook URL) or an address that belongs to
# whoever is on call — so a checked-in file would be a file with holes in it
# that every deployment edits by hand and no two of which stay in step.
#
# What IS checked in is this script, and the part of the configuration that
# encodes a decision rather than an address: the severity split, the repeat
# intervals, and the inhibitions. Those are reviewable in the diff, which is the
# point.
#
# ── The severity split ──────────────────────────────────────────────────────
#
# prometheus-alerts.yml labels every rule `severity: page` or `severity: ticket`
# and says in each rule's comment why. This turns that label into behaviour:
#
#   page    — grouped for 30s, repeated hourly until it resolves. Five rules:
#             TenantGuardTripped, QueueHasNoConsumer, ServerErrorRateHigh,
#             ApplicationDown, and anything later marked the same way.
#   ticket  — grouped for two minutes, repeated daily. Loud enough not to be
#             lost, quiet enough that a slow-burning one does not train the
#             recipient to ignore the sender.
#
# Both go to the same relay this deployment already sends its product mail
# through. Email is a weak pager, and it is what a single-VM deployment has; set
# ALERT_WEBHOOK_URL to put `page` in front of something that actually wakes
# somebody, and ALERT_PAGE_EMAIL_TO to route it to a different address.
set -eu

# Overridable so the generator can be exercised outside its image —
# tests/unit/observability.spec.ts renders it to a temporary directory and reads
# what comes out. In the container both stay on the tmpfs at /run/am.
OUT_DIR="${ALERTMANAGER_OUT_DIR:-/run/am}"
CONFIG="$OUT_DIR/alertmanager.yml"
PASSWORD_FILE="$OUT_DIR/smtp-password"

die() { echo "alertmanager: $1" >&2; exit 1; }

# Everything below is interpolated into single-quoted YAML scalars. A single
# quote or a newline in one of these would end the scalar early and produce a
# config that is either invalid or — worse — valid and wrong.
safe() {
  case "$2" in
    *\'*) die "$1 contains a single quote, which cannot be represented here." ;;
  esac
  # Not a `case` glob: command substitution strips trailing newlines, so the
  # obvious `*"$(printf '\n')"*` collapses to `**` and matches every value —
  # a guard that silently passes everything. Counting them is unambiguous.
  [ "$(printf '%s' "$2" | wc -l)" -eq 0 ] || die "$1 contains a newline."
}

[ -n "${ALERT_EMAIL_TO:-}" ] || die 'ALERT_EMAIL_TO is empty — alerts would fire into nothing.
  This is the address that receives them. Set it in the env file this stack was
  started with. A deployment with alert rules and no recipient is worse than one
  with neither: it reads as monitored.'
[ -n "${SMTP_HOST:-}" ] || die 'SMTP_HOST is empty — there is no relay to send alerts through.'

SMTP_PORT="${SMTP_PORT:-587}"
# Staging sends through the Mailpit container, which speaks plain SMTP on 1025
# and offers no STARTTLS, so a hard-coded `true` would make staging the one
# environment whose alerting never delivers — the exact failure this whole
# change exists to remove. Production leaves it alone.
ALERT_SMTP_REQUIRE_TLS="${ALERT_SMTP_REQUIRE_TLS:-true}"
case "$ALERT_SMTP_REQUIRE_TLS" in
  true|false) ;;
  *) die "ALERT_SMTP_REQUIRE_TLS must be 'true' or 'false', not '${ALERT_SMTP_REQUIRE_TLS}'." ;;
esac
ALERT_PAGE_EMAIL_TO="${ALERT_PAGE_EMAIL_TO:-$ALERT_EMAIL_TO}"
ALERT_EMAIL_FROM="${ALERT_EMAIL_FROM:-${EMAIL_FROM:-Master Suite <no-reply@localhost>}}"
APP_ENV="${APP_ENV:-unknown}"

safe ALERT_EMAIL_TO "$ALERT_EMAIL_TO"
safe ALERT_PAGE_EMAIL_TO "$ALERT_PAGE_EMAIL_TO"
safe ALERT_EMAIL_FROM "$ALERT_EMAIL_FROM"
safe SMTP_HOST "$SMTP_HOST"
safe SMTP_PORT "$SMTP_PORT"
safe SMTP_USER "${SMTP_USER:-}"
safe ALERT_WEBHOOK_URL "${ALERT_WEBHOOK_URL:-}"

umask 077

# ── global ──────────────────────────────────────────────────────────────────
{
  echo 'global:'
  echo '  resolve_timeout: 5m'
  echo "  smtp_smarthost: '${SMTP_HOST}:${SMTP_PORT}'"
  echo "  smtp_from: '${ALERT_EMAIL_FROM}'"
  echo "  smtp_require_tls: ${ALERT_SMTP_REQUIRE_TLS}"
  if [ -n "${SMTP_USER:-}" ]; then
    echo "  smtp_auth_username: '${SMTP_USER}'"
    # By file, not by value: `docker inspect` on this container prints its whole
    # environment, and the relay password is the one credential here that also
    # unlocks something outside the deployment.
    printf '%s' "${SMTP_PASSWORD:-}" > "$PASSWORD_FILE"
    echo "  smtp_auth_password_file: ${PASSWORD_FILE}"
  fi
} > "$CONFIG"

# ── routing ─────────────────────────────────────────────────────────────────
#
# `queue` is in group_by so that two queues stalling are two notifications
# rather than one that names whichever fired first. Alerts without the label
# group under its absence, which is the behaviour wanted.
cat >> "$CONFIG" <<'YAML'

route:
  group_by: ['alertname', 'environment', 'queue']
  receiver: 'ticket'
  group_wait: 2m
  group_interval: 30m
  repeat_interval: 24h
  routes:
    - matchers: ['severity="page"']
      receiver: 'page'
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 1h

inhibit_rules:
  # When the application is down, everything downstream of it is a symptom: the
  # queues stop draining, the error rate is whatever the last scrape saw, and
  # latency is undefined. One notification, naming the cause.
  #
  # ApplicationDown is excluded from its own targets explicitly rather than
  # relying on Alertmanager's self-inhibition guard, because that guard compares
  # fingerprints and these two would differ by label.
  - source_matchers: ['alertname="ApplicationDown"']
    target_matchers: ['alertname!="ApplicationDown"']
    equal: ['environment']

  # A queue with no consumer will always also be a queue with an ageing
  # backlog. The first is the fault; the second is the clock running.
  - source_matchers: ['alertname="QueueHasNoConsumer"']
    target_matchers: ['alertname=~"QueueBacklogAgeing|QueueFailuresAccumulating|QueueDeferralsSustained"']
    equal: ['environment', 'queue']

receivers:
YAML

# ── receivers ───────────────────────────────────────────────────────────────
#
# Subject lines carry the environment, because the whole reason Prometheus
# stamps an `environment` external label is so that a staging alert at 3am is
# recognisable as one before it is opened.
emit_receiver() {
  name="$1"; to="$2"; tag="$3"
  cat >> "$CONFIG" <<YAML
  - name: '${name}'
    email_configs:
      - to: '${to}'
        send_resolved: true
        headers:
          Subject: '[${tag}][{{ .CommonLabels.environment }}] {{ .GroupLabels.alertname }} — {{ .Alerts.Firing | len }} firing'
YAML
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    cat >> "$CONFIG" <<YAML
    webhook_configs:
      - url: '${ALERT_WEBHOOK_URL}'
        send_resolved: true
        max_alerts: 20
YAML
  fi
}

emit_receiver page "$ALERT_PAGE_EMAIL_TO" PAGE
emit_receiver ticket "$ALERT_EMAIL_TO" ticket

# Fail here rather than serving a config Alertmanager silently half-loaded.
# amtool ships in the same image as the server; it is absent when this script is
# run as a generator from the test suite, and there is nothing to validate
# against in that case beyond the YAML itself.
if [ -x /bin/amtool ]; then
  /bin/amtool check-config "$CONFIG" >/dev/null \
    || die 'generated config is invalid; ALERTMANAGER_DUMP_CONFIG=1 prints it'
fi

[ -z "${ALERTMANAGER_DUMP_CONFIG:-}" ] || cat "$CONFIG" >&2

# The generator half, on its own, for the test suite.
[ -z "${ALERTMANAGER_RENDER_ONLY:-}" ] || exit 0

exec /bin/alertmanager \
  --config.file="$CONFIG" \
  --storage.path=/alertmanager \
  --web.listen-address=0.0.0.0:9093
