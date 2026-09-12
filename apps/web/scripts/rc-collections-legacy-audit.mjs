/**
 * Read-only: money the ledger calls collected on the strength of a timestamp.
 *
 *   MIGRATION_DATABASE_URL=<owner url> node scripts/rc-collections-legacy-audit.mjs
 *
 * Before 20260912100000 the only evidence that a client had paid was
 * `Booking.collectedAt`, set by anyone with bookings:EDIT. Commissions reached
 * COLLECTED on it, and payouts were built from those commissions. None of that
 * is evidence of an amount, and none of it is promoted into a receipt now —
 * D-8.3 forbids exactly that. So every such row is listed here, for finance to
 * decide what it is: a real receipt to be recorded properly, or a status to be
 * withdrawn.
 *
 * Nothing is changed. Nothing is "grandfathered": a legacy-collected commission
 * stays COLLECTED in the database (this script does not regress it) but the
 * payout gates now refuse to approve or pay it until verified receipts cover
 * the fee — which is what the last section counts.
 *
 * Prints references and identifiers only. No client name, phone or email.
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL (or DATABASE_URL) to the database to inspect.');
  process.exit(2);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const rows = async (sql) => (await c.query(sql)).rows;
const head = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

const who = (await rows('SELECT current_database() AS db, current_user AS role'))[0];
console.log(`Collections legacy audit — database "${who.db}" as "${who.role}". Read-only.`);

head('1. Bookings with a legacy collectedAt and no verified receipt');
const legacy = await rows(`
  SELECT b."reference", b."id", b."tenantId", b."currency",
         b."agencyFee", b."collectedAt"::date AS marked,
         (SELECT count(*) FROM "AgencyFeeReceipt" r WHERE r."bookingId" = b."id" AND r."status" = 'VERIFIED') AS verified_receipts
  FROM "Booking" b
  WHERE b."collectedAt" IS NOT NULL AND b."deletedAt" IS NULL
  ORDER BY b."collectedAt"`);
const unbacked = legacy.filter((r) => Number(r.verified_receipts) === 0);
console.log(`  ${legacy.length} booking(s) carry collectedAt; ${unbacked.length} have no verified receipt.`);
for (const b of unbacked) {
  console.log(`    ${b.reference}  id=${b.id}  fee=${b.agencyFee ?? 'UNSET'} ${b.currency}  marked=${b.marked}`);
}

head('2. Commissions COLLECTED or PAID whose booking has no covering verified receipts');
const commissions = await rows(`
  WITH cov AS (
    SELECT r."bookingId",
           COALESCE(SUM(CASE WHEN r."kind" = 'RECEIPT' THEN r."amount" ELSE -r."amount" END)
                    FILTER (WHERE r."status" = 'VERIFIED'), 0) AS verified
    FROM "AgencyFeeReceipt" r GROUP BY r."bookingId")
  SELECT cm."id", cm."status"::text AS status, cm."amount", cm."currency", cm."payoutId",
         b."reference" AS booking, b."agencyFee", COALESCE(cov.verified, 0) AS verified
  FROM "Commission" cm
  JOIN "Booking" b ON b."id" = cm."bookingId"
  LEFT JOIN cov ON cov."bookingId" = b."id"
  WHERE cm."status" IN ('COLLECTED', 'PAID') AND cm."reversesId" IS NULL
    AND (b."agencyFee" IS NULL OR b."agencyFee" <= 0 OR COALESCE(cov.verified, 0) < b."agencyFee")
  ORDER BY cm."status", b."reference"`);
console.log(`  ${commissions.length} commission(s). These are what the payout gates will now refuse.`);
for (const r of commissions) {
  const why =
    r.agencyFee == null || Number(r.agencyFee) <= 0
      ? 'agency fee UNSET'
      : `verified ${r.verified} < fee ${r.agencyFee}`;
  console.log(
    `    ${r.status.padEnd(9)} commission=${r.id}  booking=${r.booking}  ${r.amount} ${r.currency}  payout=${r.payoutId ?? '—'}  (${why})`,
  );
}

head('3. Unpaid payouts that contain such commissions');
const payouts = await rows(`
  WITH cov AS (
    SELECT r."bookingId",
           COALESCE(SUM(CASE WHEN r."kind" = 'RECEIPT' THEN r."amount" ELSE -r."amount" END)
                    FILTER (WHERE r."status" = 'VERIFIED'), 0) AS verified
    FROM "AgencyFeeReceipt" r GROUP BY r."bookingId")
  SELECT DISTINCT p."reference", p."id", p."status"::text AS status, p."totalAmount", p."currency"
  FROM "Payout" p
  JOIN "Commission" cm ON cm."payoutId" = p."id" AND cm."reversesId" IS NULL
  JOIN "Booking" b ON b."id" = cm."bookingId"
  LEFT JOIN cov ON cov."bookingId" = b."id"
  WHERE p."status" IN ('DRAFT', 'APPROVED')
    AND (b."agencyFee" IS NULL OR b."agencyFee" <= 0 OR COALESCE(cov.verified, 0) < b."agencyFee")
  ORDER BY p."reference"`);
console.log(`  ${payouts.length} payout(s) blocked from approval/payment until receipts are recorded and verified.`);
for (const p of payouts) console.log(`    ${p.reference}  id=${p.id}  ${p.status}  ${p.totalAmount} ${p.currency}`);

head('4. Confirmed bookings with no agreed agency fee');
const nofee = await rows(`
  SELECT "reference", "id", "currency" FROM "Booking"
  WHERE "status" = 'CONFIRMED' AND "deletedAt" IS NULL AND ("agencyFee" IS NULL OR "agencyFee" <= 0)
  ORDER BY "reference"`);
console.log(`  ${nofee.length} booking(s). Nothing can be measured against them until finance records the fee due.`);
for (const b of nofee) console.log(`    ${b.reference}  id=${b.id}  ${b.currency}`);

head(
  unbacked.length + commissions.length + payouts.length + nofee.length === 0
    ? 'RESULT: nothing legacy to review'
    : 'RESULT: rows above need a finance decision each — none was changed',
);
await c.end();
