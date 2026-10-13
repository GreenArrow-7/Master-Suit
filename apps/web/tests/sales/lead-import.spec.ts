// The dry run must not queue distribution, scoring or automation for leads it rolls back.
vi.mock('@/lib/queue', async (importOriginal) => {
  const queue = await importOriginal<typeof import('@/lib/queue')>();
  return { ...queue, enqueue: vi.fn(queue.enqueue) };
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { POST as importPost } from '@/app/api/v1/leads/import/route';
import { POST as createPost } from '@/app/api/v1/leads/route';
import { rejectedRowsCsv } from '@/lib/leads/importMapping';
import {
  createWorkspaceUser,
  grantPermissions,
  seedHierarchy,
  seedTwoTenants,
  type Fixture,
} from '../helpers/fixtures';
import { post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

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
        // The same number as typed in the sheet; a new email; company and city left empty.
        rows: [
          {
            line: 2,
            values: {
              fullName: 'Update Me',
              phone: `055${String(stamp).slice(-7)}`,
              email: `upd-${stamp}@import.test`,
              company: '',
              city: '   ',
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
    const audited = await prisma.auditLog.findMany({
      where: { tenantId: fixture.a.tenantId, recordId: existing.id, occurredAt: { gte: started } },
    });
    expect(audited.find((row) => row.fieldKey === 'email')?.newValue).toBe(`upd-${stamp}@import.test`);
    expect(audited.filter((row) => ['company', 'city', 'phone'].includes(row.fieldKey ?? ''))).toEqual([]);
  });

  it('adds a different number as another number, never replacing the lead’s main one', async () => {
    const t = fixture.a.tenantId;
    const main = `+97151${String(stamp).slice(-7)}`;
    const second = `+97159${String(stamp).slice(-7)}`;
    const fresh = `+97150${String(stamp).slice(-7)}`;
    const existing = await prisma.lead.create({
      data: {
        tenantId: t,
        reference: `UPN-${stamp}`,
        fullName: 'Number Kept',
        phone: main,
        phoneNormalized: main,
        email: `number-${stamp}@import.test`,
        stageId: fixture.a.stageId,
        ownerId: fixture.a.userId,
        phones: { create: { tenantId: t, raw: second, normalized: second } },
      },
    });
    const res = await post(
      importPost,
      '/api/v1/leads/import',
      {
        onDuplicate: 'UPDATE',
        rows: [
          // Matched by email, with a number the lead does not have.
          { line: 2, values: { fullName: 'Number Kept', email: `number-${stamp}@import.test`, phone: fresh } },
          // Matched by its other number: that stays another number.
          { line: 3, values: { fullName: 'Number Kept', phone: second, company: 'Second Co' } },
        ],
      },
      fixture.a.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ created: 0, updated: 2, failed: [] });
    const after = await prisma.lead.findFirstOrThrow({
      where: { tenantId: t, id: existing.id },
      include: { phones: true },
    });
    expect(after).toMatchObject({ phone: main, phoneNormalized: main, company: 'Second Co' });
    expect(after.phones.map((p) => p.normalized).sort()).toEqual([fresh, second].sort());
  });

  it('does not fill a lead the rules match on the name alone', async () => {
    const t = fixture.b.tenantId;
    await prisma.duplicateRule.createMany({
      data: [
        { tenantId: t, name: 'Number', matchFields: ['phoneNormalized'], position: 0 },
        { tenantId: t, name: 'Name', matchFields: ['fullName'], position: 1 },
      ],
    });
    try {
      const existing = await prisma.lead.create({
        data: {
          tenantId: t,
          reference: `NAME-${stamp}`,
          fullName: `Mohammed Khan ${stamp}`,
          email: `first-khan-${stamp}@import.test`,
          stageId: fixture.b.stageId,
          ownerId: fixture.b.userId,
        },
      });
      const res = await post(
        importPost,
        '/api/v1/leads/import',
        {
          onDuplicate: 'UPDATE',
          rows: [
            { line: 2, values: { fullName: `Mohammed Khan ${stamp}`, email: `second-khan-${stamp}@import.test` } },
          ],
        },
        fixture.b.cookie,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Another person with the same name: refused as Skip would, not written over.
      expect(res.body).toMatchObject({ created: 0, updated: 0, duplicates: 1 });
      expect(
        (await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: existing.id }, select: { email: true } }))
          .email,
      ).toBe(`first-khan-${stamp}@import.test`);
    } finally {
      await prisma.duplicateRule.deleteMany({ where: { tenantId: t } });
    }
  });

  it('leaves a phone or email the importer sees masked as it is', async () => {
    const t = fixture.a.tenantId;
    const role = await prisma.role.create({
      data: { tenantId: t, key: `masked-importer-${stamp}`, name: 'Masked importer', rank: 70 },
    });
    await grantPermissions(t, role.id, [
      ['leads', 'VIEW'],
      ['leads', 'CREATE'],
      ['leads', 'EDIT'],
      ['leads', 'IMPORT'],
    ]);
    const user = await createWorkspaceUser({
      tenantId: t,
      roleId: role.id,
      email: `masked-importer-${stamp}@import.test`,
      fullName: 'Masked importer',
    });
    const cookie = await createSessionToken(t, user.id);
    const number = `+97157${String(stamp).slice(-7)}`;
    const existing = await prisma.lead.create({
      data: {
        tenantId: t,
        reference: `MSK-${stamp}`,
        fullName: 'Masked Match',
        phone: number,
        phoneNormalized: number,
        email: `masked-old-${stamp}@import.test`,
        stageId: fixture.a.stageId,
        ownerId: user.id,
      },
    });
    const res = await post(
      importPost,
      '/api/v1/leads/import',
      {
        onDuplicate: 'UPDATE',
        rows: [
          {
            line: 2,
            values: {
              fullName: 'Masked Match',
              phone: number,
              email: `masked-new-${stamp}@import.test`,
              company: 'Masked Co',
            },
          },
        ],
      },
      cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ updated: 1, failed: [] });
    expect(await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: existing.id } })).toMatchObject({
      email: `masked-old-${stamp}@import.test`,
      company: 'Masked Co',
    });
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

