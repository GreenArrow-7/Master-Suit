import type { Prisma } from '@prisma/client';

/**
 * Human-readable per-tenant record references: LD-000142, OP-000019, TK-000007.
 *
 * Allocated from a `TenantReferenceCounter` row per tenant per object type, so
 * concurrent creates cannot collide and the number never rewinds after a delete.
 *
 * ── This used to be one Postgres sequence per tenant per object type ────────
 *
 * `CREATE SEQUENCE "ref_lead_<tenantid>"`, created lazily on first use. Ten
 * object types, so ten thousand tenants meant up to a hundred thousand relations
 * in `pg_class` — a file each, a slower `pg_dump` and autovacuum pass for every
 * one — and it required `GRANT CREATE ON SCHEMA public` on the runtime role,
 * permanently, for this one feature. That grant is revoked by
 * 20260820140000_reference_counter_table; this is the only code in `src/` that
 * ever issued DDL.
 *
 * It also had a concurrency fault at exactly the wrong moment. Creation was
 * check-then-create across two statements, so two concurrent first-creates for
 * one tenant both saw the sequence absent, both issued `CREATE SEQUENCE`, and
 * the loser failed its whole transaction with "relation already exists" — rare,
 * being one instant per tenant per object type, but that instant is a new
 * customer's first record.
 *
 * ── What the counter costs, honestly ────────────────────────────────────────
 *
 * A sequence hands out numbers outside transaction control, so it never blocks;
 * a row does. Concurrent creates of the same object type within one tenant now
 * serialise on that row until the transaction commits. The lock is held for the
 * rest of a single create — one INSERT and its audit row — so a tenant needs
 * sustained concurrent creates of one type for it to be measurable, whereas the
 * catalog cost was unconditional and permanent.
 */
const PREFIX: Record<string, string> = {
  LEAD: 'LD',
  OPPORTUNITY: 'OP',
  ACCOUNT: 'AC',
  CONTACT: 'CT',
  TICKET: 'TK',
  PRODUCT: 'PR',
  CAMPAIGN: 'CP',
  LISTING: 'LS',
  BOOKING: 'BK',
  PAYOUT: 'PO',
};

/** Tables the counter has to be seeded from. Only those carrying `reference`. */
const TABLE: Record<string, string> = {
  LEAD: 'Lead',
  OPPORTUNITY: 'Opportunity',
  ACCOUNT: 'Account',
  CONTACT: 'Contact',
  LISTING: 'Listing',
  BOOKING: 'Booking',
};

/**
 * Only the raw escape this function uses.
 *
 * Naming `Prisma.TransactionClient` here forced every caller to hold the
 * unextended client type, which the extended client's transaction does not
 * satisfy. The structural minimum accepts both and states the real dependency.
 */
type RawCapable = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

export async function nextReference(tx: RawCapable, tenantId: string, objectType: string): Promise<string> {
  const prefix = PREFIX[objectType] ?? 'RC';

  // The whole allocation, for every call after the first: one statement, so
  // there is no window between reading the counter and advancing it. The row
  // lock Postgres takes for the UPDATE is what serialises concurrent creates,
  // and it is released at commit.
  const bumped = await tx.$queryRawUnsafe<{ counter: number }[]>(
    `UPDATE "TenantReferenceCounter"
        SET counter = counter + 1, "updatedAt" = now()
      WHERE "tenantId" = $1 AND "objectType" = $2
      RETURNING counter`,
    tenantId,
    objectType,
  );

  const n = bumped[0]?.counter ?? (await seed(tx, tenantId, objectType, prefix));
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/**
 * First allocation for a (tenant, object type) — and only ever that.
 *
 * Records can already exist when this runs: seeded data, an import, a restored
 * backup, or a workspace migrated from the sequences this replaced. Starting at
 * 1 would hand out a reference already taken, the insert would trip the
 * `(tenantId, reference)` unique index, and the whole transaction would roll
 * back — including this row, so the next attempt would start at 1 and fail
 * identically. That made every create for the tenant fail permanently once any
 * row pre-existed, which is why the MAX is here.
 *
 * `ON CONFLICT DO UPDATE` rather than a plain insert, because two concurrent
 * first-creates both reach this point. The second blocks on the conflicting key
 * until the first commits and then increments what it wrote, so they get
 * distinct numbers instead of one of them failing — which is precisely what the
 * old `CREATE SEQUENCE` race did not do.
 */
async function seed(tx: RawCapable, tenantId: string, objectType: string, prefix: string): Promise<number> {
  const table = TABLE[objectType];
  let start = 1;

  if (table) {
    // Once per tenant per object type, on the create that first needs it. The
    // table name comes from the TABLE map above, never from a caller.
    const rows = await tx.$queryRawUnsafe<{ max: number }[]>(
      `SELECT COALESCE(MAX(SUBSTRING(reference FROM '[0-9]+$')::bigint), 0)::int AS max
         FROM "${table}"
        WHERE "tenantId" = $1 AND reference LIKE $2`,
      tenantId,
      `${prefix}-%`,
    );
    start = (rows[0]?.max ?? 0) + 1;
  }

  const rows = await tx.$queryRawUnsafe<{ counter: number }[]>(
    `INSERT INTO "TenantReferenceCounter" ("tenantId", "objectType", counter, "updatedAt")
          VALUES ($1, $2, $3, now())
     ON CONFLICT ("tenantId", "objectType")
     DO UPDATE SET counter = "TenantReferenceCounter".counter + 1, "updatedAt" = now()
       RETURNING counter`,
    tenantId,
    objectType,
    start,
  );

  const counter = rows[0]?.counter;
  if (counter === undefined) {
    // A backstop, not the main line. Called with no tenant context, Postgres
    // raises 42501 on the WITH CHECK before this is reached — verified in
    // tests/tenant/reference.spec.ts. It is here for the shape where the policy
    // admits the statement but it returns no row, because the alternative is
    // `RC-NaN` persisted as a customer's permanent reference.
    throw new Error(
      `Could not allocate a ${objectType} reference for tenant ${tenantId}. ` +
        'Reference allocation must run inside withTx(tenantId), so that app.tenant_id is set.',
    );
  }
  return counter;
}
