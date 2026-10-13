import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as importPost } from '@/app/api/v1/leads/import/route';
import { POST as createPost } from '@/app/api/v1/leads/route';
import { rejectedRowsCsv } from '@/lib/leads/importMapping';
import { seedHierarchy, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { post } from '../helpers/request';

/**
 * The bulk import behind the spreadsheet screen: rows become IMPORT-sourced leads,
 * remarks become a note on the timeline, and a row matching an existing lead is
 * skipped by default, imported when asked, or fills that lead in (UPDATE). A dry
 * run reports the same without saving anything, and the refused rows download
 * as a CSV.
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
          {
            line: 2,
            values: { fullName: `Import One ${stamp}`, phone: '0501234567', notes: 'Budget: 1.2M\nProperty: Villa' },
          },
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
    const note = await prisma.activity.findFirst({
      where: { tenantId: fixture.a.tenantId, leadId: lead.id },
      select: { notes: true, source: true },
    });
    expect(note?.notes).toContain('Budget: 1.2M');
    expect(note?.source).toBe('IMPORT');
  });

  it('skips a row matching an existing lead unless onDuplicate is WARN', async () => {
    const row = { line: 2, values: { fullName: `Import Dup ${stamp}`, phone: '+971 50 123 4567' } };
    const blocked = await post(importPost, '/api/v1/leads/import', { rows: [row] }, fixture.a.cookie);
    expect(blocked.status).toBe(200);
    expect(blocked.body.created).toBe(0);
    expect(blocked.body.duplicates).toBe(1);
    expect(blocked.body.failed[0].reason).toMatch(/already exists/);

    const warned = await post(
      importPost,
      '/api/v1/leads/import',
      { rows: [row], onDuplicate: 'WARN' },
      fixture.a.cookie,
    );
    expect(warned.body.created).toBe(1);
  });

  it('refuses the dead MERGE value, on the import and on the create endpoint (M4-41)', async () => {
    const row = { line: 2, values: { fullName: `Import Merge ${stamp}` } };
    const imported = await post(
      importPost,
      '/api/v1/leads/import',
      { rows: [row], onDuplicate: 'MERGE' },
      fixture.a.cookie,
    );
    expect(imported.status).toBe(422);
    const created = await post(
      createPost,
      '/api/v1/leads',
      { fullName: `Create Merge ${stamp}`, onDuplicate: 'MERGE' },
      fixture.a.cookie,
    );
    expect(created.status).toBe(422);
    expect(await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, fullName: { contains: 'Merge' } } })).toBe(
      0,
    );
  });
});

describe('onDuplicate UPDATE (M4-41)', () => {
  it('fills the matched lead from the row’s non-empty values, never blanks one, and audits it', async () => {
    const number = `+97155${String(stamp).slice(-7)}`;
    const existing = await prisma.lead.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `UPD-${stamp}`,
        fullName: 'Update Me',
        phone: number,
        phoneNormalized: number,
        company: 'Keep Co',
        city: 'Dubai',
        stageId: fixture.a.stageId,
        ownerId: fixture.a.userId,
      },
    });
    const started = new Date();
    const res = await post(
      importPost,
      '/api/v1/leads/import',
      {
        onDuplicate: 'UPDATE',
        // The same number as typed in the sheet; a new email; no company or city.
        rows: [
          {
            line: 2,
            values: {
              fullName: 'Update Me',
              phone: `055${String(stamp).slice(-7)}`,
              email: `upd-${stamp}@import.test`,
            },
          },
        ],
      },
      fixture.a.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 1, duplicates: 0, failed: [] });

    const after = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: existing.id } });
    expect(after).toMatchObject({
      email: `upd-${stamp}@import.test`,
      phoneNormalized: number,
      company: 'Keep Co',
      city: 'Dubai',
    });
    const audited = await prisma.auditLog.findFirst({
      where: { tenantId: fixture.a.tenantId, recordId: existing.id, fieldKey: 'email', occurredAt: { gte: started } },
    });
    expect(audited?.newValue).toBe(`upd-${stamp}@import.test`);
  });

  it('reports a match outside the importer’s scope as a duplicate and leaves it alone', async () => {
    const h = await seedHierarchy();
    try {
      const number = `+97156${String(stamp).slice(-7)}`;
      await prisma.lead.update({
        where: { tenantId: h.tenantId, id: h.repA2.leadId },
        data: { phone: number, phoneNormalized: number },
      });
      const res = await post(
        importPost,
        '/api/v1/leads/import',
        {
          onDuplicate: 'UPDATE',
          rows: [{ line: 2, values: { fullName: 'Not Yours', phone: number, email: `scope-${stamp}@import.test` } }],
        },
        h.repA1.cookie,
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ created: 0, updated: 0, duplicates: 1 });
      expect(res.body.failed[0].reason).toMatch(/already exists/);
      const theirs = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA2.leadId } });
      expect(theirs).toMatchObject({ email: null, fullName: 'repA2 lead' });
    } finally {
      await h.cleanup();
    }
  });
});

describe('dryRun (M4-42)', () => {
  it('writes nothing and reports exactly what the commit then does', async () => {
    const t = fixture.a.tenantId;
    const existingNumber = `+97158${String(stamp).slice(-7)}`;
    const existing = await prisma.lead.create({
      data: {
        tenantId: t,
        reference: `DRY-${stamp}`,
        fullName: 'Dry Existing',
        phone: existingNumber,
        phoneNormalized: existingNumber,
        company: 'Old Co',
        stageId: fixture.a.stageId,
        ownerId: fixture.a.userId,
      },
    });
    const a = `+97152${String(stamp).slice(-7)}`;
    const b = `+97153${String(stamp).slice(-7)}`;
    const rows = [
      { line: 2, values: { fullName: `Dry A ${stamp}`, phone: a } },
      // The same number again further down: the commit updates the lead line 2 made.
      { line: 3, values: { fullName: `Dry A ${stamp}`, phone: a, email: `dry-a-${stamp}@import.test` } },
      { line: 4, values: { fullName: 'Dry Existing', phone: existingNumber, company: 'New Co' } },
      { line: 5, values: { fullName: `Dry Bad ${stamp}`, email: 'not-an-email' } },
      { line: 6, values: { fullName: `Dry B ${stamp}`, phone: b, notes: 'From the expo' } },
    ];
    const counts = async () => ({
      leads: await prisma.lead.count({ where: { tenantId: t } }),
      activities: await prisma.activity.count({ where: { tenantId: t } }),
      audits: await prisma.auditLog.count({ where: { tenantId: t } }),
      phones: await prisma.leadPhone.count({ where: { tenantId: t } }),
    });

    const before = await counts();
    const dry = await post(
      importPost,
      '/api/v1/leads/import',
      { rows, onDuplicate: 'UPDATE', fileName: 'expo.csv', dryRun: true },
      fixture.a.cookie,
    );
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, created: 2, updated: 2, duplicates: 0 });
    expect(dry.body.failed.map((f: { line: number }) => f.line)).toEqual([5]);
    expect(await counts()).toEqual(before);
    expect(
      (await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: existing.id }, select: { company: true } }))
        .company,
    ).toBe('Old Co');

    const commit = await post(
      importPost,
      '/api/v1/leads/import',
      { rows, onDuplicate: 'UPDATE', fileName: 'expo.csv' },
      fixture.a.cookie,
    );
    expect(commit.status).toBe(200);
    expect(commit.body.dryRun).toBe(false);
    expect({ ...commit.body, dryRun: true }).toEqual(dry.body);
    // Dry A (line 3 filled it in), Dry B and the existing lead; line 5 refused.
    expect(await prisma.lead.count({ where: { tenantId: t, fullName: { startsWith: 'Dry ' } } })).toBe(3);
    expect(
      (await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: existing.id }, select: { company: true } }))
        .company,
    ).toBe('New Co');
  });
});

describe('rejectedRowsCsv (M4-43)', () => {
  it('lists each refused line with its reason and the file’s own cells, for Excel, formulas blunted', () => {
    const csv = rejectedRowsCsv(
      ['Name', 'Mobile', 'Email'],
      [
        ['Fine', '0501234567', 'fine@import.test'],
        ['=HYPERLINK("http://x.test","Open")', '+971501234567', 'bad'],
        ['@SUM(A1)', '-1+2', ''],
      ],
      [
        { line: 4, reason: 'Full name is missing' },
        { line: 3, reason: 'email: Invalid email' },
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Line","Reason","Name","Mobile","Email"',
      // A plain number stays a number; a formula is prefixed so Excel shows it as text.
      '"3","email: Invalid email","\'=HYPERLINK(""http://x.test"",""Open"")","+971501234567","bad"',
      '"4","Full name is missing","\'@SUM(A1)","\'-1+2",""',
      '',
    ]);
  });
});
