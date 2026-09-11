/**
 * Notification recovery, against the registered worker in the release image.
 *
 * The unit suite proves the outbox logic. This proves the *deployed* worker
 * picks it up: a notice committed to `NotificationOutbox` by a process that then
 * died must still reach the person, exactly once, when a worker next runs.
 *
 * So a PENDING row is written directly — which is precisely the state a crash
 * between "decide" and "deliver" leaves behind — and the running worker is given
 * a chance to find it.
 *
 *   node scripts/rc-worker-check.mjs
 *
 * Disposable databases only. It writes one outbox row and one notification, both
 * tagged, and removes them afterwards.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const dbName = (url ?? '').split('/').pop()?.split('?')[0] ?? '';
if (!/_val$|_rc$|_rehearse$|_nfu$|_test$/.test(dbName)) {
  console.error(`refusing to write to "${dbName}": no disposable-database marker in the name`);
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (s, p = []) => (await c.query(s, p)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const tag = `rc-${randomBytes(4).toString('hex')}`;
const eventKey = `rc.recovery:${tag}`;

const target = await one(`
  SELECT u."id", u."tenantId" FROM "User" u
    JOIN "Tenant" t ON t."id" = u."tenantId"
   WHERE u."status" = 'ACTIVE' AND u."deletedAt" IS NULL
   ORDER BY u."createdAt" LIMIT 1`);
if (!target) {
  console.error('no active user in this database — seed it first');
  process.exit(2);
}

console.log(`database ${dbName}\n\n1. A notice the deciding process committed and never delivered`);

await c.query(
  `INSERT INTO "NotificationOutbox"
     ("id","tenantId","eventKey","userId","kind","title","body","priority","status","createdAt","updatedAt")
   VALUES (gen_random_uuid()::text, $1, $2, $3, 'RC_RECOVERY_CHECK',
           'Release check', 'Written as PENDING, as a crash would leave it',
           'MEDIUM'::"Priority", 'PENDING'::"OutboxStatus", now(), now())`,
  [target.tenantId, eventKey, target.id],
);
check(true, 'PENDING outbox row written', eventKey);

// The maintenance sweep runs every five minutes and delivers the outbox at the
// end of its pass, so this waits rather than nudging the queue: the point is
// that the *scheduled* worker recovers it without anyone intervening.
console.log('\n2. Waiting for the registered worker to recover it (up to 6 minutes)');
const deadline = Date.now() + 6 * 60_000;
let row = null;
while (Date.now() < deadline) {
  row = await one(`SELECT "status"::text AS status, "attempts" FROM "NotificationOutbox" WHERE "eventKey" = $1`, [
    eventKey,
  ]);
  if (row?.status === 'DELIVERED') break;
  await sleep(10_000);
  process.stdout.write('.');
}
console.log('');
check(row?.status === 'DELIVERED', 'the worker delivered it without being asked', `status ${row?.status}`);

console.log('\n3. Exactly once');
const notifications = await one(
  `SELECT count(*)::int AS n FROM "Notification"
    WHERE "tenantId" = $1 AND "userId" = $2 AND "kind" = 'RC_RECOVERY_CHECK'`,
  [target.tenantId, target.id],
);
check(notifications.n === 1, 'one in-app notification, not zero and not two', `${notifications.n} row(s)`);

const outboxRows = await one(`SELECT count(*)::int AS n FROM "NotificationOutbox" WHERE "eventKey" = $1`, [eventKey]);
check(outboxRows.n === 1, 'the outbox row was not duplicated', `${outboxRows.n} row(s)`);

console.log('\n4. Nothing else is stuck');
const pending = await one(
  `SELECT count(*)::int AS n FROM "NotificationOutbox" WHERE "status" = 'PENDING' AND "createdAt" < now() - interval '10 minutes'`,
);
check(pending.n === 0, 'no notice older than ten minutes is still pending', `${pending.n} stale`);

const abandoned = await one(`SELECT count(*)::int AS n FROM "NotificationOutbox" WHERE "status" = 'ABANDONED'`);
console.log(`  note  ${abandoned.n} abandoned notice(s) — these are visible rather than retried forever`);

// Clean up what this created.
await c.query(`DELETE FROM "Notification" WHERE "kind" = 'RC_RECOVERY_CHECK'`);
await c.query(`DELETE FROM "NotificationOutbox" WHERE "eventKey" = $1`, [eventKey]);

console.log(`\n${failures === 0 ? 'worker recovery verified' : `${failures} check(s) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
await c.end();
