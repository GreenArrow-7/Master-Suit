#!/usr/bin/env bash
#
# Brings a bare Ubuntu host to the state this deployment expects.
#
# ── What this is for ────────────────────────────────────────────────────────
#
# W-9: the VM, its firewall and its disks are configured by hand, so the
# deployment cannot be recreated from the repository and a second environment is
# a person following a runbook. The Compose files and the systemd units already
# describe the stack; what was missing is the host underneath them.
#
# That is what this covers, and only that. Everything above the host — the VM
# itself, its network security group, the DNS record — stays in
# docs/DEPLOY-AZURE.md as an `az` sequence, deliberately: see "What this does
# not do" below.
#
#   sudo infra/provision-host.sh              # provision, using the defaults
#   sudo SSH_ALLOW_FROM=203.0.113.4 infra/provision-host.sh
#   sudo PROVISION_CHECK_ONLY=1 infra/provision-host.sh   # report, change nothing
#
# ── Idempotent, and that is the point ───────────────────────────────────────
#
# Cloud-init runs once, at first boot. The host that exists today did not have
# this file when it booted, so a provisioner that only works on a fresh VM
# describes a machine nobody is running. Every step here checks before it acts,
# so this is runnable on the live host to bring it to the same state — and
# re-runnable afterwards to prove it is still in it.
#
# `infra/cloud-init.yaml` calls this script rather than repeating it, so there is
# one description of the host and not two that drift.
#
# ── What this does not do ───────────────────────────────────────────────────
#
# It does not create the VM, the network security group or the DNS record. Those
# are cloud-provider resources and the honest tool for them is Terraform or
# Bicep — neither of which is written here, because a provider module that has
# never been run against a real subscription is a liability that reads like an
# asset. docs/DEPLOY-AZURE.md keeps the `az` commands, which have been run.
#
# It does not write any secret. `.env.production` is created by the operator and
# is the one file this script refuses to touch.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${APP_DIR}/../.." && pwd)"

DEPLOY_USER="${DEPLOY_USER:-deploy}"
STATE_DIR="${RELEASE_STATE_DIR:-/var/lib/master-suite}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/master-suite}"
# Empty means "do not touch the SSH rule" — narrowing 22 to one address is the
# right default for a person and the wrong one for a script that might be run by
# somebody connected from somewhere else.
SSH_ALLOW_FROM="${SSH_ALLOW_FROM:-}"
CHECK_ONLY="${PROVISION_CHECK_ONLY:-}"

say()  { printf '[provision] %s\n' "$*"; }
skip() { printf '[provision]   already: %s\n' "$*"; }
did()  { printf '[provision]   changed: %s\n' "$*"; }
fail() { printf '\n[provision] %s\n\n' "$*" >&2; exit 1; }

# Records what a check-only run *would* change, so the exit code can say whether
# the host is in the expected state. A provisioner that cannot answer "is this
# still true?" is a script you run and then hope.
DRIFT=0
act() {
  if [ -n "${CHECK_ONLY}" ]; then
    printf '[provision]   WOULD CHANGE: %s\n' "$1"
    DRIFT=$((DRIFT + 1))
    return 1
  fi
  return 0
}

[ "$(id -u)" -eq 0 ] || fail 'Run with sudo: this installs packages and writes to /etc and /var.'

# ── 1. Docker, and a Compose new enough for the overlays ────────────────────
#
# The deployment overlays use `!reset` and `!override`, which are Compose v2.24
# and newer. An older plugin does not error on them — it misreads them, which is
# how a stack comes up with the base file's published ports still in place.
say 'Docker and the Compose plugin'
if command -v docker >/dev/null 2>&1; then
  skip "docker $(docker --version | awk '{print $3}' | tr -d ,)"
else
  if act 'install docker.io'; then
    apt-get update -qq
    apt-get install -y -qq docker.io
    did 'installed docker.io'
  fi
fi

COMPOSE_VERSION="$(docker compose version --short 2>/dev/null || echo '0')"
if [ "$(printf '%s\n2.24.0\n' "${COMPOSE_VERSION}" | sort -V | head -1)" = '2.24.0' ]; then
  skip "compose ${COMPOSE_VERSION}"
else
  if act "compose ${COMPOSE_VERSION} is older than 2.24, which the overlays' !reset needs"; then
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
    did 'installed docker-compose-plugin'
  fi
fi

# ── 2. The deploy account ───────────────────────────────────────────────────
#
# The pipeline's SSH key lands here, and it is in the docker group rather than
# being given a passwordless sudo rule: `release.sh` needs to talk to the Docker
# socket and nothing else. Membership of that group is root-equivalent on this
# host, which is worth knowing rather than being surprised by — it is the reason
# the key is restricted to one repository.
say "Deploy account (${DEPLOY_USER})"
if id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  skip "user ${DEPLOY_USER}"
else
  if act "create ${DEPLOY_USER}"; then
    adduser --disabled-password --gecos '' "${DEPLOY_USER}"
    did "created ${DEPLOY_USER}"
  fi
