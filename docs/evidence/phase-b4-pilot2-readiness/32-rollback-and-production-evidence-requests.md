# Rollback readiness and production evidence requests

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Release candidate | `63daf3da3fff00366cee9680c520d955e427c0cf` |
| Prepared by | AI agent — **nothing here was executed against production** |
| Status | **PREPARED, NOT RUN.** Every command below is for an authorized operator |

---

# Part 1 — Rollback readiness

## 1.1 What RC-4 itself needs

| Dimension | State |
|---|---|
| Prisma schema change | **NONE** |
| Migration | **NONE** |
| Database rollback required | **NONE** |
| Product source delta vs `e620171` | **NONE** — identical tree hash `82f5ae22…` |

`release.sh rollback` is application-only by design and *"deliberately does not
touch the database"*, because `migrate deploy` has no down-path. RC-4 ships no
migration, so that limitation does not bite here: the application can go back
without the schema needing to.

## 1.2 Previous known-good SHA

| Environment | Previous known-good | Rollback available? |
|---|---|---|
| staging | **none — environment does not exist** | **NO.** First deploy has nothing to roll back to |
| production | **UNKNOWN** — deployed SHA never established | **CANNOT BE ASSESSED** |

`origin/main` is `f16ed67`, and no commit from this workstream is an ancestor of
it. But **`f16ed67` is not evidence of what production runs** — it is evidence of
what `main` points at. The deployed SHA is still unknown and still requires an
operator to read it from the running image:

```
docker inspect <web-image> \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Until that returns a value, "the previous known-good SHA" has no factual
content, and rollback readiness for production cannot be called ready.

## 1.3 The two mechanical preconditions

`release.sh rollback <env>` fails unless **both** hold:

| Precondition | Failure message |
|---|---|
| A `.previous` tag recorded in `/var/lib/master-suite` | `No previous tag recorded for <env>. Nothing to roll back to.` |
| That tag's image still on the host | `Image master-suite/web:<tag> is no longer on this host. Rebuild that commit: release.sh <env> <tag>` |

The second is the one that bites late: image pruning silently removes the
rollback target. **Retention of the previous image tag is a rollback control,
not housekeeping.** Confirm the host's prune policy preserves at least the
current and previous tags before calling rollback ready.

Rollback is symmetric — the tag just left becomes `.previous`, so a rollback can
be undone with the same command.

## 1.4 Rollback triggers

Roll back on any of:

- sign-in broken, or sessions not surviving navigation
- any tenant-isolation or authorization failure — **immediate, no diagnosis first**
- sustained 5xx on a route that worked before the deploy
- worker queue not draining, or jobs failing repeatedly
- dashboard timeouts / `P2028` at a rate not seen pre-deploy (see `BUG-007`)
- health probe failing after the deploy settles

Do **not** roll back for: a single transient error, a slow first request after a
cold start, or a defect already known to exist in the previous version too.

## 1.5 Post-rollback smoke

Minimum, in order — the same checks as §2.3 below, reduced to the fastest set
that proves the platform is serving:

1. `release.sh status` — confirm the tag actually changed
2. health endpoint returns 200
3. sign in, load a workspace dashboard
4. one CRM read and one HR read
5. worker: queue depth falling, no repeated job failures
6. logs: no new `level:50` class introduced by the rollback

## 1.6 Object-storage implication — read before rolling back past RC-4

**Rolling back to a pre-RC-4 image reintroduces the defect RC-4 fixed.** On a
POSIX host reading a Windows-written capture key, `deleteCapture` removed
nothing, returned normally, the punch row was then deleted, and the encrypted
biometric image was orphaned while the retention sweep reported success.

Consequences to weigh before rolling back past RC-4:

- Object storage is **not** covered by the database backup — the database
  carries only metadata. Orphaned objects are not recoverable by a database
  restore, and are not detected by anything that watches for errors, because the
  failure is silent by construction.
- Any retention sweep that runs while rolled back can therefore orphan more
  objects, and the sweep will report success.

**If a rollback past RC-4 is required, disable or pause the retention sweep for
the duration**, and reconcile bucket objects against `capturePath` rows
afterwards. This is a data-protection consideration, not a performance one.

## 1.7 Rollback verdict

**NOT READY**, for two independent reasons:

1. No environment to roll back in — staging does not exist; production's
   deployed SHA is unknown.
2. `EVC-005` is unresolved. The release model's recovery story below the
   application layer is restore, and no successful restore has been evidenced.

Per the standing instruction, rollback is **not** called green while `EVC-005`
is unresolved.

---

# Part 2 — Read-only production evidence requests

> **Authorization note.** Read-only production diagnostics were authorized in
> session. This workstation has no production access, so none of this was run.
> These are prepared for an operator. Nothing below writes, restarts, migrates,
> changes configuration, or prints a secret value.

## 2.1 EVC-004 — production RLS posture

Catalogue and aggregate only. **No tenant data is selected by any of these.**

```sql
-- 1. Is RLS enabled and forced on the tenant-scoped tables?
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, c.relname;

