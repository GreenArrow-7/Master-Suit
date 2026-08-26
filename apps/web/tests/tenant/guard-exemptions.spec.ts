/**
 * The two lists that let a query past the tenant guard must describe reality.
 *
 * ── Why a test, and not just review ─────────────────────────────────────────
 *
 * `src/lib/db.ts` carries two exemptions. `GLOBAL_MODELS` skips the guard for a
 * model outright. `GLOBAL_UNIQUE_FIELDS` skips it for one query shape: a lookup
 * by a value that already pins exactly one row across every workspace, which is
 * how a password-reset link or a webhook URL finds its tenant before any tenant
 * is known.
 *
 * Both are hand-kept lists of *names*, and a name outlives the thing it named.
 * `Session: ['tokenHash']` sat in the second list after the `Session` model was
 * gone — inert, until somebody adds a model called `Session` with a `tenantId`,
 * at which point it silently inherits an exemption nobody chose for it.
 * `PlatformSession: ['tokenHash', 'id']` sat there too, unreachable because
 * `GLOBAL_MODELS` is checked first — inert, until PlatformSession leaves that
 * set. Neither was a live breach; both were a live breach one ordinary refactor
 * away, and neither is the kind of thing review catches, because review reads
 * the diff and these were not in it.
 *
 * So the lists are checked against the schema and the catalog every run:
 *
 *   1 · every name is a real model,
 *   2 · every exempted field is backed by a real single-column unique index,
 *   3 · the two lists are disjoint, so no entry can be dead-by-shadowing,
 *   4 · the models exempt from *both* layers are the ones we chose, and adding
 *       another requires saying so here.
 *
 * (4) is the one worth reading twice. scripts/check-rls.mjs proves row-level
 * security covers every tenant-owned table; this proves the guard covers what
 * RLS does not. A model in `GLOBAL_MODELS` that also carries a `tenantId` and
 * has no forced RLS is protected by application code alone — no guard, no
 * policy. Three do, deliberately, because each is read to *decide* the tenant
 * and a policy on them would match nothing. A fourth appearing by accident is
 * the failure this file exists to make loud.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GLOBAL_MODELS, GLOBAL_UNIQUE_FIELDS } from '@/lib/db';

const url = process.env.RLS_DATABASE_URL;
if (!url) {
  throw new Error(
    'RLS_DATABASE_URL is not set, so the guard exemptions cannot be checked against the catalog.\n' +
      '  See apps/web/.env.test — this suite reads pg_index, nothing tenant-scoped.',
  );
}

let db: Client;

/** Model names from the schema. No model carries `@@map`, so a model *is* a table. */
const schemaModels = new Set(
  [
    ...readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8').matchAll(/^model\s+(\w+)\s*\{/gm),
  ].map((m) => m[1]!),
);

/** `Table.column` for every single-column unique or primary index that is not partial. */
const uniqueColumns = new Set<string>();
/** Tables with a `tenantId` column and no FORCEd row-level security. */
const unprotectedByRls = new Set<string>();

beforeAll(async () => {
  db = new Client({ connectionString: url });
  await db.connect();

  // `indnkeyatts = 1` excludes composite uniques: `@@unique([tenantId, key])` does
  // not make `key` alone pin a row, and a guard exemption on it would be a hole.
  // `indpred IS NULL` excludes partial ones for the same reason — `UNIQUE … WHERE
  // "deletedAt" IS NULL` permits duplicates among the soft-deleted rows.
  const indexes = await db.query<{ tbl: string; col: string }>(`
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'public'
      AND (i.indisunique OR i.indisprimary)
      AND i.indnkeyatts = 1
      AND i.indpred IS NULL
      AND i.indisvalid
  `);
  for (const row of indexes.rows) uniqueColumns.add(`${row.tbl}.${row.col}`);

  const exposed = await db.query<{ tbl: string }>(`
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname AND col.table_name = c.relname AND col.column_name = 'tenantId'
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relforcerowsecurity
  `);
  for (const row of exposed.rows) unprotectedByRls.add(row.tbl);
});

afterAll(async () => {
  await db?.end();
});

describe('GLOBAL_UNIQUE_FIELDS', () => {
  it('names only models that exist', () => {
    const dead = Object.keys(GLOBAL_UNIQUE_FIELDS).filter((model) => !schemaModels.has(model));
    // A dead key is not a tidiness problem. It is an exemption waiting for a
    // model to be given that name, and it will be granted without review.
    expect(dead).toEqual([]);
  });

  it('exempts only fields a single-column unique index actually pins', () => {
    const unbacked = Object.entries(GLOBAL_UNIQUE_FIELDS).flatMap(([model, fields]) =>
      fields.filter((field) => !uniqueColumns.has(`${model}.${field}`)).map((field) => `${model}.${field}`),
    );
    // The exemption's entire premise is that the value identifies one row across
    // all workspaces. Without the index, a lookup by it can return another
    // tenant's row, and the guard has been told not to look.
    expect(unbacked).toEqual([]);
  });

  it('lists nothing that GLOBAL_MODELS already exempts', () => {
    // The guard returns on the GLOBAL_MODELS check before it reads this map, so
    // an entry in both decides nothing today and everything the day the model
    // leaves GLOBAL_MODELS.
    const shadowed = Object.keys(GLOBAL_UNIQUE_FIELDS).filter((model) => GLOBAL_MODELS.has(model));
    expect(shadowed).toEqual([]);
  });
});

describe('GLOBAL_MODELS', () => {
  it('names only models that exist', () => {
    expect([...GLOBAL_MODELS].filter((model) => !schemaModels.has(model))).toEqual([]);
  });

  /**
   * The models with no automatic protection at all, and why each one is here.
   *
   * Every one of these is read in order to *establish* who the actor is and
   * which workspace they may act in. A row-level-security policy filters on
   * `app.tenant_id`, and at the moment these are read there is no tenant to
   * set — the read is what determines it. So the isolation is carried by the
   * call sites, which is a weaker guarantee, taken knowingly and only here.
   *
   * Adding a name to this list means writing down which call sites carry it.
   */
  const APPLICATION_ENFORCED_ONLY: Record<string, string> = {
    WorkspaceMembership:
      'Resolved before a tenant exists — it is the lookup that says which workspaces the ' +
      'signed-in identity has. lib/auth/session.ts filters every read by platformUserId, and ' +
      'switchActiveWorkspace requires an ACTIVE membership for the target workspace.',
    PlatformAccessGrant:
      'The support-access check itself: lib/auth/support-actor.ts asks whether this platform ' +
      'owner holds an unexpired grant into this workspace. A policy would have to trust the ' +
      'answer to decide whether to return it.',
    PlatformAuditEvent:
      'Control-plane audit. Written by platform staff actions that span workspaces and read ' +
      'only through the platform console, which runs under app.platform_admin.',
  };

  it('leaves exactly the chosen models with neither a guard nor a policy', () => {
    const doublyExempt = [...GLOBAL_MODELS].filter((model) => unprotectedByRls.has(model)).sort();
    // Not a subset check: a name dropping *out* matters as much as one appearing.
    // If a model here gained RLS, the note above became wrong and should go.
    expect(doublyExempt).toEqual(Object.keys(APPLICATION_ENFORCED_ONLY).sort());
  });
});
