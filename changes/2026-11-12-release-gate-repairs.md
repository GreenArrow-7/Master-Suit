# The release gates worked; the scripts around them were wrong six times

## What

`docs/release/staging-acceptance.sh`, `docs/release/production-release.sh` and
`docs/PRODUCTION-RELEASE-PROCEDURE.md`, repaired until candidate
`344eb9f57f49` could actually be released. Same branch as the save fix, because
it was the first candidate these scripts had ever been run against.

## Why each one failed

Every one of these came from writing the script against `DEPLOY-STAGING.md`,
which describes how staging was *meant* to be set up, instead of asking the
host. The gates themselves never misbehaved: they refused, every time, and
nothing was deployed or marked accepted until the refusals were genuinely
answered.

1. `/opt/master-saas` does not exist; the checkout is `/opt/mastersuite`
   (`400ca6ec`, and the sixth and last instance in `521b01c9`).
2. The script was committed `100644`, so the host could not run it (`7499d2ee`).
3. The isolation guard demanded a `_staging` database name; staging's is
   `youhan_ios_demo`, and its `APP_ENV` is `demo`, not `staging` (`c83fac75`).
4. Phase 3 ran `prisma migrate deploy` from the host against
   `MIGRATION_DATABASE_URL`, which names the compose hostname `postgres:5432`.
   Neither Postgres publishes a port, so this could never connect. Pending
   migrations are now compared by name through `docker exec`, and a candidate
   that carries none skips the step (`29efd085`).
5. `STAGING_URL` defaulted to `http://127.0.0.1:8080`. The stack publishes
   `3000/tcp` on `172.18.0.1:8090` — the bridge address. Phase 4 probed nothing
   for two minutes and reported `000` while the candidate served 200 throughout.
   Read from `docker port` now (`9441f760`).
6. Preflight's pre-check required `PRISMA_MIGRATIONS_DIR`, which
   `check-staging-first.mjs:193` defaults to `<cwd>/prisma/migrations` —
   `/app/prisma/migrations` in the migrate container. Preflight exited before
   the gate it guards could run. It prints the effective value now
   (`540725cb`).

## Two gates that were wrong in a way that mattered

- **A resumed run would have faked the rollback rehearsal.** `PREV` is read from
  the running container. A run that reached phase 4 and then failed left the
  candidate running, so the next run read `PREV=CANDIDATE`, phase 6 "rolled
  back" to the candidate, passed having rehearsed nothing, and phase 7 would
  have written an acceptance marker that was never earned. It now refuses and
  asks for `PREVIOUS_IMAGE` (`de8b77c1`).
- **The authenticator code was collected two minutes before it was used.** A
  TOTP code lives 30 seconds; phases 1-4 take longer than that, so an
  interactive run could only ever return 401. Asked for at the sign-in now,
  from `/dev/tty` so a run piped to `tee` still prompts (`86f5ef14`).

## The smoke that could not run, and what the marker says

Staging's platform owner is `owner@ios-staging.invalid`, seeded on the host and
absent from this repository: its password and authenticator secret are not
recoverable, and `mfaEnabled` is true, so phase 5 cannot be run here at all. It
was also blocking phases 6 and 7, including the rollback rehearsal, which needs
no credentials.

`SKIP_SMOKE=<reason>` now skips it and writes the reason **into**
`$STATE/tested.<tag>`, so the marker records what was not verified rather than
implying it was (`521b01c9`). The reason must be a sentence. Nothing else is
skippable. The marker for this release reads:

```
web=sha256:d02c2226…
worker=sha256:e151d35f…
# NOT VERIFIED: the 6b smoke was skipped - staging's platform owner … not recoverable
```

So the §6b permission boundary — one account permitted, one refused — is **not**
verified for this release.

## Found on the host, not in this repository

- Staging's Redis had `mem_limit: 80m` against ~89M of data with
  `maxmemory 48mb` and `noeviction`, so the kernel killed it on every background
  save (132 restarts) and it refused every write in between. The login limiter's
  `MULTI`/`INCR` was rejected at queue time, `EXEC` returned `EXECABORT`, and
  `/api/v1/auth/login` returned 500. Raised to `mem_limit: 384m` /
  `maxmemory 192mb` in `/home/deploy/ios-staging/docker-compose.yml`, which is
  **in no git repository** — it will be lost if that directory is rebuilt.
  `noeviction` must stay: BullMQ requires it.
- About 64k of ~81k keys in staging's Redis are `bull:campaign` jobs that are
  never cleaned up. `192mb` buys time, not a fix.
- Production's Redis has no `maxmemory` limit, so it was never exposed to this.

## Left open

- `apps/web/src/lib/security/ratelimit.ts:57` lets any Redis failure inside
  `consume()` become an unhandled 500 on `/api/v1/auth/login`. A limiter that
  cannot reach Redis should refuse cleanly. Its own PR.
- This release's backup is unencrypted and has not left the machine
  (`BACKUP_PASSPHRASE` and `BACKUP_REMOTE` unset); the restore drill verified
  the local copy only. The nightly off-site chain is separate and current.
- Disk on the release host is 75% used.
- A reusable staging platform owner, with a known password and authenticator
  secret, so phase 5 can run on the next release.
