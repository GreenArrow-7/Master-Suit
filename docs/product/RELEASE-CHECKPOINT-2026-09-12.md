# Release checkpoint — 12 September 2026

**Reviewable checkpoint. Not production approval. Production remains NOT APPROVED.**

This consolidates the state at the revision named in §1. Earlier documents are
not re-stated where they are still correct; they are linked. Where this file and
an earlier one disagree, this file is the later record.

|                             |                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Branch                      | `claude/restructure-foundation` (worktree `claude/master-suite-baseline-validation-7c75ce`)           |
| Gated source revision       | **`bbfb8ae`** = `bbfb8ae70bd60017ccfc26f8e5197b1c970a9d74`                                            |
| HEAD at the time of writing | the commit that adds this file — differs from the gated revision by **documentation only** (§1.4)     |
| Deadline                    | Handover 12 Sep 2026 12:00 Asia/Dubai; go/no-go 09:00. Written at 07:30 Dubai.                        |
| Not done, deliberately      | Package 2 not started. Nothing merged. Nothing deployed. Production data and configuration untouched. |

---

## 1. Tasks, artifacts and revision reconciliation

### 1.1 Every background task this session, and what became of it

All tasks were launched by this session on this machine. None wrote to the
repository; the ones that ran gates wrote only under
`validation-evidence/release-candidate/` (gitignored `*.log`) and to the
container's own filesystem.