-- 2. How many policies exist per table? (names and counts, not definitions)
SELECT tablename, count(*) AS policies
FROM pg_policies WHERE schemaname = 'public'
GROUP BY tablename ORDER BY tablename;

-- 3. What is the application's runtime role, and is it a superuser or
--    BYPASSRLS? Either would make RLS decorative.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolcanlogin ORDER BY rolname;

-- 4. Does the application connect as an owner? Table owners bypass RLS
--    unless FORCE is set — which is what question 1 checks.
SELECT tableowner, count(*) FROM pg_tables
WHERE schemaname = 'public' GROUP BY tableowner;
```

What good looks like: every tenant-scoped table has `relrowsecurity = true`
**and** `relforcerowsecurity = true`; the runtime login role is neither
`rolsuper` nor `rolbypassrls`; policy counts match the repository's expectation
(`npm run check:rls` encodes it).

**Do not close `EVC-004` on the strength of these outputs.** They are evidence
for AppSec to disposition, not a verdict. An agent running a query is not an
authority accepting its result.

## 2.2 EVC-005 — backup and restore evidence

The capability exists in the repository — what is unproven is whether it is
**installed, running, and has actually restored something** in production.

Repository assets: `apps/web/scripts/backup.sh`, `backup-ship.sh`,
`backup-status.sh`, `install-backup-schedule.sh`, `restore-verify.sh`,
`test-backup-roundtrip.sh`; `docs/BACKUP-RECOVERY.md`.

```bash
# The purpose-built read-only status tool — start here.
apps/web/scripts/backup-status.sh

# Are the three timers actually installed and firing?
systemctl list-timers --all | grep -i -E 'backup|restore|freshness'
systemctl status  'master-suite-backup*' --no-pager | head -40

# Failure history rather than the happy path.
journalctl -u 'master-suite-backup*' --since '30 days ago' --no-pager \
  | grep -iE 'fail|error' | tail -50
```

Evidence required, item by item:

| # | Question | Acceptable evidence |
|---|---|---|
| 1 | Is the DB backup job installed and enabled? | `systemctl list-timers` shows it with a future `NEXT` |
| 2 | When did the last **successful** DB backup complete? | timestamp from `backup-status.sh` |
| 3 | Is it fresh? | within the schedule's window; the daily freshness check is designed to fail when it is not |
| 4 | Failure history over 30 days | journal, with counts — not "looks fine" |
| 5 | Are objects backed up? | object storage is **separate**; the DB backup carries only metadata. Bucket versioning/lifecycle state |
| 6 | Latest successful object backup + freshness | bucket/lifecycle evidence |
| 7 | Off-host copy | `backup-ship.sh` destination reachable; newest shipped artifact's timestamp |
| 8 | Retention | 30 days per `docs/ENVIRONMENTS.md` — confirm actual, not documented |
| 9 | Encryption | the nightly backup requires encryption; confirm it is in force. **Confirm by property, never by printing a key** |
| 10 | **Has an isolated restore actually succeeded?** | date, target instance, result, and integrity verification |
| 11 | RPO | derived from backup frequency + freshness |
| 12 | RTO | derived from a timed restore drill, not estimated |

The drill in `docs/ENVIRONMENTS.md` is: restore to a **new** instance (never over
the live one) → `prisma migrate status` must show a clean ledger → point a
staging deployment at it → smoke-test sign-in and one CRM read.

**Step 3 of that drill needs staging**, which does not exist. This is the
coupling recorded in the provisioning checklist: `EVC-005` and staging are not
independent blockers — the documented restore verification *runs through*
staging.

### Disposition rule

**If item 10 has no answer — if no isolated restore has actually succeeded —
`EVC-005` stays BLOCKING.** A backup that has never been restored is a file of
unknown value. Weekly `restore-verify.sh` runs would satisfy item 10 *if* the
journal shows them succeeding; that is the cheapest route to closing it.

## 2.3 Staging functional verification — prepared, not run

To be executed only after staging genuinely exists. Access is via SSH tunnel
(`ssh -L 8080:127.0.0.1:8080 <user>@<vm>`, then `http://localhost:8080`) — there
is no public hostname by design.

| Area | Checks |
|---|---|
| Health | web, API, worker, DB, Redis, object storage all up; `release.sh status` reports the expected tag |
| Auth | login, logout, session persistence, MFA where configured, password reset |
| Authorization | roles honoured; workspace access; **tenant isolation across two workspaces** |
| Product | dashboard, sales/CRM lifecycle, HR modules, critical CRUD, critical APIs |
| Capture-vault | upload → read → **delete actually removes the object** (the RC-4 fix, on a POSIX host — the condition that could not be reproduced on Windows) |
| Retention | sweep deletes objects and reports truthfully |
| Security | authz, tenant separation, RLS where safely observable, storage-path safety |
| Operations | logs, 5xx rate, worker health, queue depth, health probes |

Watch specifically for: workspace dashboard timeout, `P2028`, partial dashboard
render, 5xx spikes.

**The capture-vault delete path is the single highest-value check**, because it
is the defect RC-4 fixes and the one that cannot be observed on Windows. It is
also silent when it fails — verify by confirming the object is *gone from the
bucket*, not by confirming the request returned 200.
