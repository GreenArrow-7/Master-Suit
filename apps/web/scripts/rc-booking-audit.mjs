/**
 * Read-only audit for the booking/unit constraints, run **before** the
 * migration that validates them.
 *
 *   node scripts/rc-booking-audit.mjs
 *
 * Two constraints arrive together in
 * `20260912020000_booking_unit_exclusivity`, and each can be blocked by data
 * that predates them:
 *
 *   1. `Booking_one_confirmed_per_unit` — a unique index. If any unit already
 *      carries two live confirmed bookings, CREATE INDEX fails and the deploy
 *      stops. That is the double-sale itself, already in the data.
 *   2. `Booking_confirmed_requires_unit` — added NOT VALID, so the first
 *      migration cannot fail on old rows. The separate validate migration
 *      that follows it WILL fail if any live confirmed booking names no unit.
 *
 * This script reports both and changes nothing. It deliberately does not
 * repair: which flat a unitless confirmed sale belongs to, and whether a
 * duplicate pair is a genuine double-sale or a mistyped reference, are
 * questions for whoever owns the data. It prints references and identifiers so
 * the rows can be found — no client name, phone number or email, so the output
 * can be pasted into a ticket.
 *
 * Needs a role that can SELECT across tenants — the owning/migration role, the
 * same one `prisma migrate deploy` uses. It does not need write access.
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL (or DATABASE_URL) to the database to inspect.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const head = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);
const rows = async (sql) => (await c.query(sql)).rows;

const who = (await rows('SELECT current_database() AS db, current_user AS role'))[0];
console.log(`Booking/unit audit — database "${who.db}" as "${who.role}"`);
console.log(`Read-only. Nothing is created, changed or deleted.`);

head('Totals');
const totals = (
  await rows(`
  SELECT
    count(*) FILTER (WHERE "deletedAt" IS NULL)                             AS live,
    count(*) FILTER (WHERE "deletedAt" IS NULL AND "status" = 'CONFIRMED')  AS confirmed,
    count(*) FILTER (WHERE "deletedAt" IS NULL AND "status" = 'CONFIRMED'
                       AND "unitInventoryId" IS NOT NULL)                   AS confirmed_with_unit
  FROM "Booking"`)
)[0];
console.log(`  live bookings                ${String(totals.live).padStart(8)}`);
console.log(`  live confirmed               ${String(totals.confirmed).padStart(8)}`);
console.log(`  live confirmed with a unit   ${String(totals.confirmed_with_unit).padStart(8)}`);

head('1. Units carrying more than one live confirmed booking');
const dupes = await rows(`
  SELECT "unitInventoryId" AS unit, count(*) AS n,
         string_agg("reference", ', ' ORDER BY "reference") AS refs
  FROM "Booking"
  WHERE "status" = 'CONFIRMED' AND "deletedAt" IS NULL AND "unitInventoryId" IS NOT NULL
  GROUP BY 1 HAVING count(*) > 1
  ORDER BY 2 DESC`);
if (dupes.length === 0) {
  console.log('  none — the unique index will build.');
} else {
  console.log(`  ${dupes.length} unit(s). CREATE UNIQUE INDEX WILL FAIL until these are resolved:`);
  for (const d of dupes) console.log(`    unit ${d.unit}  ${d.n} bookings: ${d.refs}`);
}

head('2. Live confirmed bookings naming no unit');
const unitless = await rows(`
  SELECT "id", "reference", "tenantId", "projectId", "bookingDate"::date AS booked
  FROM "Booking"
  WHERE "status" = 'CONFIRMED' AND "deletedAt" IS NULL AND "unitInventoryId" IS NULL
  ORDER BY "bookingDate"
  LIMIT 200`);
if (unitless.length === 0) {
  console.log('  none — VALIDATE CONSTRAINT will pass.');
} else {
  console.log(`  ${unitless.length} booking(s) (first 200). VALIDATE CONSTRAINT WILL FAIL until each one`);
  console.log('  is either given its unit or moved back to DRAFT. Both are business decisions.');
  for (const b of unitless) console.log(`    ${b.reference}  id=${b.id}  project=${b.projectId ?? '—'}  ${b.booked}`);
}

head('3. Inventory that disagrees with the ledger');
// Not a blocker for either constraint — a report, because the two were free to
// drift before confirmation touched inventory at all, and the release notes
// should say how far.
const drift = await rows(`
  SELECT count(*) FILTER (WHERE u."status" NOT IN ('BOOKED', 'SOLD')) AS confirmed_not_taken,
         count(*) AS confirmed_with_unit
  FROM "Booking" b JOIN "UnitInventory" u ON u."id" = b."unitInventoryId"
  WHERE b."status" = 'CONFIRMED' AND b."deletedAt" IS NULL`);
console.log(`  confirmed sales whose unit still reads available/held/blocked: ${drift[0].confirmed_not_taken}`);
console.log('  (Historical only. Confirmation now moves the unit in the same transaction.)');

const blocked = dupes.length > 0 || unitless.length > 0;
head(blocked ? 'RESULT: resolve the rows above before deploying' : 'RESULT: clear to deploy');
await c.end();
process.exit(blocked ? 1 : 0);