| Task id                   | Purpose                                                            | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                   |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `b61kjp1mn`               | Windows unit suite after the booking fix                           | **Completed, exit 1** — the three known Windows failures only (2 NTFS 0600-mode, 1 Redis contention), none booking-related                                                                                                                                                                                                                                                                                                                                                                                      | `gate15-unit-booking-fix.log`                              |
| `bzxv1lu4j`               | Linux gate set at `2272065`                                        | **Completed, `LINUX_GATES_FAIL=1`** — gate 12: 1 failed / 4 skipped, detail lost inside the `--rm` container                                                                                                                                                                                                                                                                                                                                                                                                    | `gates-linux-booking.log`                                  |
| `bgi1ovpg5`               | Build `web`/`worker` images at `2272065`                           | **Completed, exit 0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | image tags `master-suite/{web,worker}:2272065`             |
| `bw31v2i30`               | `docker wait` on the gate container                                | Completed (waiter only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                                          |
| `bier9hc5q`               | Linux unit re-run with the log preserved                           | **Completed, 2 failed / 2,143 passed** — `credential-purge` (git worktree pointer cannot resolve in the container) and `p2-regressions` P2-5 (shared Redis bucket); both **40/40 in isolation**                                                                                                                                                                                                                                                                                                                 | `gate12-unit-linux-detail.log`                             |
| `b4kivx2ax`               | Linux unit run with `BUILD_COMMIT` supplied                        | **Killed by me** — `environment-separation.spec.ts` 4/4 failing on an esbuild `TransformError`: the bind-mounted `node_modules` had been flipped to win32 by my own restore. Nothing to preserve.                                                                                                                                                                                                                                                                                                               | `gate12-unit-linux-final.log` (partial)                    |
| `bg6da4zh9`               | Linux gates with a container-local `node_modules`                  | **Failed at line 32 with a syntax error — I committed an edit to the script while the container was executing it.**                                                                                                                                                                                                                                                                                                                                                                                             | `gates-linux-2272065.log` (first lines)                    |
| `bik715csz` / `bnwsin6wc` | Same, script copied outside the worktree first                     | **Completed, `LINUX_GATES_FAIL=1`** — gate 12: 1 failed / 0 skipped; detail again lost                                                                                                                                                                                                                                                                                                                                                                                                                          | overwritten by the next run                                |
| `bxqagos1v` / `bii77v3b5` | Same, runner now keeps the vitest log                              | **Completed, gate 12: 1 failed** — P2-4 `rejects on Content-Length`: the `PlatformSetting` coupling, §2                                                                                                                                                                                                                                                                                                                                                                                                         | `gate12-unit-detail.log`                                   |
| `b50fdc3nl` / `b6f70osm7` | Linux gates at `f59bf47`                                           | **Completed, `LINUX_GATES_FAIL=0`**, 2,145/2,145                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `gates-linux-f59bf47.log`                                  |
| `bdp1augh9`               | Build images at `f59bf47`                                          | **Completed, exit 0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | tags `:f59bf47`                                            |
| `bi8ldyude`               | Linux gates at `98b4e93`                                           | **Completed, `LINUX_GATES_FAIL=1`** — gate 12: **2 failed / 2,146 passed / 0 skipped**, both `Test timed out in 30000ms` in `filter-field-maps.spec.ts`. Not an assertion: the spec walked every file under `src/` once **per test** over the bind mount (6 s alone, 15 s each in the previous passing run) and I had gates 13 and 14 running on the host at the same time. Fixed at `bbfb8ae` — one walk per file, and a budget that names the cost. My concurrency, the suite's cost model, no product change | `gates-linux-98b4e93.log`                                  |
| `bt1y6l2ff`               | Build images at `98b4e93`                                          | **Completed, exit 0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | tags `:98b4e93`                                            |
| foreground                | Gate 13 at `98b4e93`                                               | **6/6, exit 0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `gate13-integration-98b4e93.log`                           |
| foreground                | Gate 14 at `98b4e93` — 47 browser specs **+ 4 booking API checks** | **51/51, exit 0** against `web:98b4e93`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `gate14-e2e-98b4e93.log`                                   |
| `bj9e88slr`               | Linux gates at `bbfb8ae` — run **alone**, nothing else on the host | **Completed, `LINUX_GATES_FAIL=0`** — gate 12: **2148/2148, 0 failed, 0 skipped**                                                                                                                                                                                                                                                                                                                                                                                                                               | `gates-linux-bbfb8ae.log`, `gate12-unit-detail.log`        |
| `by69lpjnk`               | Build images at `bbfb8ae`                                          | **Completed, exit 0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | tags `:bbfb8ae`, digests in §1.3                           |
| foreground                | Gates 13 and 14 at `bbfb8ae`, after the Linux run finished         | **13: Tests 6 passed (6); 14: 51/51, exit 0 each**                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `gate13-integration-bbfb8ae.log`, `gate14-e2e-bbfb8ae.log` |

Foreground runs (gates 13, 14, the isolation and booking specs) are in §1.3 and
§3 with their log names.

### 1.2 Host processes and containers that still exist

| What                                                                   | State                                                                                                                   | Can it change the verified source or a shared dependency?                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rc-web` / `rc-worker` containers, `master-suite/{web,worker}:bbfb8ae` | Running; the artifact gate 14 and §3.4 ran against                                                                      | **No.** They read `master_suite_val` and Redis db 13 and write only their own tenant rows. They do not mount the source.                                                                                                                                                                                        |
| `node …/scratchpad/tls-proxy.mjs` (PID 11676)                          | Running since 11 Sep 02:21; terminates TLS on `127.0.0.1:3443` → `3320`                                                 | **No.** A byte relay with no filesystem access beyond its own certificate. Needed by gate 14; left running.                                                                                                                                                                                                     |
| `node node_modules/next/dist/bin/next start -p 3000` (PID 24808)       | Running since 11 Sep 08:01, from earlier standalone-serving work. Obsolete — nothing in this checkpoint uses port 3000. | **No** to the source: `next start` serves a build output and reads no source. It does hold a Redis connection. **I attempted to stop it; the action was refused by the session's permission classifier.** It is reported here rather than worked around. Stop it with `Stop-Process -Id 24808` when convenient. |
| Linux gate containers (`node:24`, `--rm`)                              | None running                                                                                                            | —                                                                                                                                                                                                                                                                                                               |
| `.env.test.local`                                                      | Does not exist; every gate this session passed its connection strings explicitly                                        | —                                                                                                                                                                                                                                                                                                               |

**Nothing remaining can mutate the verified source.** The worktree is clean at
HEAD; the gate runner executes a copy outside the tree; `node_modules` for the
Linux runs lives in an anonymous Docker volume and never touches the host copy.

### 1.3 The sixteen gates at `bbfb8ae`

| #   | Gate                         | Command                                                                                                             | Environment                                                                                                                                                                                             | Exit  | Result                                                                           |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| 1   | Schema drift                 | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`                     | Linux `node:24` container, source bind-mounted read-through, container-local `node_modules`, DB `master_suite_ci` on the host, Redis host db 13                                                         | **0** | PASS                                                                             |
| 2   | Tenant isolation             | `node scripts/check-rls.mjs`                                                                                        | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 3   | Raw SQL scope                | `node scripts/check-raw-sql-scope.mjs`                                                                              | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 4   | Typecheck                    | `npx tsc --noEmit`                                                                                                  | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 5   | Lint                         | `npm run lint`                                                                                                      | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 6   | Format check                 | `npm run format:check`                                                                                              | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 7   | README schema counts         | `node scripts/schema-stats.mjs --check`                                                                             | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 8   | Observability drift          | `npm run check:observability`                                                                                       | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 9   | Redis auth                   | `npm run check:redis-auth`                                                                                          | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 10  | Face token gate              | `python3 ../face/test_tokens.py`                                                                                    | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 11  | Backup round trip            | `bash scripts/test-backup-roundtrip.sh`                                                                             | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 12  | Unit suite                   | `npx vitest run`                                                                                                    | as 1 — **run alone, nothing else on the host**                                                                                                                                                          | **0** | **2148 passed / 0 failed / 0 skipped**, 161 files                                |
| 13  | Integration (server)         | `npm run test:server` with `E2E_DATABASE_URL`/`E2E_REDIS_URL` naming the disposable target                          | Windows host, loopback Postgres `master_suite_val` (owner role) + Redis                                                                                                                                 | **0** | **Tests 6 passed (6)**                                                           |
| 14  | E2E (browser + artifact API) | `npx playwright test` with `APP_URL=https://127.0.0.1:3443`, `E2E_MAILPIT_URL`, `E2E_DATABASE_URL`, `E2E_REDIS_URL` | Windows Chromium → TLS terminator → `rc-web` = `master-suite/web:bbfb8ae` + `rc-worker` = `master-suite/worker:bbfb8ae`, `NODE_ENV=production`, `/api/v1/dev/outbox` 404, `NODE_EXTRA_CA_CERTS` mounted | **0** | **51 passed / 0 failed / 0 skipped / 0 unexecuted** (47 browser + 4 booking API) |
| 15  | Build                        | `npx next build`                                                                                                    | as 1                                                                                                                                                                                                    | **0** | PASS                                                                             |
| 16  | Audit                        | `npm audit --omit=dev --audit-level=high`                                                                           | as 1                                                                                                                                                                                                    | **0** | 0 vulnerabilities                                                                |

**16 of 16, sixteen recorded exit codes.** `LINUX_GATES_FAIL=0` covers 1–12, 15, 16 (`gates-linux-bbfb8ae.log`, unit detail in `gate12-unit-detail.log`); 13 and 14 carry their own (`gate13-integration-bbfb8ae.log`, `gate14-e2e-bbfb8ae.log`). 2148 = 2,137 (previous revision) + 8 booking acceptance + 2 booking races + 1 lock proof.

| Artifact           | Identity                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source             | `bbfb8ae70bd60017ccfc26f8e5197b1c970a9d74`                                                                                                                    |
| Web image          | `master-suite/web:bbfb8ae` — `sha256:7bc7250394cdeffe1e46f4a0818bfd9e12b6ade6a9c3c2b6d29c4f7a0d293a2e`                                                        |
| Worker image       | `master-suite/worker:bbfb8ae` — `sha256:cf6810836a3aad27908422a175a338c24bb2bcc2d0aed51f7d70147134700e19`                                                     |
| Running containers | `BUILD_COMMIT=bbfb8ae70bd60017ccfc26f8e5197b1c970a9d74`, `NODE_ENV=production`, `/api/health` 200 over TLS, `/api/v1/dev/outbox` 404, `/certs/ca.pem` present |

### 1.4 Diff proving HEAD changes documentation only

```
$ git diff --name-status bbfb8ae..HEAD
A	docs/product/RELEASE-CHECKPOINT-2026-09-12.md
M	docs/product/RELEASE-CHECKPOINT-CORRECTED.md   (one superseded-by pointer; the rest is Prettier table re-padding)

(Verified after the commit; see the delivery message for the literal command output.)
```

---

## 2. The global-setting coupling — verified, not narrowed

### 2.1 The diff

`f59bf47` read the effective limit instead of `env.UPLOAD_MAX_MB`. **That was
not isolation, and this checkpoint does not claim it was**: between
`getUploadMaxMb()` in the test and `getUploadMaxMb()` in the route, another
spec could still change the row. `PlatformSetting` has no `tenantId` — it is in
`GLOBAL_MODELS` — so no fixture tagging separates two files that use the same
key.

`98b4e93` closes it with a Postgres advisory lock on a dedicated session
(`tests/helpers/serialize.ts`), taken by **both** files that touch the key —
the only two in the suite (`grep -rl uploadMaxMb tests/`):

```diff
diff --git a/apps/web/tests/helpers/serialize.ts b/apps/web/tests/helpers/serialize.ts
new file mode 100644
index 0000000..cb7ad1f
--- /dev/null
+++ b/apps/web/tests/helpers/serialize.ts
@@ -0,0 +1,41 @@
+import pg from 'pg';
+
+/**
+ * Serialise spec files that share state the database cannot isolate for them.
+ *
+ * `PlatformSetting` carries no `tenantId` — it is in `GLOBAL_MODELS` — so two
+ * spec files that touch the same key see each other's writes no matter how
+ * their fixtures are tagged. Reading the same value the implementation reads
+ * narrows the window; it does not close it. This closes it: a Postgres
+ * advisory lock, session-scoped, on a dedicated connection.
+ *
+ * Why an advisory lock and not a vitest option: vitest has no cross-file mutex,
+ * and `fileParallelism: false` would serialise all 160 files to protect two.
+ * Why session-scoped on its own client: it is released by `pg_advisory_unlock`
+ * in `afterAll`, and — if the worker dies before that — by the server when the
+ * connection drops. Nothing is left held by a crashed test.
+ *
+ * Usage, in every file that reads or writes the shared thing:
+ *
+ *   let release: Release;
+ *   beforeAll(async () => { release = await lockShared('platform-setting:uploadMaxMb'); });
+ *   afterAll(async () => { await release(); });
+ */
+export type Release = () => Promise<void>;
+
+export async function lockShared(key: string): Promise<Release> {
+  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
+  await client.connect();
+  // hashtext gives a stable int4 for the key; the bigint overload accepts it.
+  await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [key]);
+  let released = false;
+  return async () => {
+    if (released) return;
+    released = true;
+    await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [key]).catch(() => {});
+    await client.end().catch(() => {});
+  };
+}
+
+/** The one key both upload-limit specs contend for. */
+export const UPLOAD_LIMIT_LOCK = 'test:platform-setting:uploadMaxMb';
diff --git a/apps/web/tests/security/p2-regressions.spec.ts b/apps/web/tests/security/p2-regressions.spec.ts
index 70e9641..220e4a4 100644
--- a/apps/web/tests/security/p2-regressions.spec.ts
+++ b/apps/web/tests/security/p2-regressions.spec.ts
@@ -4,6 +4,7 @@ import { randomBytes } from 'node:crypto';
 import { prisma } from '@/lib/db';
 import { env } from '@/lib/env';
 import { getUploadMaxMb } from '@/lib/platform-settings';
+import { lockShared, UPLOAD_LIMIT_LOCK, type Release } from '../helpers/serialize';
 import { consume, limits } from '@/lib/security/ratelimit';
 import { redis } from '@/lib/redis';
 import { MethodNotAllowed, MethodNotAllowedError } from '@/lib/errors';
@@ -84,12 +85,19 @@ describe('P2-4: an oversized upload is refused before it is read', () => {
    * refusal that correctly said `10 MB`. Reading the effective value here asks
    * the same question the route does.
    *
-   * ponytail: the residual window — the row changing between this read and the
-   * route's — is microseconds rather than the length of another spec file, but
-   * it is not zero. The real fix is for a globally mutable operator setting not
-   * to be shared by spec files running in parallel; that is a suite change, not
-   * a release one.
+   * Reading the effective value narrows the window; it does not close it.
+   * The advisory lock does: while this block holds it, the other file cannot
+   * be between its write and its cleanup, so the value read here is the value
+   * the route reads. Both files take the same lock, in `tests/helpers/serialize.ts`.
    */
+  let releaseUploadLimit: Release;
+  beforeAll(async () => {
+    releaseUploadLimit = await lockShared(UPLOAD_LIMIT_LOCK);
+  });
+  afterAll(async () => {
+    await releaseUploadLimit();
+  });
+
   it('rejects on Content-Length before parsing the body', async () => {
     const uploadMaxMb = await getUploadMaxMb();
     const maxBytes = uploadMaxMb * 1024 * 1024;
diff --git a/apps/web/tests/security/platform-admin-crud.spec.ts b/apps/web/tests/security/platform-admin-crud.spec.ts
index 3a1d9a0..794bfe9 100644
--- a/apps/web/tests/security/platform-admin-crud.spec.ts
+++ b/apps/web/tests/security/platform-admin-crud.spec.ts
@@ -15,6 +15,7 @@ import { prisma } from '@/lib/db';
 import { getUploadMaxMb } from '@/lib/platform-settings';
 import { createPlatformSessionToken } from '../helpers/session';
 import { patch, del } from '../helpers/request';
+import { lockShared, UPLOAD_LIMIT_LOCK, type Release } from '../helpers/serialize';
 import { DELETE as deleteWorkspace } from '@/app/api/v1/platform/workspaces/[workspaceId]/route';
 import {
   PATCH as patchSubscription,
@@ -33,7 +34,15 @@ let tenantId = '';
 let subscriptionId = '';
 let hrmsPlanCode = '';

+/**
+ * This file writes `PlatformSetting.uploadMaxMb`, which is global. Held for the
+ * whole file so `p2-regressions.spec.ts`, which reads the effective limit,
+ * cannot observe a value this file is in the middle of changing.
+ */
+let releaseUploadLimit: Release;
+
 beforeAll(async () => {
+  releaseUploadLimit = await lockShared(UPLOAD_LIMIT_LOCK);
   const owner = await prisma.platformUser.create({
     data: {
       email: `crud.owner.${suffix}@platform.test`,
@@ -125,6 +134,9 @@ afterAll(async () => {
   await prisma.subscriptionPlan.deleteMany({ where: { code: { contains: suffix } } }).catch(() => {});
   await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
   await prisma.platformSetting.deleteMany({ where: { key: 'uploadMaxMb' } }).catch(() => {});
+  // Released only after the row is back to its default, so the next reader
+  // never sees this file's value.
+  await releaseUploadLimit();
 });

 describe('authorization boundary', () => {
```

- `platform-admin-crud.spec.ts` holds the lock for the **whole file** and
  releases it only **after** its `afterAll` has deleted the row, so the next
  reader never sees this file's value.
- `p2-regressions.spec.ts` holds it around the P2-4 block, which is the only
  reader.
- Session-scoped: `pg_advisory_unlock` in `afterAll`, and — if a worker dies
  first — released by the server when the connection drops. Nothing is left
  held by a crashed test. Releasing twice is harmless, so cleanup cannot throw
  on top of a real failure.

### 2.2 Can another spec still change the row between the read and the request?

**No, for the two files that exist.** While P2-4 holds the lock the other file
is either not yet past its `beforeAll` (blocked on the same lock) or already
past its `afterAll` (row deleted, lock released). There is no third writer.

A future third file that writes the key without taking the lock would reopen
it. That is the honest residual: the lock is a convention, not a schema
constraint. It is named in the helper so the next writer finds it.

### 2.3 Verification

- **The mechanism, not the outcome:** `tests/unit/serialize.spec.ts` acquires
  the lock and asks Postgres from a **second session** whether
  `pg_try_advisory_lock` succeeds — `false` while held, `true` after release,
  and a second release is a no-op. Passed inside gate 12.
- **The two files together, in parallel, on Windows:** 28/28
  (`upload-limit-serialized.log`).
- **The full parallel suite on Linux — the execution condition that failed
  four times:** gate 12 in §1.3. One run, not re-run until green.
- Assertions unchanged: P2-4 still requires a **413 on a non-multipart body**,
  which only the Content-Length guard can produce, and the message still has
  to name the limit the route used.

---

## 3. Booking evidence — complete map

### 3.1 The acceptance tests, their assertions, and where they run

All in `apps/web/tests/sales/bookings-route.spec.ts`, inside **gate 12**,
against a real PostgreSQL through the real route handlers with a real session.
"Layer" says what the assertion actually touches.

| #            | Test                                                                             | Assertion(s)                                                                                                                                       | Layer                                                           |
| ------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1            | refuses to confirm a booking that names no unit                                  | POST without a unit is 200 (drafts may be vague); CONFIRM is **422** and the body mentions the unit; booking still `DRAFT`                         | Route + policy guard                                            |
| 2            | takes the unit in the same transaction that confirms the booking                 | CONFIRM 200; unit reads `BOOKED` afterwards                                                                                                        | Route → `moveUnitIn` → DB                                       |
| 3            | leaves both the booking and the unit untouched when the move is refused          | Unit seeded `SOLD`; CONFIRM ≥ 400; booking still `DRAFT`; unit still `SOLD`                                                                        | Transition table + transaction rollback                         |
| 4            | refuses to sell a flat out from under another agent's live hold                  | Unit `HELD` by someone else with `heldUntil` in the future; CONFIRM ≥ 400; unit still `HELD`                                                       | Holder guard (extended `HELD → BOOKED`)                         |
| 5            | lets exactly one of two concurrent confirmations win                             | **Two different drafts, one unit**, `Promise.all`; exactly one 200; loser **≥ 400 and < 500**; exactly one `CONFIRMED` booking on the unit         | Row lock `FOR UPDATE` on `UnitInventory`, two connections       |
| 6            | puts the flat back on the market when the sale is cancelled                      | CONFIRM → `BOOKED`; CANCEL 200 → `AVAILABLE`; a new draft on the same unit confirms 200                                                            | Route CANCEL → `moveUnitIn(AVAILABLE)`                          |
| 7            | refuses a second confirmed booking even when the application is bypassed         | Direct `prisma.booking.create(status:'CONFIRMED', same unit)` **rejects** — `23505 Booking_one_confirmed_per_unit`                                 | Database only                                                   |
| 8            | refuses a confirmed booking with no unit even when the application is bypassed   | Direct create with `status:'CONFIRMED'`, no unit **rejects** — `Booking_confirmed_requires_unit`                                                   | Database only                                                   |
| 9 _(added)_  | lets exactly one of two concurrent confirmations of the **same booking** through | Same draft, `Promise.all`; one 200; loser ≥ 400 < 500; booking `CONFIRMED`, unit `BOOKED`                                                          | Unit lock + `lockBooking()` re-read                             |
| 10 _(added)_ | ends in one consistent state when a confirmation races a cancellation            | `Promise.all([CONFIRM, CANCEL])`; **no 500**; at least one 200; `CONFIRMED ⇒ BOOKED`, `CANCELLED ⇒ AVAILABLE`; confirmed count on the unit matches | `lockBooking()` revalidation; rollback of an already-moved unit |

Pre-existing tests in the same file still cover sequential repeat confirmation
("confirms, then refuses to confirm twice", 422), collect-on-draft, and the
commission clawback guard on cancel.

### 3.2 Coverage against the required list

| Required                                                           | Covered by                                                                                                                                                          | Note                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Two different drafts confirming the same unit concurrently         | #5, and §3.4 on the artifact                                                                                                                                        | Real concurrency: two route invocations, two pooled connections, `Promise.all`            |
| Repeated confirmation requests                                     | sequential: "confirms, then refuses to confirm twice"; concurrent: #9                                                                                               |                                                                                           |
| Confirmation racing cancellation                                   | #10                                                                                                                                                                 | Either legal order accepted; only inconsistency or a 500 fails it                         |
| Unitless confirmation refusal                                      | #1, #8, and §3.4 on the artifact                                                                                                                                    | Route (422) and database (CHECK)                                                          |
| Inventory transition failure rolling back booking changes          | #3 (fails before any write) **and #10** (the confirm that loses to a cancel has already moved the unit and must roll it back — asserted by `CANCELLED ⇒ AVAILABLE`) |                                                                                           |
| Consistent lock ordering across paths touching both records        | §3.3 by inspection; exercised by #5, #9, #10                                                                                                                        | Tests cannot prove absence of deadlock; they can show none occurred under the three races |
| Database constraint enforcement and controlled API error responses | #7, #8 (constraints); every race asserts loser `< 500`; negative control shows the 500 you get without the lock                                                     | `booking-negative-control.log`                                                            |

### 3.3 Lock order, every path

| Path                                                         | Locks, in order                                                                                 | Notes                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `PATCH bookings CONFIRM`                                     | `UnitInventory` (`FOR UPDATE`, inside `moveUnitIn`) → `Booking` (`FOR UPDATE`, `lockBooking()`) | Unit first because the first booking read has to be unlocked — it is what names the unit |
| `PATCH bookings CANCEL` of a `CONFIRMED` booking with a unit | `UnitInventory` → `Booking`                                                                     | Same order as CONFIRM                                                                    |
| `PATCH bookings CANCEL` of a `DRAFT`                         | `Booking` only                                                                                  | Touches no unit                                                                          |
| `PATCH bookings COLLECT`                                     | `Booking` only                                                                                  |                                                                                          |
| `PATCH projects/[id]/units/[unitId]` (`moveUnit`)            | `UnitInventory` only                                                                            | Never touches `Booking`                                                                  |
| `releaseExpiredHolds`                                        | `UnitInventory` only (updateMany)                                                               |                                                                                          |
| Fixtures / seed writing `Booking` directly                   | none                                                                                            | Held to the constraints, not the lock — that is what #7 and #8 test                      |

**No path takes `Booking` before `UnitInventory`**, so no two of them can wait
on each other holding half of what the other wants.

### 3.4 What exercised the rebuilt release artifact

Gate 14's browser specs do not include a booking journey because there is no
booking page. So a separate API-level spec runs against the built image over
HTTPS with a real session, `apps/web/tests/e2e/booking-api.spec.ts`, and it is
now part of gate 14:

| Check on the artifact                                                      | Result                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Two drafts on one unit, both `PATCH … CONFIRM` in flight at once over HTTP | exactly one `< 300`; the other `≥ 400 < 500` with a reason; the unit lists as `BOOKED` |
| Draft with no unit → CONFIRM                                               | **422**, body names the unit                                                           |
| Second sale of a `BOOKED` flat → CONFIRM                                   | refused `≥ 400 < 500`; unit unchanged                                                  |
| CANCEL the real sale                                                       | `< 300`; unit lists as `AVAILABLE`                                                     |

Isolated run against `web:f59bf47`: **4/4** (`booking-artifact-api.log`).
Against `web:bbfb8ae`: inside gate 14, §1.3.

What the artifact run **cannot** show: the database-bypass tests (#7, #8) —
those are the constraints, not the application, and they were verified against
the artifact's own database in `booking-constraints.txt` (both present,
`validated=true`).

### 3.5 Migration ordering, locking, and what happens when existing data violates

| Step | Migration                                          | Statement                                                                                                                             | Lock on `Booking`                                                                                                               | If existing data violates                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5    | `20260912020000_booking_unit_exclusivity`          | `ADD CONSTRAINT Booking_confirmed_requires_unit CHECK (…) NOT VALID`                                                                  | `ACCESS EXCLUSIVE`, brief — no scan                                                                                             | Cannot fail on data: `NOT VALID` skips existing rows                                                                                                                                                                                                                                                                                                                                                                                |
| 5    | same file                                          | `CREATE UNIQUE INDEX Booking_one_confirmed_per_unit … WHERE status='CONFIRMED' AND deletedAt IS NULL AND unitInventoryId IS NOT NULL` | `SHARE` for the build — **writes to `Booking` wait**, reads do not. Sized by the count of live confirmed rows, not all bookings | **Fails** on any unit with two live confirmed bookings. Prisma wraps the file in one transaction: the CHECK from the same file is **rolled back with it**, the row in `_prisma_migrations` is left unfinished, and `migrate deploy` refuses to continue until it is resolved (`prisma migrate resolve --rolled-back 20260912020000_booking_unit_exclusivity`). The preflight's `unfinished migration rows` line is where this shows |
| 6    | `20260912020500_booking_unit_exclusivity_validate` | `VALIDATE CONSTRAINT`                                                                                                                 | `SHARE UPDATE EXCLUSIVE` — does **not** block writes                                                                            | **Fails** on any live confirmed booking with no unit. Migration 5 stays applied; migration 6 is unfinished; same resolve step                                                                                                                                                                                                                                                                                                       |

Both predicates match exactly (live + confirmed; deleted rows exempt), so a
cancelled-and-deleted booking neither blocks resale nor trips the policy check.

**What was verified and where.** Both constraints applied and `validated=true`
on `master_suite_val` (`booking-constraints.txt`), which had **1** live
confirmed booking. `rc-booking-audit.mjs` on that database: 0 duplicates,
0 unitless, 1 historical drift row (`booking-audit.log`).

**What that does not establish, said plainly.** A validated constraint on a
database with one confirmed booking says nothing about production's data. The
audit is the only instrument for that, and it has not been run against
production (§5). The failure modes above are what happens if it is skipped.

**Rollback across these migrations is not clean for one action.** The previous
application version never wrote `unitInventoryId` at confirmation, so after
migration 6 it would try to confirm unitless bookings and the **CHECK refuses
the write — a 500 in the old code**. It is confined to `PATCH bookings CONFIRM`;
nothing else in the old version writes rows the new constraints see. This
contradicts the blanket "no schema change prevents restarting the older
application" in runbook §9.1, which was written before these migrations existed
and is corrected there.

---

## 4. Collections — explicitly blocked (D-8 unresolved)

### 4.1 Read-only inventory: who writes what, and what reads it

| Writer                                       | Where                                       | Guard                                                                                      | What it records                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/v1/bookings` `action: 'COLLECT'` | `src/app/api/v1/bookings/route.ts`          | `bookings:EDIT` at the viewer's scope; booking must be `CONFIRMED`; refused if already set | **`Booking.collectedAt` — one timestamp**, defaulting to _now_ if the caller sends none. No amount, currency, reference, evidence, payer or verifier |
| `transitionCommission(to:'COLLECTED')`       | `src/services/money/commissions.ts:250,279` | `commissions:EDIT`; refused unless `booking.collectedAt` is set                            | `Commission.collectedAt` — copies the fact onto the commission                                                                                       |

| Reader               | Where                             | What it does with it                                                                                                                             |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Commission lifecycle | `commissions.ts:250`              | A commission may become `COLLECTED` only if the booking has `collectedAt`. The timestamp is the **sole** gate on money being called collected    |
| Payout run           | `payouts.ts:81,197`               | Gathers `COLLECTED` (and `CLAWED_BACK`) commissions into a payout — so **payouts are ultimately released on the strength of that one timestamp** |
| P&L                  | `leadership/pl.ts:76`             | Does **not** read `collectedAt`. Revenue is every non-cancelled booking by `bookingDate` — including `DRAFT` (the open P&L defect)               |
| Booking list         | `bookings/route.ts` `LIST_SELECT` | Shows the timestamp                                                                                                                              |

**Separation of duties today: none.** The same `bookings:EDIT` that confirms a
sale marks it collected. `payouts.ts:168,174` already implements a
maker-checker refusal for payouts; it is not applied here.

### 4.2 What C1 and C2 demonstrate

`tests/diagnostic/finding-bc-booking.diag.ts`, both **still failing, on
purpose** (`booking-diagnostic-after.log`):

- **C1** — a seller holding only `bookings:VIEW/CREATE/EDIT` confirms their own
  sale and then marks it collected. **Expected 403; the artifact returns 200.**
  It demonstrates that the person who books a sale can also certify the money
  arrived, with no second party.
- **C2** — after COLLECT, the booking row has `collectedAt` set and **no column
  whose name resembles an amount, receipt or payment reference** exists to set.
  It demonstrates a representational gap, not a permission gap: the system
  cannot record how much arrived even if someone wanted to.

> **`collectedAt` must not be read, reported or described as verified money
> received.** It records that a person with `bookings:EDIT` pressed a button at
> a time. Nothing in the system can say how much, from whom, in what currency,
> against what receipt, or whether anyone checked.

### 4.3 The minimum decisions needed — yours, not invented here

| #     | Decision                                                                                                                               | Why it cannot be defaulted                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D-8.1 | **Which role records a receipt?** (the selling agent, a finance role, either)                                                          | Changes the permission map and the route's guard                                                                               |
| D-8.2 | **Which role verifies it, and may the recorder and verifier be the same person?**                                                      | Decides whether the payouts maker-checker pattern is required here; a solo brokerage may need to grant both deliberately       |
| D-8.3 | **What must a receipt carry?** — amount, currency, payment date (distinct from entry date), reference, evidence (document / bank line) | Every one is a schema column that does not exist; "required" versus "optional" is policy                                       |
| D-8.4 | **Are partial receipts, corrections and reversals in scope?**                                                                          | Partial receipts make commission eligibility a proportion rather than a switch; reversals need a paper trail like clawback has |
| D-8.5 | **What does a receipt certify — the buyer paying the developer, or the developer paying the agency?**                                  | Different payers, different schedules; today one flag conflates them (DECISIONS-REQUIRED D-8 q.3)                              |

Until these are answered: **neither a deferral nor an unrestricted release of
collection is approved**, and this checkpoint recommends neither. The workflow
stays as it is, the limitation is stated in the handover guide in those words,
and payouts built on it inherit the caveat.

---

## 5. Operator work that needs production access

### 5.1 Who

A person with: the production database **owner** connection string
(`MIGRATION_DATABASE_URL`), shell access to the deployment host, and the
authority to stop the deployment on a stop condition. This work has none of
those and has not requested them.

### 5.2 Read-only preflight — exact commands

Both scripts run every statement as `SELECT`. They create, change and delete
nothing. They print counts, durations and booking references only — no name,
phone, email or connection string — so the output can go into the ticket.

**Prerequisites**

- Node 22+ on a host that can reach the production database.
- The owner role's connection string in the environment for the duration of
  the command only; never in a file that is committed, and never echoed.
- The deployed version confirmed first: `scripts/release.sh status`.

```bash
# from apps/web, at the release revision
MIGRATION_DATABASE_URL='<owner url, from the secret store>' node scripts/rc-preflight.mjs
MIGRATION_DATABASE_URL='<owner url, from the secret store>' node scripts/rc-booking-audit.mjs
```

**Expected outcomes and stop conditions**

| Script    | Line                                                            | Continue when                     | **Stop** when                                                                                                    |
| --------- | --------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| preflight | `unfinished migration rows`                                     | 0                                 | > 0 — a previous migration is half-applied; `migrate deploy` will refuse                                         |
| preflight | `orphaned leadId references`                                    | any — the migration detaches them | — (note the number; runbook §3.1 verifies it afterwards)                                                         |
| preflight | `cross-workspace references`                                    | 0                                 | > 0 — a tenancy fault the FK cannot express; this release does not repair it                                     |
| preflight | `rules that will start failing`                                 | 0                                 | > 0 — an automation rule writes `nextFollowUpAt`; rewrite it first                                               |
| preflight | `Lead` / `Task` / `FollowUpTask` counts                         | —                                 | used to size the `SHARE`-lock windows in runbook §3                                                              |
| audit     | `Units carrying more than one live confirmed booking`           | none                              | any — a double-sale already in the data; `CREATE UNIQUE INDEX` **will fail**; each pair is the client's decision |
| audit     | `Live confirmed bookings naming no unit`                        | none                              | any — migration 6 **will fail**; each row must be given its unit or returned to `DRAFT`, by the client           |
| audit     | `confirmed sales whose unit still reads available/held/blocked` | any — historical, expected        | — (record the number)                                                                                            |

Exit codes: the audit exits **1** when either stop condition holds, so it can
gate a pipeline.

### 5.3 Evidence still missing — instructions are not execution

| Area                                       | What exists                                                                                                                                                     | What is **not** evidenced                                                                                                                                                         | Who can produce it                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Migration rehearsal on representative data | Rehearsed on the validation DB: 7 manufactured orphans detached, 88→88 rows, FK validated; booking constraints validated on **1** confirmed booking             | The same against a copy of **production** data — table sizes, real orphan and duplicate counts, real lock durations                                                               | Operator, with a production dump into a scratch database |
| Backup restoration                         | A real `pg_dump -Fc` / `pg_restore` of the validation DB: identical counts, FK, 184 RLS tables, 69 migrations (`restore-rehearsal.txt`); transport checks 11/11 | The product's own `backup.sh` / `restore-verify.sh` pipeline under the production compose topology; `FIELD_ENCRYPTION_KEY` recoverability                                         | Operator                                                 |
| Application rollback                       | Compatibility by inspection (runbook §9.1) — **and one known incompatibility, §3.5: the previous version's unitless confirmation is refused by the new CHECK**  | A previous-version image actually run against the migrated schema                                                                                                                 | Operator, staging                                        |
| Database recovery                          | Procedure written (runbook §9.2)                                                                                                                                | Never executed end to end with the application restarted afterwards                                                                                                               | Operator, staging                                        |
| Provider readiness                         | SMTP over STARTTLS proven end to end; production refuses `mock`; antivirus reachable                                                                            | WhatsApp (`meta`, configured without credentials — never sent); the `NODE_EXTRA_CA_CERTS` file present in the **production** container (runbook §6.0, added after it bit gate 14) | Operator                                                 |
| Monitoring                                 | 12 alert rules and 9 queues pass `check-observability`; drift canary scheduled                                                                                  | No Prometheus/Alertmanager has been run; no alert has fired end to end                                                                                                            | Operator                                                 |
| Handover                                   | Guide written; accounts procedure written                                                                                                                       | No client account created; no client user has signed in; first-day checklist never executed                                                                                       | Client administrator + operator                          |
| Deployed version                           | Assumed at or after `main`                                                                                                                                      | `scripts/release.sh status` on the host                                                                                                                                           | Operator                                                 |

---

## 6. Consolidated position

### 6.1 Verified implementation and functionality

- **Booking atomicity — closed.** Unit-then-booking locking, unit moved in the
  confirming transaction, cancel releases it, two database constraints; 10
  acceptance tests in gate 12, 4 API checks on the built artifact in gate 14,
  a negative control that fails 6 of 14 without the lock, diagnostic B1–B4
  flipped to passing.
- **Next-follow-up derivation** (Package 1) — unchanged since `232ec16`; all
  six items remain covered as recorded in `RELEASE-CHECKPOINT-CORRECTED.md` §6.
- **Sixteen gates at one revision**, artifact built from the same commit
  (§1.3).
- **Suite defect fixed** rather than tolerated: the global `PlatformSetting`
  coupling (§2), with the lock's exclusion demonstrated from a second session.
- Two documentation defects fixed that would have hurt an operator: the
  non-existent `/api/health/ready` (a listed stop condition), and the silent
  no-mail failure when `NODE_EXTRA_CA_CERTS` names a missing file.

### 6.2 Remaining engineering work (not blocking this checkpoint's scope)

| Item                                                                                                            | Why it is not done now                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate-limit spec's shared Redis bucket (`p2-regressions` P2-5)                                                   | Same shape as §2, different resource; passes in isolation; needs a per-file bucket key. Suite change                                                                 |
| `Booking.unit` `onDelete: SetNull` with no `deletedAt` on `UnitInventory`                                       | Hard-deleting a unit would null a confirmed booking's unit past both constraints. Changing the referential action also changes project deletion; not a freeze change |
| P&L: `pl.ts:76` counts `DRAFT` as revenue; `:227` no payroll run-status filter; `:236` current-team attribution | Already listed open; not part of this package                                                                                                                        |
| Task PATCH does not call `assertRecordVisible`                                                                  | Authorization change during a freeze; scheduled immediately after handover                                                                                           |
| A booking page, and a browser journey for it                                                                    | Product build, not a fix                                                                                                                                             |

### 6.3 Business decisions requiring your answer

1. **D-8.1–D-8.5** (§4.3) — collections. Nothing ships for collection until
   these are answered; nothing is being deferred without your approval either.
2. Confirmation, in writing, that the limitation as worded in the handover
   guide — a "collected" tick is a button press, not money — is acceptable for
   whatever scope you do approve.

### 6.4 Operator checks requiring access

§5.2 and §5.3. Until the preflight and the booking audit have run against
production, the two stop conditions in §3.5 are unknowns, not passes.

### 6.5 Release recommendation

> **NOT APPROVED for production.** Not because the build is incomplete — every
> gate passes at one revision — but because the conditions that separate a
> tested build from a releasable one have not been met:
>
> 1. The production preflight and booking audit have not run. Two of the new
>    migrations can fail on data nobody has looked at.
> 2. Collections (D-8) is undecided, and neither deferring it nor shipping it
>    as-is has been approved.
> 3. Backup restore, application rollback and monitoring have been rehearsed or
>    inspected in isolation, not executed on the production topology — and
>    §3.5 records one real rollback incompatibility.
>
> The 09:00 go/no-go cannot be a GO on evidence this side of production access
> can produce. If the operator runs §5.2 before 09:00 and both stop conditions
> are clear, and you answer §6.3, the remaining items in §5.3 are hours of
> operator work, not days. If not, the honest answer at 09:00 is **NO-GO for
> lack of evidence** — which is a different statement from "the software is
> not ready", and should be reported as such.

Functionality testing was not reduced to protect the deadline: the suite grew
by ten booking tests, one lock test and one artifact spec, and every gate was
re-run at the final revision.

---

## 7. Blocker register — 12 September, after the checkpoint review

### 7.1 Collections: how `collectedAt` reaches a payout

| Step                                             | Code                                                                      | Guard                                                              | What it proves about money                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 1. `PATCH /api/v1/bookings` `COLLECT`            | `bookings/route.ts` COLLECT branch                                        | `bookings:EDIT`; booking `CONFIRMED`; not already set              | Nothing — sets `Booking.collectedAt` to the supplied date or _now_                      |
| 2. `PATCH /api/v1/commissions` `to: 'COLLECTED'` | `commissions/route.ts:110` → `transitionCommission`, `commissions.ts:250` | `commissions:EDIT`; `booking.collectedAt` must be set              | Nothing — step 1 is the sole precondition                                               |
| 3. `buildPayout`                                 | `payouts.ts:81`                                                           | gathers `COLLECTED` (and `CLAWED_BACK`) commissions for the period | Payout total is built from commissions whose only "collected" evidence is step 1        |
| 4. `transitionPayout` → `APPROVED`               | `payouts.ts` maker-checker                                                | `payouts:APPROVE`; **not** the run's creator                       | The one real two-person control — on releasing the payout, not on whether money arrived |
| 5. `transitionPayout` → `PAID`                   | `payouts.ts`                                                              | `payouts:APPROVE`; must be approved                                | Commissions become `PAID`                                                               |

Writers of `collectedAt`: **the COLLECT branch only** (seed, workers, automation and scripts write none — `grep -rn collectedAt prisma/seed scripts src/workers src/services/automation` is empty). Automation's `update_field` cannot reach `Booking` at all (`AutomationObjectType` is LEAD/OPPORTUNITY/ACCOUNT/CONTACT).

### 7.2 D-8 — the five decisions, with recommendations (NOT APPROVED until the owner says so)

| #     | Question                                  | Recommended answer, and why                                                                                                                                                                    | Impact if adopted                                                                                                                                                                           | What remains after the answer                                                            |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D-8.1 | Which role records a receipt?             | A **finance role** (`finance_admin`), not the selling agent — the agent has a direct interest in the sale reading "collected"                                                                  | New permission `collections:CREATE`; COLLECT moves off `bookings:EDIT`                                                                                                                      | Route guard + role catalogue entry + C1 flipped to passing                               |
| D-8.2 | Who verifies, and may it be the recorder? | **A second person** verifies; recorder ≠ verifier, enforced exactly as `payouts.ts` does for approval. A solo brokerage grants both to two named accounts deliberately                         | New `collections:APPROVE`; `Receipt.verifiedById` ≠ `recordedById`                                                                                                                          | Maker-checker guard + a test mirroring the payouts one                                   |
| D-8.3 | What must a receipt carry?                | **Required:** amount, currency (default: the booking's), payment date, reference. **Optional:** evidence document. Commission is computed from an amount; a timestamp cannot pro-rate anything | New `Receipt` model (`bookingId, amount, currency, paidAt, reference, documentId?, recordedById, verifiedById, verifiedAt`); `Booking.collectedAt` becomes derived = first verified receipt | Migration, model, route, C2 flipped to passing                                           |
| D-8.4 | Partial receipts, corrections, reversals? | **Yes to all three**, append-only: partials sum; a correction is a reversal plus a new receipt with a reason — the clawback pattern already in `commissions.ts`                                | Commission `COLLECTED` eligibility becomes **proportional** to verified receipts ÷ agency fee (or a 100 % switch — that sub-choice is the owner's)                                          | Eligibility rule in `transitionCommission`; tests for partial, reversal, over-collection |
| D-8.5 | What does a receipt certify?              | **The agency receiving its fee** — that is what commission is paid from. Buyer→developer payments are a different ledger and out of scope                                                      | No `payer` field; the model is agency-side only                                                                                                                                             | Handover guide wording; no code                                                          |

Effort **after** all five are answered: about 1.5 engineering days (model, migration, two routes, guards, 10–12 tests) plus one gate cycle. Not started, by instruction.

### 7.3 Recovery across migration 6 — resolved position

| Question                                                       | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which previous version is compatible with the migrated schema? | **`main` (`f16ed67`) and every commit up to `2272065`, for everything except one action.** On `main` the only writer of `Booking.status = 'CONFIRMED'` is `bookings/route.ts:172`, which neither requires nor sets a unit. Nothing else on `main` writes rows the two new constraints see.                                                                                                                                                                                                                                                                                                                                                   |
| What fails if the old version is restored?                     | `PATCH bookings CONFIRM` on a draft **without a unit** → refused by `Booking_confirmed_requires_unit` → **500** in the old code. A second confirmation of an already-sold unit → refused by `Booking_one_confirmed_per_unit` → **500** instead of a double-sale. Every other workflow (CRM, HRMS, follow-ups, commissions, payouts) is unaffected.                                                                                                                                                                                                                                                                                           |
| Safe response                                                  | **Roll-forward, not rollback.** The failure is confined to one branch of one route, so the reaction to a fault in `bbfb8ae` is a fix on top of it, re-gated and redeployed — not restoring `main`. If `main` _must_ run against the migrated schema, the exposure is exactly the two 500s above; the operator should know that is the price rather than drop the CHECK. **Database recovery is never the answer to an application fault.**                                                                                                                                                                                                   |
| How are writes after deployment preserved or reconciled?       | Roll-forward preserves them. If a restore to a pre-deployment backup is ever chosen (data corruption only), `scripts/rc-post-deploy-delta.mjs <deployment instant>` — read-only, counts only, no PII — lists what such a restore would lose, per table and per workspace, with the money state (confirmed bookings, collections, commissions, payouts) separated out because it cannot be re-entered from memory. It is run **before** the decision; its output is the reconciliation list, and the retained audit log is the replay source for row-level re-entry. Smoke-tested on the validation database (`post-deploy-delta-smoke.log`). |
| Isolated rehearsal vs production readiness                     | Rehearsed: dump/restore of the validation DB with counts, FK, RLS and migrations intact; constraints validated. **Not evidenced:** the product's `backup.sh` → `backup-ship.sh` → `restore-verify.sh` chain on the production topology, and `FIELD_ENCRYPTION_KEY` recoverability. Proving that needs **no destructive restore into production**: `restore-verify.sh` restores into a scratch database by design. It needs the operator and a production backup, nothing else.                                                                                                                                                               |

### 7.4 Release scope

| Workflow                                                                                                                                               | In this release?                                                    | Executed acceptance evidence                                                                                      | Remaining blocker                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Sales CRM — capture, import, assignment, triage queue, follow-ups, next-action derivation, activity, opportunities, manager queues, scope, mobile, PWA | **Yes**                                                             | Gate 12 services; gate 14 browser journeys on the artifact                                                        | Operator preflight (§5.2)                                             |
| HRMS — self-service, attendance, leave, overtime, payroll, roster/performance/recruitment/reports, privacy boundary                                    | **Yes**                                                             | 307 service tests; browser journey hire → payroll on the artifact                                                 | Operator preflight; partial-day leave (documented limitation)         |
| Booking: draft, **confirm with unit**, cancel                                                                                                          | **Yes**                                                             | 10 acceptance tests (gate 12); 4 API checks on the artifact (gate 14); negative control; DB constraints validated | Booking audit against production (§5.2); no booking page (documented) |
| Commissions: accrue, confirm, clawback; payouts maker-checker                                                                                          | **Yes**                                                             | Service tests in gate 12                                                                                          | Inherits the collections caveat                                       |
| **Agency fee collection**                                                                                                                              | **AWAITING OWNER DECISION** — neither deferral nor release approved | C1, C2 failing by design                                                                                          | D-8.1–D-8.5                                                           |
| P&L                                                                                                                                                    | Yes, **with stated defects** (`pl.ts:76/:227/:236`)                 | Revenue grouping tests                                                                                            | Fix scheduled post-handover; owner to accept the stated limitation    |
| Packages 2–10 (roadmap)                                                                                                                                | **No — not started, by instruction**                                | —                                                                                                                 | Owner review before Package 2                                         |
| Task PATCH visibility; `UnitInventory` hard-delete vs confirmed booking; rate-limit spec bucket                                                        | **No** (known, post-handover)                                       | —                                                                                                                 | Scheduled                                                             |

### 7.5 Blocker-based assessment

| Blocker                                       | Owner                   | Depends on                                    | Completion evidence                                                    | Engineering                           | Operator | External wait  |
| --------------------------------------------- | ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | -------- | -------------- |
| Production preflight + booking audit not run  | Production operator     | Owner DB URL in the secret store; host access | Both outputs in the ticket, no stop condition fired                    | 0                                     | 30 min   | Access grant   |
| D-8 collections decisions                     | Client owner            | —                                             | Written answers to D-8.1–D-8.5                                         | 0 now; ~1.5 days + 1 gate cycle after | 0        | Owner          |
| Collections scope acceptance (defer vs build) | Client owner            | D-8                                           | Written approval of one path                                           | 0                                     | 0        | Owner          |
| Backup pipeline on production topology        | Operator                | Production backup, `.env.production`          | `restore-verify.sh` exit 0 into a scratch DB; key recoverability shown | 0                                     | 1–2 h    | —              |
| Roll-forward path rehearsed                   | Operator + this work    | Staging                                       | A hotfix commit deployed over `bbfb8ae` on staging with `release.sh`   | 0.5 day                               | 1 h      | Staging access |
| Monitoring end to end                         | Operator                | Prometheus/Alertmanager                       | One alert fired and received                                           | 0                                     | 2 h      | —              |
| Client accounts + first-day checklist         | Client admin + operator | Approved scope                                | Every user signed in with own password; checklist executed             | 0                                     | 2 h      | Client         |
| Deployed version confirmed                    | Operator                | Host access                                   | `release.sh status` output                                             | 0                                     | 5 min    | Access         |