/** What a dry run must leave as it was: every lead, timeline entry, number and audit row but the check's own. */
const counts = async (t: string) => ({
  leads: await prisma.lead.count({ where: { tenantId: t } }),
  activities: await prisma.activity.count({ where: { tenantId: t } }),
  audits: await prisma.auditLog.count({ where: { tenantId: t, NOT: { event: 'IMPORT_STARTED' } } }),
  phones: await prisma.leadPhone.count({ where: { tenantId: t } }),
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
    const before = await counts(t);
    const checkedAt = new Date();
    vi.mocked(enqueue).mockClear();
    const dry = await post(
      importPost,
      '/api/v1/leads/import',
      { rows, onDuplicate: 'UPDATE', fileName: 'expo.csv', dryRun: true },
      fixture.a.cookie,
    );
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, created: 2, updated: 2, duplicates: 0 });
    expect(dry.body.failed.map((f: { line: number }) => f.line)).toEqual([5]);
    expect(await counts(t)).toEqual(before);
    // Nothing queued for leads that were never saved.
    expect(enqueue).not.toHaveBeenCalled();
    // The check itself is on the record, as the import is.
    const checked = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: t, event: 'IMPORT_STARTED', actorUserId: fixture.a.userId, occurredAt: { gte: checkedAt } },
    });
    expect(checked.metadata).toMatchObject({ dryRun: true, onDuplicate: 'UPDATE', created: 2, updated: 2, failed: 1 });
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
    expect(enqueue).toHaveBeenCalled();
    // Dry A (line 3 filled it in), Dry B and the existing lead; line 5 refused.
    expect(await prisma.lead.count({ where: { tenantId: t, fullName: { startsWith: 'Dry ' } } })).toBe(3);
    expect(
      (await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: existing.id }, select: { company: true } }))
        .company,
    ).toBe('New Co');
  });

  it('under Skip, a row matching a lead and a row the database refuses leave the next row as the commit does', async () => {
    const t = fixture.a.tenantId;
    const taken = `+97154${String(stamp).slice(-7)}`;
    await prisma.lead.create({
      data: {
        tenantId: t,
        reference: `BLK-${stamp}`,
        fullName: 'Block Existing',
        phone: taken,
        phoneNormalized: taken,
        stageId: fixture.a.stageId,
        ownerId: fixture.a.userId,
      },
    });
    const rows = [
      { line: 2, values: { fullName: 'Block Again', phone: taken } },
      // Postgres refuses a NUL in text: an error from the database, not from a check.
      { line: 3, values: { fullName: `Block Nul\u0000 ${stamp}` } },
      { line: 4, values: { fullName: `Block New ${stamp}`, phone: `+9714${String(stamp).slice(-7)}` } },
    ];
    const before = await counts(t);
    const dry = await post(importPost, '/api/v1/leads/import', { rows, dryRun: true }, fixture.a.cookie);
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, created: 1, updated: 0, duplicates: 1 });
    expect(dry.body.failed.map((f: { line: number }) => f.line)).toEqual([2, 3]);
    expect(await counts(t)).toEqual(before);

    const commit = await post(importPost, '/api/v1/leads/import', { rows }, fixture.a.cookie);
    expect(commit.status).toBe(200);
    expect({ ...commit.body, dryRun: true }).toEqual(dry.body);
    expect(await prisma.lead.count({ where: { tenantId: t, fullName: `Block New ${stamp}` } })).toBe(1);
  });

  it('checks at most 500 rows at a time', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ line: i + 2, values: { fullName: `Cap ${i}` } }));
    const res = await post(importPost, '/api/v1/leads/import', { rows, dryRun: true }, fixture.a.cookie);
    expect(res.status).toBe(422);
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
