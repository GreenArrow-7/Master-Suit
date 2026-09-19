import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as importPost } from '@/app/api/v1/leads/import/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { post } from '../helpers/request';

/**
 * The bulk import behind the spreadsheet screen: rows become IMPORT-sourced leads,
 * remarks become a note on the timeline, and a row matching an existing lead is
 * skipped by default or imported when asked.
 */
let fixture: Fixture;
const stamp = Date.now();

beforeAll(async () => {
  fixture = await seedTwoTenants();
});
afterAll(async () => {
  await fixture.cleanup();
});

describe('POST /api/v1/leads/import', () => {
  it('creates IMPORT leads, stores notes as an activity, reports bad rows by line', async () => {
    const res = await post(
      importPost,
      '/api/v1/leads/import',
      {
        fileName: 'leads.xlsx',
        rows: [
          { line: 2, values: { fullName: `Import One ${stamp}`, phone: '0501234567', notes: 'Budget: 1.2M\nProperty: Villa' } },
          { line: 3, values: { fullName: `Import Two ${stamp}`, email: 'not-an-email' } },
          { line: 4, values: { fullName: `Import Three ${stamp}`, source: 'Facebook' } },
        ],
      },
      fixture.a.cookie,
    );
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.failed.map((f: { line: number }) => f.line).sort()).toEqual([3, 4]);

    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, fullName: `Import One ${stamp}` },
      select: { id: true, source: true, sourceDetail: true, phoneNormalized: true },
    });
    expect(lead.source).toBe('IMPORT');
    expect(lead.sourceDetail).toBe('leads.xlsx');
    expect(lead.phoneNormalized).toBe('+971501234567');
    const note = await prisma.activity.findFirst({ where: { tenantId: fixture.a.tenantId, leadId: lead.id }, select: { notes: true, source: true } });
    expect(note?.notes).toContain('Budget: 1.2M');
    expect(note?.source).toBe('IMPORT');
  });

  it('skips a row matching an existing lead unless onDuplicate is WARN', async () => {
    const row = { line: 2, values: { fullName: `Import Dup ${stamp}`, phone: '+971 50 123 4567' } };
    const blocked = await post(importPost, '/api/v1/leads/import', { rows: [row] }, fixture.a.cookie);
    expect(blocked.status).toBe(200);
    expect(blocked.body.created).toBe(0);
    expect(blocked.body.failed[0].reason).toMatch(/already exists/);

    const warned = await post(importPost, '/api/v1/leads/import', { rows: [row], onDuplicate: 'WARN' }, fixture.a.cookie);
    expect(warned.body.created).toBe(1);
  });
});
