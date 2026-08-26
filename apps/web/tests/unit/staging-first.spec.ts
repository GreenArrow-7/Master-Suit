/**
 * "Staging first, then production" as a control rather than a sentence.
 *
 * `docs/ENVIRONMENTS.md` has required that order for migrations since it was
 * written, and until `infra/docker-compose.staging.yml` there was no staging to
 * go first — so every migration's first contact with production-shaped data was
 * production, and `prisma migrate deploy` has no down-path.
 *
 * `scripts/check-staging-first.mjs` runs inside the production `migrate` service
 * and refuses anything that has not already finished in staging with the same
 * bytes. The decision is a pure function of three ledgers precisely so the cases
 * that matter can be asserted here — a half-applied migration, a file edited
 * after the rehearsal, a staging that ran something never committed — none of
 * which are convenient to produce against live databases.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// A plain .mjs ops script, like check-rls.mjs. It guards its own `main()` behind
// an argv check so importing it here runs nothing.
import { checksum, decide, readRepoMigrations } from '../../scripts/check-staging-first.mjs';

interface Row {
  name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

const applied = (name: string, sql: string): Row => ({
  name,
  checksum: checksum(sql),
  finished_at: new Date('2026-08-01T00:00:00Z'),
  rolled_back_at: null,
});

const M1 = { name: '20260101000000_first', sql: 'CREATE TABLE a();' };
const M2 = { name: '20260202000000_second', sql: 'ALTER TABLE a ADD COLUMN b int;' };
const repo = [M1, M2].map((m) => ({ name: m.name, checksum: checksum(m.sql) }));

describe('the gate', () => {
  it('clears a migration that succeeded in staging with the same bytes', () => {
    const result = decide({
      repo,
      production: [applied(M1.name, M1.sql)],
      staging: [applied(M1.name, M1.sql), applied(M2.name, M2.sql)],
    });
    expect(result.ok).toBe(true);
    expect(result.pending).toEqual([M2.name]);
  });

  it('refuses a migration staging has never seen', () => {
    const result = decide({
      repo,
      production: [applied(M1.name, M1.sql)],
      staging: [applied(M1.name, M1.sql)],
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].migration).toBe(M2.name);
    expect(result.problems[0].reason).toContain('never applied to staging');
  });

  it('refuses when staging has no ledger at all — an unmigrated database is not a rehearsal', () => {
    // What `ledger()` returns for error 42P01, undefined_table: a staging
    // project that was created but never migrated. Empty must read as "nothing
    // was rehearsed", never as "nothing to object to".
    const result = decide({ repo, production: [], staging: [] });
    expect(result.ok).toBe(false);
    expect(result.problems.map((p: { migration: string }) => p.migration)).toEqual([M1.name, M2.name]);
  });

  it('refuses a migration that was rolled back in staging', () => {
    const result = decide({
      repo,
      production: [applied(M1.name, M1.sql)],
      staging: [
        applied(M1.name, M1.sql),
        { ...applied(M2.name, M2.sql), rolled_back_at: new Date('2026-08-02T00:00:00Z') },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0].reason).toContain('rolled back');
  });

  it('refuses a migration that started in staging and never finished', () => {
    // Usually a lock it could not take. Production will not give it one either,
    // and a half-applied migration there has to be repaired forward, live.
    const result = decide({
      repo,
      production: [applied(M1.name, M1.sql)],
      staging: [applied(M1.name, M1.sql), { ...applied(M2.name, M2.sql), finished_at: null }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0].reason).toContain('unfinished');
  });

  it('refuses a migration whose file was edited after staging ran it', () => {
    // The subtle one. Prisma would apply the edited file without complaint —
    // the checksum it compares against is production's ledger, which has no row
    // for this migration yet — so what production runs is SQL nothing has
    // executed anywhere.
    const result = decide({
      repo,
      production: [applied(M1.name, M1.sql)],
      staging: [applied(M1.name, M1.sql), applied(M2.name, 'ALTER TABLE a ADD COLUMN b text;')],
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0].reason).toContain('edited after staging ran it');
  });

  it('does not re-examine what production has already applied', () => {
    // An old migration whose file has since drifted is `migrate deploy`'s own
    // error to raise, against production's own ledger. This gate is about what
    // is *about* to be applied; widening it would make every deploy fail on
    // history nobody can change.
    const result = decide({
      repo,
      production: [applied(M1.name, 'something else entirely'), applied(M2.name, M2.sql)],
      staging: [],
    });
    expect(result.ok).toBe(true);
    expect(result.pending).toEqual([]);
  });

  it('reports each uncleared migration separately rather than stopping at the first', () => {
    const result = decide({ repo, production: [], staging: [applied(M1.name, 'edited')] });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0].reason).toContain('edited after staging ran it');
    expect(result.problems[1].reason).toContain('never applied to staging');
  });

  it('warns about a migration staging ran that is not in this checkout, without refusing', () => {
    // Applied to staging from an uncommitted branch. It cannot reach production
    // — `migrate deploy` only applies what is on disk — but it means the
    // rehearsal ran against a schema this release cannot reproduce.
    const result = decide({
      repo,
      production: [applied(M1.name, M1.sql), applied(M2.name, M2.sql)],
      staging: [applied(M1.name, M1.sql), applied(M2.name, M2.sql), applied('20260303000000_local_experiment', 'x')],
    });
    expect(result.ok).toBe(true);
    expect(result.strays).toEqual(['20260303000000_local_experiment']);
  });
});

describe('reading the repository', () => {
  it('computes the same checksum Prisma stores', () => {
    // Pinned to a literal rather than to `createHash(...)` recomputed here,
    // which would only assert that the function calls itself. Verified against a
    // real _prisma_migrations row: the value Prisma writes as `checksum` is the
    // hex sha256 of the migration.sql bytes, and the whole gate rests on that
    // being true.
    expect(checksum('CREATE TABLE a();')).toBe('a8244c304686a6281431292e1c92c63f5803194fe5453363a2a91372397548b7');
    // Bytes and string must agree — files are read as a Buffer.
    expect(checksum(Buffer.from('CREATE TABLE a();'))).toBe(checksum('CREATE TABLE a();'));
    expect(checksum('a')).not.toBe(checksum('b'));
  });

  it('reads migrations in name order and skips directories with no migration.sql', () => {
    const dir = mkdtempSync(join(tmpdir(), 'staging-first-'));
    for (const [name, sql] of [
      ['20260202000000_second', 'two'],
      ['20260101000000_first', 'one'],
    ] as const) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'migration.sql'), sql);
    }
    // Prisma ignores a directory without migration.sql, and so must this — a
    // stray folder in prisma/migrations must not become a migration that can
    // never be cleared.
    mkdirSync(join(dir, '20260303000000_not_a_migration'));

    const found = readRepoMigrations(dir);
    expect(found.map((m: { name: string }) => m.name)).toEqual(['20260101000000_first', '20260202000000_second']);
    expect(found[0].checksum).toBe(checksum('one'));
  });

  it('returns nothing for a directory that does not exist, rather than throwing', () => {
    expect(readRepoMigrations(join(tmpdir(), 'definitely-not-here-9df3'))).toEqual([]);
  });
});

describe('against this repository', () => {
  it('reads every committed migration and its checksum', () => {
    // Not a fixture: the real prisma/migrations tree. If this returns nothing,
    // the gate would clear every deploy silently, which is the one failure mode
    // a check like this must not have.
    const found = readRepoMigrations(join(__dirname, '..', '..', 'prisma', 'migrations'));
    expect(found.length).toBeGreaterThan(20);
    expect(found.every((m: { checksum: string }) => m.checksum.length === 64)).toBe(true);
    expect([...found].sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))).toEqual(found);
  });
});
