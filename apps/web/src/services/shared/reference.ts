import type { Prisma } from '@prisma/client';

/**
 * Human-readable per-tenant record references: LD-000142, OP-000019, TK-000007.
 * Allocated from a Postgres sequence per tenant per object so concurrent creates
 * cannot collide, and the number never rewinds after a delete.
 */
const PREFIX: Record<string, string> = {
  LEAD: 'LD',
  OPPORTUNITY: 'OP',
  ACCOUNT: 'AC',
  CONTACT: 'CT',
  TICKET: 'TK',
  PRODUCT: 'PR',
  CAMPAIGN: 'CP',
};

/** Tables the sequence has to be seeded from. Only those carrying `reference`. */
const TABLE: Record<string, string> = {
  LEAD: 'Lead',
  OPPORTUNITY: 'Opportunity',
  ACCOUNT: 'Account',
  CONTACT: 'Contact',
};

/**
 * Only the two raw escapes this function actually uses.
 *
 * Naming `Prisma.TransactionClient` here forced every caller to hold the
 * unextended client type, which the extended client's transaction does not
 * satisfy. The structural minimum accepts both and states the real dependency.
 */
type RawCapable = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export async function nextReference(tx: RawCapable, tenantId: string, objectType: string): Promise<string> {
  const prefix = PREFIX[objectType] ?? 'RC';
  const seq = `ref_${objectType.toLowerCase()}_${tenantId.replace(/[^a-z0-9]/gi, '')}`;
  const table = TABLE[objectType];

  const [{ exists }] = await tx.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS(SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = $1) AS exists`,
    seq,
  );

  if (!exists) {
    // The sequence is created lazily, but records can already exist — seeded data,
    // an import, a restored backup. Starting at 1 in that case hands out a
    // reference that is already taken, the insert trips the (tenantId, reference)
    // unique index, and the whole transaction rolls back — including the CREATE
    // SEQUENCE, so the next attempt starts at 1 and fails identically. That made
    // every create for the tenant fail permanently once any row pre-existed.
    //
    // ponytail: this MAX runs once per tenant per object, on the create that first
    // needs the sequence. If a tenant ever has enough rows for that single scan to
    // hurt, seed the sequences in the migration instead.
    let start = 1;
    if (table) {
      const rows = await tx.$queryRawUnsafe<{ max: number }[]>(
        `SELECT COALESCE(MAX(SUBSTRING(reference FROM '[0-9]+$')::bigint), 0)::int AS max
           FROM "${table}"
          WHERE "tenantId" = $1 AND reference LIKE $2`,
        tenantId,
        `${prefix}-%`,
      );
      start = (rows[0]?.max ?? 0) + 1;
    }
    await tx.$executeRawUnsafe(`CREATE SEQUENCE "${seq}" START ${start}`);
  }

  const rows = await tx.$queryRawUnsafe<{ nextval: bigint }[]>(`SELECT nextval('"${seq}"')`);
  const n = Number(rows[0]!.nextval);

  return `${prefix}-${String(n).padStart(6, '0')}`;
}