fi

if id -nG "${DEPLOY_USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  skip "${DEPLOY_USER} is in the docker group"
else
  if act "add ${DEPLOY_USER} to the docker group"; then
    usermod -aG docker "${DEPLOY_USER}"
    did "added ${DEPLOY_USER} to docker"
  fi
fi

# ── 3. Directories the deployment writes to ─────────────────────────────────
#
# Created here rather than by the scripts that use them, so a first backup at
# 02:30 is not the thing that discovers the volume is not mounted.
say 'State and backup directories'
for spec in "${STATE_DIR}:0750" "${BACKUP_ROOT}:0700"; do
  dir="${spec%:*}"; mode="${spec##*:}"
  if [ -d "${dir}" ]; then
    skip "${dir}"
  elif act "create ${dir}"; then
    install -d -m "${mode}" -o root -g root "${dir}"
    did "created ${dir} (${mode})"
  fi
done

# `release.sh` records the running tag here as the deploy user, so root-only
# would make every deploy fail at the last step rather than the first.
if [ -d "${STATE_DIR}" ] && [ "$(stat -c '%U' "${STATE_DIR}")" = "${DEPLOY_USER}" ]; then
  skip "${STATE_DIR} is owned by ${DEPLOY_USER}"
elif [ -d "${STATE_DIR}" ] && act "chown ${STATE_DIR} to ${DEPLOY_USER}"; then
  chown "${DEPLOY_USER}" "${STATE_DIR}"
  did "chowned ${STATE_DIR}"
fi

# ── 4. Firewall ─────────────────────────────────────────────────────────────
#
# Belt to the network security group's braces. The NSG is the control that
# matters and it is outside this host; ufw is what stops a service that
# accidentally binds 0.0.0.0 from being reachable in the window before anybody
# notices. Nothing here opens 5432, 6379 or 9000 — the overlays publish no
# database port at all, and a rule for one is a standing invitation.
say 'Firewall'
if command -v ufw >/dev/null 2>&1; then
  for port in 80 443; do
    if ufw status 2>/dev/null | grep -qE "^${port}[/ ].*ALLOW"; then
      skip "ufw allows ${port}"
    elif act "ufw allow ${port}"; then
      ufw allow "${port}/tcp" >/dev/null
      did "ufw allow ${port}/tcp"
    fi
  done

  if [ -n "${SSH_ALLOW_FROM}" ]; then
    if ufw status 2>/dev/null | grep -q "${SSH_ALLOW_FROM}"; then
      skip "ufw allows 22 from ${SSH_ALLOW_FROM}"
    elif act "ufw allow 22 from ${SSH_ALLOW_FROM} only"; then
      ufw allow from "${SSH_ALLOW_FROM}" to any port 22 proto tcp >/dev/null
      did "ufw allow 22 from ${SSH_ALLOW_FROM}"
    fi
  else
    # Said out loud rather than silently left open: an operator who did not pass
    # SSH_ALLOW_FROM should know that 22 is as open as the NSG leaves it.
    say '  note: SSH_ALLOW_FROM unset, so no rule for 22 was written. The NSG is what restricts it.'
  fi

  if ufw status 2>/dev/null | grep -q 'Status: active'; then
    skip 'ufw is active'
  elif act 'enable ufw'; then
    # `--force`, because enabling interactively prompts about dropping the
    # session that is running the command.
    ufw --force enable >/dev/null
    did 'enabled ufw'
  fi
else
  say '  ufw is not installed; skipping. The network security group is the control that matters.'
fi

# ── 5. Backup and restore-verification timers ───────────────────────────────
#
# Delegated to the script that owns them, so the unit files have one installer.
say 'Backup schedule'
if [ -n "${CHECK_ONLY}" ]; then
  if systemctl list-timers --all 2>/dev/null | grep -q master-suite-backup; then
    skip 'backup timers are installed'
  else
    printf '[provision]   WOULD CHANGE: install the backup timers\n'
    DRIFT=$((DRIFT + 1))
  fi
else
  BACKUP_ROOT="${BACKUP_ROOT}" "${APP_DIR}/scripts/install-backup-schedule.sh" "${BACKUP_ROOT}"
  did 'backup schedule installed'
fi

# ── 6. What is deliberately left to a person ────────────────────────────────
say 'Configuration this script will not write'
if [ -f "${APP_DIR}/.env.production" ]; then
  skip '.env.production exists'
else
  # Not created, not templated, not prompted for. Every secret the deployment
  # holds is in that file, and a provisioner that writes secrets is a
  # provisioner whose output must be handled as one.
  say '  .env.production is absent. Create it from .env.production.example and run `npm run secrets`.'
fi

echo
if [ -n "${CHECK_ONLY}" ]; then
  if [ "${DRIFT}" -eq 0 ]; then
    say "Host matches the expected state (${REPO_DIR})."
    exit 0
  fi
  say "${DRIFT} item(s) differ from the expected state."
  exit 1
fi
say 'Host provisioned. Next: docs/DEPLOY-AZURE.md from step 2.'
