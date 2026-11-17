# Brief for a Claude session running on mastersuite-prod-01

Written by a session that had **no** access to this host. Every host fact below
came back from the owner by hand, and the five bugs this file's companion script
has had so far were all caused by trusting `DEPLOY-STAGING.md` (how staging was
*meant* to be set up) over what the host actually reports. **Ask the host, not a
document.**

## The goal, in order

1. Complete `docs/release/staging-acceptance.sh` for candidate
   `344eb9f57f49a567f391aacfad3d3a0d3f1ce28a`.
2. That writes `/var/lib/master-suite/tested.344eb9f57f49`.
3. Then the production release, per `docs/PRODUCTION-RELEASE-PROCEDURE.md`.
   The owner runs that step or explicitly approves it.

## What is already done — do not redo it

- The bug: a white screen on the owner's iPhone immediately after every save.
  The database was always correct; closing and reopening the app showed the
  saved data.
- The fix: commit `9677aa83` on branch `fix/post-save-navigation`, PR #257. A
  confirmed save now navigates with one validated same-origin full-page GET
  instead of `router.refresh()` / `router.push()`. Reasoning and the quoted
  framework source are in `changes/2026-11-11-post-save-navigation.md`.
- CI is green. Images are built and pushed:
  - `web    sha256:d02c22269da37e3be653579780221b287e5197a6ec5d612434538713bd03424f`
  - `worker sha256:e151d35f8d75e2816af117ff97c19081098897826b507a19fc04b03f4db09cb5`
- The owner has confirmed on the affected iPhone, against the candidate running
  on **staging**, that saving no longer blanks the screen. Section 2 of
  `docs/qa/IPHONE-SAVE-VERIFICATION.md` (save, then immediately tap ← Leads) is
  the one case still worth confirming.
- Production is still serving `83d9a85e`. Nobody else has the fix yet.

## Verified host facts

Read from this host, not from any document.

| | Production | Staging |
|---|---|---|
| Compose project | `infra` | `youhan-ios-staging` |
| App checkout | `/opt/mastersuite` (root-owned `.git`; do not `sudo -u deploy` a fetch) | `/home/deploy/ios-staging` |
| Database | `leadflow` in `infra-postgres-1` | `youhan_ios_demo` in `youhan-ios-staging-postgres-1` |
| Postgres host port | none | none — reach it only via `docker exec` |
| Web published port | behind Traefik | `172.18.0.1:8090` (bridge address, **not** loopback) |
| `APP_ENV` | `production` | `demo` (not `staging`) |
| Redis `maxmemory` | `0` (unlimited) | was `48mb`, raised to `512mb` at runtime |

`MIGRATION_DATABASE_URL` in `.env.ios-staging` names the compose hostname
`postgres:5432`, which resolves only inside the stack. A host-side
`npx prisma migrate deploy` cannot work. This candidate carries no migrations,
so phase 3 now checks what is pending through `docker exec` and skips.

## The open blocker

Phase 5 (`§6b smoke with synthetic records`) fails with
`platform owner sign-in returned 500`.

The first cause is found and fixed: staging's Redis was 89M against a 48M
`maxmemory` with `noeviction`, so it refused every write, the login rate
limiter's `MULTI`/`INCR` was rejected at queue time, and `EXEC` returned
`EXECABORT`. `config set maxmemory 512mb` cleared that — but the 500 persists,
so there is a second cause. Start here:

```bash
docker logs --since 3m youhan-ios-staging-web-1 2>&1 | grep -A2 -iE '"level":50|unhandled' | tail -40
```

Two things to carry forward:

- `config set` is runtime only and reverts on container restart. Staging's
  compose file needs `--maxmemory 512mb` (or the equivalent) committed.
  `maxmemory_policy` must stay `noeviction`: BullMQ requires it, and
  `allkeys-lru` would let Redis evict queued jobs.
- **Separate defect, separate PR, not part of this release.**
  `apps/web/src/lib/security/ratelimit.ts:57` lets any Redis failure inside
  `consume()` become an unhandled 500 on `/api/v1/auth/login`. A limiter that
  cannot reach Redis should refuse cleanly. Production's Redis is unlimited
  today, so it is not currently exposed, but the defect is real.

## Rules this session must not break

- **Never write `/var/lib/master-suite/tested.<sha>` by hand**, and never weaken
  or skip a gate to make a later one pass. If a gate refuses, that is the gate
  working. Report it.
- Phase 2 refuses when staging already runs the candidate, because then the
  phase 6 rollback rehearsal would roll back to the candidate and pass having
  rehearsed nothing. Pass the real previous image:
  `PREVIOUS_IMAGE=c43b06f496a878869c4aa3064fa491766d3e518b`.
- Do not read or print `.env` files, passwords, tokens or database URLs. Pass
  credentials as environment variables for one run; never write them to disk.
  Read a container's own secret through its environment
  (`docker exec … sh -c 'redis-cli -a "$REDIS_PASSWORD" …'`).
- Do not touch production's database or data. No bulk deletes. Phase 5's
  records are synthetic, in their own throwaway workspace.
- Phase 6 briefly puts the **old** image back on staging. If the owner is
  testing on the iPhone during a run, they will see the blank screen again for a
  minute or two. Say so before running it.
- The owner runs the production release, or approves it explicitly first.

## Re-running acceptance

```bash
git -C /opt/mastersuite fetch --quiet origin
git -C /opt/mastersuite show origin/fix/post-save-navigation:docs/release/staging-acceptance.sh > /tmp/staging-acceptance.sh
chmod +x /tmp/staging-acceptance.sh
```

Run it from `/tmp`, not from the checkout: phase 3 does
`git checkout "$CANDIDATE"` inside `/opt/mastersuite` and would swap the script
file out from under bash mid-run.

```bash
read -rp 'owner email: ' OE && read -rsp 'owner password: ' OP && echo && read -rsp 'TOTP: ' T && echo
PLATFORM_OWNER_EMAIL="$OE" PLATFORM_OWNER_PASSWORD="$OP" PLATFORM_OWNER_TOTP="$T" \
  PREVIOUS_IMAGE=c43b06f496a878869c4aa3064fa491766d3e518b \
  /tmp/staging-acceptance.sh 344eb9f57f49a567f391aacfad3d3a0d3f1ce28a
```

## If phase 5 cannot be made to pass

Say so plainly rather than working around it. The fallback is the project's own
`docs/PRODUCTION-RELEASE-PROCEDURE.md`, which predates this script and does not
depend on it. Tell the owner what acceptance did **not** cover — in particular
that the rollback rehearsal never ran — so the decision to deploy is theirs and
informed. This candidate adds no migrations, which is what usually makes a
rollback unsafe.
