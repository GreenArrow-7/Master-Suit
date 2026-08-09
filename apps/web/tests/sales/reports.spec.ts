import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { runReport, toCsv, REPORT_KEYS, type Report } from '@/services/leadership/reports';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx } from '@/lib/security/rbac';

/**
 * The report menu used to link ten reports to a parameter nothing handled.
 *
 * These pin the two things that made it worth fixing rather than deleting:
 * every key actually answers, and the CSV escapes properly — an unescaped comma
 * in a lead source silently shifts every column after it, and that is the kind
 * of export somebody opens in a spreadsheet and believes.
 */
let fixture: Fixture;
let ctx: Ctx;
const suffix = randomBytes(4).toString('hex');
const RANGE = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') };

beforeAll(async () => {
  fixture = await seedTwoTenants();
  ctx = buildCtx(
    buildActor({
      id: fixture.a.userId,
      tenantId: fixture.a.tenantId,
      permissions: new Map([['reports:VIEW', 'ORGANIZATION' as const]]),
    }),
  );
});

afterAll(async () => {
  await prisma.lead.deleteMany({
    where: { tenantId: fixture.a.tenantId, reference: { startsWith: `RP-${suffix}` } },
  });
  await fixture.cleanup();
});

describe('every report on the menu', () => {
  it('answers, rather than 404ing like the links used to', async () => {
    for (const key of REPORT_KEYS) {
      const report = await runReport(ctx, key, RANGE);
      expect(report.key, key).toBe(key);
      expect(report.title.length, key).toBeGreaterThan(0);
      expect(report.columns.length, key).toBeGreaterThan(0);
      // Rows may legitimately be empty; the columns describing them may not.
      expect(Array.isArray(report.rows), key).toBe(true);
    }
  });

  it('gives every row a value for every declared column', async () => {
    for (const key of REPORT_KEYS) {
      const report = await runReport(ctx, key, RANGE);
      for (const row of report.rows) {
        for (const column of report.columns) {
          // A missing key renders as undefined and exports as an empty cell
          // that nobody notices; a declared column must always be answered.
          expect(row, `${key}.${column.key}`).toHaveProperty(column.key);
        }
      }
    }
  });

  it('reports conversion the same way the leader dashboard does', async () => {
    const report = await runReport(ctx, 'lead-conversion', RANGE);
    expect(report.rows.map((r) => r.step)).toEqual([
      'Leads in',
      'Reached a conversion stage',
      'Became an opportunity',
      'Became a booking',
    ]);
    // Not "0%": a rate with no leads behind it is unknown, not failure.
    const noLeads = await runReport(ctx, 'lead-conversion', {
      from: new Date('2000-01-01T00:00:00Z'),
      to: new Date('2000-01-31T00:00:00Z'),
    });
    expect(noLeads.rows[1].rate).toBeNull();
  });

  it('keeps one tenant’s numbers out of another’s report', async () => {
    const other = buildCtx(
      buildActor({
        id: 'someone-else',
        tenantId: fixture.b.tenantId,
        permissions: new Map([['reports:VIEW', 'ORGANIZATION' as const]]),
      }),
    );
    const mine = await runReport(ctx, 'source-analysis', RANGE);
    const theirs = await runReport(other, 'source-analysis', RANGE);

    const total = (r: Report) => r.rows.reduce((n, row) => n + Number(row.leads ?? 0), 0);
    const actual = (tenantId: string) =>
      prisma.lead.count({
        where: { tenantId, deletedAt: null, createdAt: { gte: RANGE.from, lte: RANGE.to } },
      });

    // Both workspaces have leads of their own, so the check is that each report
    // totals exactly its own — not that the other one is empty.
    expect(total(mine)).toBe(await actual(fixture.a.tenantId));
    expect(total(theirs)).toBe(await actual(fixture.b.tenantId));
    expect(total(mine)).not.toBe(total(theirs));
  });
});

describe('csv export', () => {
  const report = (rows: Record<string, string | number | null>[]): Report => ({
    key: 'source-analysis',
    title: 'Test',
    columns: [
      { key: 'a', label: 'Source' },
      { key: 'b', label: 'Leads', align: 'right' },
    ],
    rows,
  });

  /** Everything is quoted, so a row is predictable regardless of its content. */
  const BOM = '\ufeff';
  const HEAD = BOM + '"Source","Leads"\r\n';

  it('writes a header and one line per row', () => {
    expect(toCsv(report([{ a: 'web', b: 3 }]))).toBe(HEAD + '"web","3"\r\n');
  });

  it('leads with a byte-order mark so Excel reads UTF-8', () => {
    // Without it every non-ASCII name arrives mangled in the local codepage.
    expect(toCsv(report([{ a: 'Dubai', b: 1 }])).startsWith(BOM)).toBe(true);
  });

  it('neutralises a cell that a spreadsheet would execute', () => {
    // =HYPERLINK("http://...") in a lead's name is a phishing link that arrives
    // inside your own export. Excel and Sheets strip the leading apostrophe on
    // display, so the value still reads correctly.
    for (const dangerous of ['=HYPERLINK("http://evil")', '@SUM(A1)', '-2+3+cmd']) {
      expect(toCsv(report([{ a: dangerous, b: 1 }]))).toContain('"\'' + dangerous.replace(/"/g, '""') + '"');
    }
    // A plain negative is a number, not an attack — prefixing it would stop a
    // money column summing in Excel.
    expect(toCsv(report([{ a: '-82500', b: 1 }]))).toContain('"-82500"');
  });

  it('quotes a value containing a comma', () => {
    // Otherwise every column after it shifts one to the left, silently.
    expect(toCsv(report([{ a: 'Dubai, Marina', b: 2 }]))).toBe(HEAD + '"Dubai, Marina","2"\r\n');
  });

  it('doubles an embedded quote', () => {
    expect(toCsv(report([{ a: 'the "good" ones', b: 1 }]))).toBe(HEAD + '"the ""good"" ones","1"\r\n');
  });

  it('quotes a value containing a newline', () => {
    expect(toCsv(report([{ a: 'two\nlines', b: 1 }]))).toBe(HEAD + '"two\nlines","1"\r\n');
  });

  it('writes an unknown as an empty cell rather than the word null', () => {
    expect(toCsv(report([{ a: 'web', b: null }]))).toBe(HEAD + '"web",""\r\n');
  });

  it('emits only the declared columns, in order', () => {
    expect(toCsv(report([{ b: 9, a: 'web', ignored: 'x' }]))).toBe(HEAD + '"web","9"\r\n');
  });
});
