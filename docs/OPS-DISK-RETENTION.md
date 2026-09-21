# Disk retention and the deploy disk gate

On 2026-09-21 this production host reached **94% (67 G of 75 G)**. Almost none of
it was data: it was 19 stale `master-suite/{web,worker}:<sha>` release pairs,
7.6 GB of build cache and 1.5 GB of dangling layers. Nothing was at risk of
being lost, but the host was one deploy away from an ENOSPC part-way through a
build.

Two controls came out of that, and they pull in opposite directions on purpose:

- **Retention** deletes old release images so the disk does not fill.
- **The deploy gate** refuses to start a build when it might not fit.

Both are constrained by one fact: **there is no image registry for production.**
`scripts/release.sh` says so in its own header. A rollback works because the
previous image is still on this disk. Every deletion here is therefore a
deletion of rollback capability, and the protected set is the recovery path, not
a nicety.

## Files

| Path | Role |
|---|---|
| `apps/web/infra/ops/ms-disk-preflight.sh` | the disk gate |
| `apps/web/infra/ops/ms-image-retention.sh` | the retention decision and its application |
| `apps/web/infra/ops/install.sh` | idempotent installer |
| `apps/web/infra/ops/test/retention-test.sh` | regression suite, no Docker needed |
| `apps/web/infra/systemd/master-suite-image-retention.{service,timer}` | the daily check |

Installed to `/usr/local/sbin/` and `/etc/systemd/system/`.

## Install or update

```bash
apps/web/infra/ops/install.sh            # dry run — what would change
sudo apps/web/infra/ops/install.sh --apply
```

Idempotent; re-run it after every deploy. It writes executables and systemd
units only — never env files, volumes or images.

The one exception is a rename it performs once, on hosts provisioned before the
staging names were separated: `staging.{current,previous}` →
`ios-staging.{current,previous}` in `/home/deploy/ios-staging`. The retention
script reads the namespaced names, and a pointer it cannot find is a pointer
that has stopped protecting its image — so the rename has to land with the
install, not after it. A fresh host has neither file and skips it.

## The deploy gate

`scripts/release.sh` calls the preflight itself, so an operator running it
directly is gated exactly the same as one going through `ms-release`. The
wrapper is convenience, not enforcement.

| Path | Behaviour |
|---|---|
| deploy, < 75% used | silent |
| deploy, ≥ 75% used | warning, proceeds |
| deploy, ≥ 90% used or < 8 GB free | **refused**, exit 1 |
| `ALLOW_LOW_DISK=yes` deploy | proceeds, logs that it overrode |
| **rollback, any disk level** | **warning only, always proceeds** |

Rollback is deliberately never blocked. It starts an image already proven
present on disk, so it writes essentially nothing — and refusing an emergency
rollback because the disk that caused the emergency is full would remove the
only way out of it.

```bash
scripts/release.sh rollback production    # works at 99% full
```

## Retention

```bash
ms-image-retention.sh            # dry run — prints, deletes nothing
ms-image-retention.sh --apply    # reclaim
ms-image-retention.sh --auto     # apply only at/above AUTO_PCT — what the timer runs
```

Never `docker system prune -a`. Never `rmi -f`: a tag a container holds must
refuse to be removed, not be forced out from under it.

### Protected, unconditionally

- `production.current`, `production.previous`
- the newest `RETAIN` (default 5) verified releases — `tested.<sha>` markers
- `ios-staging.current`, `ios-staging.previous`
- `IMAGE_SHA` in the live `.env.ios-staging`
- `IMAGE_SHA` in *recent* staging env backups — see below
- `infra-migrate:latest` — built from the working tree with no registry to pull
  from, and full builds OOM on this 4 GB host
- every image any container references, running or exited

Release tags are 12 characters locally and 40 in the ghcr mirror, so everything
is compared on the 12-character prefix. Without that the mirror tag of a
protected release reads as unprotected and the rollback pair is half-deleted.

### Why backup env files expire

The first version of this protected every `IMAGE_SHA` in every historical
`.env.ios-staging.bak-*`. That is a ratchet: each deploy leaves another backup,
each backup pins another image pair **forever**, and the disk refills on exactly
the images the script exists to remove.

A backup now protects its image only while it is **both** one of the newest
`BAK_KEEP` (default 2) **and** younger than `BAK_MAX_AGE_DAYS` (default 30).
Backups past both limits are listed in the dry run and removed under `--apply`.
The live `.env.ios-staging` is never a candidate.

### Interlocks

- Refuses to run while a build or deploy is in flight (buildkit cache active, or
  a `release.sh` / `stage-run.sh` process running).
- `--auto` exits 0 without touching anything below `AUTO_PCT` (default 80), so a
  healthy host keeps every rollback image it has room for.
- Dry run is the default. `--apply` is always explicit.

## Which staging is which

Two different stacks have been called "staging" on this host. They are not
interchangeable and an unqualified `staging.current` cannot say which it means.

| | `release-staging` | `ios-staging` |
|---|---|---|
| Compose project | `master-suite-staging` | `youhan-ios-staging` |
| Defined in | `infra/docker-compose.staging.yml` | `/home/deploy/ios-staging/docker-compose.yml` |
| Images | built locally, **12**-char tags | pulled from ghcr, **40**-char shas |
| Deployed by | `scripts/release.sh staging` | `/home/deploy/stage-run.sh` |
| State | `/var/lib/master-suite/release-staging.{current,previous}` | `/home/deploy/ios-staging/ios-staging.{current,previous}` |
| Promotion source | **yes — the only one** | **never** |

`docs/PRODUCTION-RELEASE-PROCEDURE.md` §0 states that `release.sh` does not
control the ios-staging stack. Only `release-staging` writes the pointer
production promotes from.

**`release-staging` is not currently deployed on this host** — `docker compose ls`
shows only `infra` and `youhan-ios-staging`. So bare promotion has nothing to
read and refuses, by design:

```
$ scripts/release.sh production
[release] No release-staging release is recorded, so there is nothing to promote.
          Name the commit you verified, explicitly:
              scripts/release.sh production <verified-sha>
```

Until a release-staging stack exists, **production promotion takes an explicit
verified sha** — which is what `docs/release/production-release.sh deploy <SHA>`
has always passed. The old behaviour would have read an unqualified
`staging.current`; had anything written one from the ios-staging stack,
production would have tried to deploy a 40-character ghcr sha as a
locally-built 12-character tag: an artefact production never built.

## Tests

```bash
bash apps/web/infra/ops/test/retention-test.sh
```

22 assertions, no Docker daemon and no deletion. The scripts take their image
list, container-held ids and removal command as injectable seams, so the
destructive branch runs against a log of what it *would* remove — the only safe
way to test a branch whose real effect is the loss of a rollback image.

Proven: production current and rollback, active staging and its rollback,
container-held images and the newest verified releases are all unselectable;
releases outside the window and stale `.bak-*` pins are selectable; an in-flight
build blocks cleanup; a dry run deletes nothing; and rollback stays callable at
a disk level that refuses a deploy.

## If the disk fills anyway

```bash
ms-image-retention.sh                 # see what is reclaimable
ms-image-retention.sh --apply         # reclaim it
scripts/release.sh status             # confirm rollback images survived
```

If a rollback is what you actually need, it is not blocked — run it first and
clean up afterwards.
