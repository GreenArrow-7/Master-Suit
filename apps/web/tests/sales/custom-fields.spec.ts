const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { GET as listFields, PATCH as editField, POST as addField } from '@/app/api/v1/custom-fields/route';
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { POST as createLead } from '@/app/api/v1/leads/route';
import SmartViewsPage from '@/app/(workspace)/[workspaceSlug]/sales/smart-views/page';
import { customCells } from '@/services/leads/customFields';
import { customPatch } from '@/lib/leads/customPatch';
import { GET as readColumns, PUT as saveColumns } from '@/app/api/v1/admin/grid-columns/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import CustomFieldsPage from '@/app/(workspace)/[workspaceSlug]/admin/custom-fields/page';
import NewLeadPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/new/page';
import { GET as exportLeads } from '@/app/api/v1/leads/export/route';
import { issueApiKey } from '@/lib/auth/apiKey';
import { PUT as saveLayout } from '@/app/api/v1/lead-form-layout/route';
import { leadFormLayout } from '@/lib/leads/formLayout';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { get, patch, post, put } from '../helpers/request';

/**
 * Tenant-defined fields on a lead (Lead Eagle audit row M4-13, 13 Oct): an
 * administrator defines text, number, date and select fields under
 * Administration → Custom fields; anyone who edits the lead fills them on its
 * Overview, checked by type; the lead grid can show one as a column. The
 * acceptance: an admin defines "Visa status" and an agent fills it on a lead.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
/** `leads:VIEW`/`EDIT` at OWN and `settings:VIEW`: fills fields, defines none. */
let agent: string;
let agentLeadId: string;

const API = '/api/v1/custom-fields';
type Def = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  isRequired: boolean;
  isActive: boolean;
};
const defs = async (as = admin) => (await get(listFields, API, as)).body as Def[];
const leadUrl = (id: string) => `/api/v1/leads/${id}`;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  cookieJar.value = admin;
  for (const t of [fixture.a, fixture.b]) {
    const { roleId } = await prisma.user.findFirstOrThrow({
      where: { tenantId: t.tenantId, id: t.userId },
      select: { roleId: true },
    });
    await grantPermissions(t.tenantId, roleId, [
      ['settings', 'VIEW'],
      ['settings', 'MANAGE_CONFIGURATION'],
      ['smartviews', 'VIEW'],
    ]);
  }
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 80 } });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['settings', 'VIEW'],
    ],
    'OWN',
  );
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `agent-${suffix}@a.test`,
    fullName: 'Agent',
  });
  agent = await createSessionToken(tenantId, user.id);
  agentLeadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `AG-${suffix}`,
        fullName: 'Agent Lead',
        stageId: fixture.a.stageId,
        ownerId: user.id,
        // What Meta lead ads keep here (services/meta/applyEvent.ts): a field must never overwrite it.
        customData: { metaLeadgen: { formId: 'f-1' } },
      },
    })
  ).id;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('Administration → Custom fields (M4-13)', () => {
  it('an administrator defines text, number, date and select fields; the key follows the label', async () => {
    const visa = await post(
      addField,
      API,
      { label: 'Visa status', type: 'DROPDOWN', options: ['Resident', 'Visit', 'Golden'] },
      admin,
    );
    expect(visa.status, JSON.stringify(visa.body)).toBe(200);
    expect(visa.body).toMatchObject({ key: 'visa_status', label: 'Visa status', type: 'DROPDOWN' });
    for (const body of [
      { label: 'Employer', type: 'TEXT', isRequired: true },
      { label: 'Family size', type: 'NUMBER' },
      { label: 'Visa expiry', type: 'DATE', key: 'visa_expiry' },
    ]) {
      expect((await post(addField, API, body, admin)).status, JSON.stringify(body)).toBe(200);
    }
    expect((await defs()).map((d) => [d.key, d.type, d.isRequired, d.isActive])).toEqual([
      ['visa_status', 'DROPDOWN', false, true],
      ['employer', 'TEXT', true, true],
      ['family_size', 'NUMBER', false, true],
      ['visa_expiry', 'DATE', false, true],
    ]);
    const audited = await prisma.auditLog.findFirst({
      where: { tenantId, objectType: 'settings', recordId: visa.body.id },
    });
    expect(audited).toMatchObject({ event: 'RECORD_CREATED' });
  });

  it('refuses a key in use, a select with no options, a type it does not offer and a key that is not plain', async () => {
    expect((await post(addField, API, { label: 'Visa Status', type: 'TEXT' }, admin)).status).toBe(409);
    expect((await post(addField, API, { label: 'Band', type: 'DROPDOWN', options: [] }, admin)).status).toBe(422);
    expect((await post(addField, API, { label: 'Consent', type: 'CHECKBOX' }, admin)).status).toBe(422);
    expect((await post(addField, API, { label: 'Meta', key: 'metaLeadgen', type: 'TEXT' }, admin)).status).toBe(422);
    expect((await post(addField, API, { label: 'x', key: '9lives', type: 'TEXT' }, admin)).status).toBe(422);
  });

  it('renames, reorders, changes options and switches a field off, but never its key or type', async () => {
    const [visa, employer] = await defs();
    const edited = await patch(
      editField,
      `${API}?id=${visa!.id}`,
      { label: 'Visa', options: ['Resident', 'Visit', 'Golden', 'Investor'], displayOrder: 5 },
      admin,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect((await patch(editField, `${API}?id=${visa!.id}`, { type: 'TEXT' }, admin)).status).toBe(422);
    expect((await patch(editField, `${API}?id=${visa!.id}`, { key: 'other' }, admin)).status).toBe(422);
    expect((await patch(editField, `${API}?id=${employer!.id}`, { isRequired: false }, admin)).status).toBe(200);
    expect((await defs()).map((d) => d.key)).toEqual(['employer', 'family_size', 'visa_expiry', 'visa_status']);
    expect((await defs()).find((d) => d.key === 'visa_status')).toMatchObject({
      label: 'Visa',
      options: ['Resident', 'Visit', 'Golden', 'Investor'],
    });
  });

  it('is for administrators: reading needs settings:VIEW, changing it settings:MANAGE_CONFIGURATION', async () => {
    expect((await get(listFields, API, agent)).status).toBe(200);
    expect((await post(addField, API, { label: 'Agent field', type: 'TEXT' }, agent)).status).toBe(403);
    const [visa] = await defs();
    expect((await patch(editField, `${API}?id=${visa!.id}`, { label: 'x' }, agent)).status).toBe(403);
    // Another workspace's field is not this one's to change.
    expect((await patch(editField, `${API}?id=${visa!.id}`, { label: 'x' }, fixture.b.cookie)).status).toBe(404);
    expect((await defs(fixture.b.cookie)).map((d) => d.key)).toEqual([]);
  });

  it('the screen lists the fields', async () => {
    const text = await pageText(CustomFieldsPage());
    for (const shown of ['Custom fields', 'Visa', 'Employer', 'Family size', 'Visa expiry', 'Investor']) {
      expect(text).toContain(shown);
    }
  });
});

describe('the fields on a lead (M4-13)', () => {
  it('an agent fills them on a lead they work, each checked by type; system keys are kept', async () => {
    const res = await patch(
      patchLead,
      leadUrl(agentLeadId),
      { custom: { visa_status: 'Golden', family_size: '4', visa_expiry: '2027-06-30', employer: 'Emirates' } },
      agent,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: agentLeadId } });
    expect(row.customData).toEqual({
      metaLeadgen: { formId: 'f-1' },
      visa_status: 'Golden',
      family_size: 4,
      visa_expiry: '2027-06-30',
      employer: 'Emirates',
    });
    const values = await prisma.leadCustomFieldValue.findMany({
      where: { tenantId, leadId: agentLeadId },
      include: { definition: { select: { key: true } } },
    });
    const byKey = Object.fromEntries(values.map((v) => [v.definition.key, v]));
    expect(byKey.visa_status).toMatchObject({ valueText: 'Golden' });
    expect(byKey.family_size!.valueNumber!.toString()).toBe('4');
    expect(byKey.visa_expiry!.valueDate!.toISOString()).toBe('2027-06-30T00:00:00.000Z');
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, recordId: agentLeadId, fieldKey: 'customData' } }),
    ).not.toBeNull();

    // Cleared: the key goes, and so does its value row.
    expect((await patch(patchLead, leadUrl(agentLeadId), { custom: { employer: null } }, agent)).status).toBe(200);
    expect(
      (
        (await prisma.lead.findFirstOrThrow({ where: { tenantId, id: agentLeadId } })).customData as Record<
          string,
          unknown
        >
      ).employer,
    ).toBeUndefined();
    expect(byKey.employer).toBeDefined();
    expect(
      await prisma.leadCustomFieldValue.count({
        where: { tenantId, leadId: agentLeadId, definitionId: byKey.employer!.definitionId },
      }),
    ).toBe(0);
  });

  it('refuses a value of the wrong type, an option not offered, a date that does not exist, an unknown or switched-off field, and an empty required one', async () => {
    const [, , , visa] = await defs();
    const employer = (await defs()).find((d) => d.key === 'employer')!;
    await patch(editField, `${API}?id=${employer.id}`, { isRequired: true }, admin);
    const cases: [Record<string, unknown>, string][] = [
      [{ family_size: 'four' }, 'Family size'],
      [{ visa_status: 'Tourist' }, 'Visa'],
      [{ visa_expiry: '2027-02-30' }, 'Visa expiry'],
      // Larger than the value column holds (Decimal(20,6)): refused by name, not a 500.
      [{ family_size: '1e15' }, 'Family size'],
      [{ shoe_size: '42' }, 'shoe_size'],
      [{ employer: '' }, 'Employer'],
    ];
    for (const [custom, named] of cases) {
      const res = await patch(patchLead, leadUrl(agentLeadId), { custom }, agent);
      expect(res.status, JSON.stringify(custom)).toBe(422);
      expect(res.body.detail).toContain(named);
    }
    await patch(editField, `${API}?id=${visa!.id}`, { isActive: false }, admin);
    expect((await patch(patchLead, leadUrl(agentLeadId), { custom: { visa_status: 'Visit' } }, agent)).status).toBe(
      422,
    );
    await patch(editField, `${API}?id=${visa!.id}`, { isActive: true }, admin);
    await patch(editField, `${API}?id=${employer.id}`, { isRequired: false }, admin);
  });

  it('Edit details sends each changed field, and a required one left empty, so saving is refused by its name', async () => {
    const fields = [
      { key: 'employer', isRequired: true },
      { key: 'visa_status', isRequired: false },
      { key: 'added_since', isRequired: false },
    ];
    const start = { employer: '', visa_status: 'Golden' };
    // Only the city changed, and Employer is required and empty: Employer goes too.
    expect(customPatch(fields, { ...start }, start)).toEqual({ employer: null });
    expect(customPatch(fields, { employer: 'Emirates', visa_status: 'Visit ' }, start)).toEqual({
      employer: 'Emirates',
      visa_status: 'Visit',
    });
    expect(customPatch(fields, { employer: 'Emirates', visa_status: '' }, { ...start, employer: 'Emirates' })).toEqual({
      visa_status: null,
    });
    // A field the page loaded without (defined since) reads as empty on either side: no crash, nothing sent.
    expect(customPatch(fields, { employer: 'Emirates', visa_status: 'Golden' }, { employer: 'Emirates' })).toEqual({
      visa_status: 'Golden',
    });
    expect(customPatch(fields, { employer: 'Emirates' }, { employer: 'Emirates' })).toBeUndefined();

    const employer = (await defs()).find((d) => d.key === 'employer')!;
    await patch(editField, `${API}?id=${employer.id}`, { isRequired: true }, admin);
    try {
      const custom = customPatch([{ ...employer, isRequired: true }], { employer: '' }, { employer: '' });
      const res = await patch(patchLead, leadUrl(agentLeadId), { city: 'Sharjah', custom }, agent);
      expect(res.status).toBe(422);
      expect(res.body.detail).toContain('Employer');
      expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: agentLeadId } })).city).not.toBe('Sharjah');
    } finally {
      await patch(editField, `${API}?id=${employer.id}`, { isRequired: false }, admin);
    }
  });

  it('a lead created through the API has its field values checked; a key no field defines is kept as given', async () => {
    const bad = await post(
      createLead,
      '/api/v1/leads',
      { fullName: 'Api Wrong Type', custom: { family_size: '1.5M' } },
      admin,
    );
    expect(bad.status, JSON.stringify(bad.body)).toBe(422);
    expect(bad.body.detail).toContain('Family size');
    const huge = await post(
      createLead,
      '/api/v1/leads',
      { fullName: 'Api Too Big', custom: { family_size: 1e15 } },
      admin,
    );
    expect(huge.status).toBe(422);
    expect(await prisma.lead.count({ where: { tenantId, fullName: { in: ['Api Wrong Type', 'Api Too Big'] } } })).toBe(
      0,
    );

    const ok = await post(
      createLead,
      '/api/v1/leads',
      {
        fullName: 'Api Typed Lead',
        custom: { family_size: '4', visa_expiry: '2027-06-30', visa_status: '', crm_ref: 'X-1' },
      },
      admin,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: ok.body.id } });
    expect(row.customData).toEqual({ family_size: 4, visa_expiry: '2027-06-30', crm_ref: 'X-1' });
    const values = await prisma.leadCustomFieldValue.findMany({
      where: { tenantId, leadId: ok.body.id },
      include: { definition: { select: { key: true } } },
    });
    expect(values.map((v) => v.definition.key).sort()).toEqual(['family_size', 'visa_expiry']);
  });

  it("follows the lead's scope: another's lead answers 404 before any check", async () => {
    const other = fixture.a.leadIds[0]!;
    expect((await patch(patchLead, leadUrl(other), { custom: { family_size: 'four' } }, agent)).status).toBe(404);
    expect((await patch(patchLead, leadUrl(other), { custom: { family_size: 2 } }, fixture.b.cookie)).status).toBe(404);
  });

  it('the Overview shows each active field with its value', async () => {
    cookieJar.value = admin;
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: agentLeadId }) }));
    for (const shown of ['Visa', 'Golden', 'Family size', 'Visa expiry', '2027-06-30', 'Resident']) {
      expect(text).toContain(shown);
    }
    expect(text).not.toContain('metaLeadgen');
  });

  it('the grid can show a field as a column', async () => {
    // Every provisioned workspace has its settings row; the fixture's does not.
    await prisma.organizationSetting.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    const catalogue = (await get(readColumns, '/api/v1/admin/grid-columns?object=LEAD', admin)).body;
    expect(catalogue.catalogue.map((c: { key: string }) => c.key)).toContain('cf:visa_status');
    expect(
      (await put(saveColumns, '/api/v1/admin/grid-columns', { object: 'LEAD', columns: ['stage', 'cf:nope'] }, admin))
        .status,
    ).toBe(422);
    const saved = await put(
      saveColumns,
      '/api/v1/admin/grid-columns',
      { object: 'LEAD', columns: ['stage', 'cf:visa_status', 'cf:visa_expiry'] },
      admin,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.columns).toEqual(['reference', 'fullName', 'stage', 'cf:visa_status', 'cf:visa_expiry']);

    cookieJar.value = admin;
    // The leads list and a smart view alike; a date reads DD/MM/YYYY, as on the Overview.
    for (const page of [
      LeadsPage({ searchParams: Promise.resolve({}) }),
      SmartViewsPage({ searchParams: Promise.resolve({}) }),
    ]) {
      const text = await pageText(page);
      expect(text).toContain('Visa');
      expect(text).toContain('Golden');
      expect(text).toContain('30/06/2027');
      expect(text).not.toContain('2027-06-30');
    }
  });

  it('only the chosen columns of customData reach a grid row', () => {
    const columns = [
      { key: 'stage', label: 'Stage' },
      { key: 'cf:visa_status', label: 'Visa' },
      { key: 'cf:visa_expiry', label: 'Visa expiry', date: true },
    ];
    const data = { visa_status: 'Golden', visa_expiry: '2027-06-30', family_size: 4, metaLeadgen: { formId: 'f-1' } };
    expect(customCells(columns, data)).toEqual({ 'cf:visa_status': 'Golden', 'cf:visa_expiry': '30/06/2027' });
    expect(customCells(columns, null)).toEqual({ 'cf:visa_status': null, 'cf:visa_expiry': null });
  });
});

describe('required on create, the Add lead form and the CSV export (M18-03)', () => {
  it('a person creating a lead without a required field gets 422; an API key still lands its lead', async () => {
    const added = await post(addField, API, { label: 'Passport ref', type: 'TEXT', isRequired: true }, admin);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    try {
      const missing = await post(createLead, '/api/v1/leads', { fullName: 'No Passport' }, admin);
      expect(missing.status, JSON.stringify(missing.body)).toBe(422);
      expect(missing.body.errors).toEqual([expect.objectContaining({ field: 'custom.passport_ref' })]);
      expect(
        (await post(createLead, '/api/v1/leads', { fullName: 'Blank Passport', custom: { passport_ref: ' ' } }, admin))
          .status,
      ).toBe(422);

      // An integration that leaves the field out still lands its lead, as intake does.
      const { roleId } = await prisma.user.findFirstOrThrow({
        where: { tenantId, id: fixture.a.userId },
        select: { roleId: true },
      });
      const { key } = await issueApiKey(tenantId, 'cf-required', roleId, [], fixture.a.userId);
      const machine = await post(createLead, '/api/v1/leads', { fullName: 'Machine Passport' }, { apiKey: key });
      expect(machine.status, JSON.stringify(machine.body)).toBe(200);

      const ok = await post(
        createLead,
        '/api/v1/leads',
        { fullName: 'Has Passport', custom: { passport_ref: 'P-778' } },
        admin,
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);

      // The Add lead form offers the workspace's active fields, the required one starred.
      cookieJar.value = admin;
      const form = await pageText(NewLeadPage());
      expect(form).toContain('Passport ref');
      expect(form).toContain('passport_ref');

      // The value goes out in the CSV when its column is chosen.
      const res = await exportLeads(
        new Request('http://localhost/api/v1/leads/export?cols=fullName,cf:passport_ref&q=Has%20Passport', {
          headers: { cookie: admin },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);
      const csv = await res.text();
      expect(csv).toContain('"Passport ref"');
      expect(csv).toContain('"Has Passport","P-778"');
    } finally {
      await patch(editField, `${API}?id=${added.body.id}`, { isRequired: false, isActive: false }, admin);
    }
  });
});

describe('the lead form layout (M18-04)', () => {
  /** The props of the first element in a rendered tree that carries `prop`. */
  const propsWith = (node: any, prop: string): any => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = propsWith(child, prop);
        if (found) return found;
      }
      return null;
    }
    if (node.props?.[prop] !== undefined) return node.props;
    return propsWith(node.props?.children, prop);
  };
  const LAYOUT = '/api/v1/lead-form-layout';

  it('fills in what was not stored, keeps stored order, never hides a fixed field', () => {
    const layout = leadFormLayout([
      { key: 'priority', hidden: false },
      { key: 'phone', hidden: true },
      { key: 'secondaryPhone', hidden: true },
      { key: 'company', hidden: true },
    ]);
    expect(layout.slice(0, 3).map((f) => [f.key, f.hidden])).toEqual([
      ['priority', false],
      ['phone', false],
      ['company', true],
    ]);
    expect(layout.map((f) => f.key)).toHaveLength(12);
    expect(leadFormLayout(null).every((f) => !f.hidden)).toBe(true);
  });

  it('an administrator hides and reorders fields; the Add lead form and the lead page follow', async () => {
    const saved = await put(
      saveLayout,
      LAYOUT,
      {
        fields: [
          { key: 'priority', hidden: false },
          { key: 'company', hidden: true },
          { key: 'otherNumbers', hidden: true },
          { key: 'phone', hidden: true },
        ],
      },
      admin,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    try {
      expect(saved.body.fields.find((f: { key: string }) => f.key === 'phone').hidden).toBe(false);
      expect(
        await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'settings', event: 'RECORD_UPDATED' } }),
      ).not.toBeNull();

      cookieJar.value = admin;
      const form = propsWith(await NewLeadPage(), 'layout');
      const keys = form.layout.map((f: { key: string }) => f.key);
      expect(keys[0]).toBe('priority');
      expect(keys).not.toContain('company');
      expect(keys).toContain('phone');

      const detail = propsWith(await LeadDetailPage({ params: Promise.resolve({ id: agentLeadId }) }), 'hiddenFields');
      expect(detail.hiddenFields.sort()).toEqual(['company', 'otherNumbers']);

      // The editor shows the stored layout.
      expect(propsWith(await CustomFieldsPage(), 'fields').fields).toBeTruthy();
    } finally {
      await put(saveLayout, LAYOUT, { fields: [] }, admin);
    }
  });

  it('refuses an unknown field, a field twice, and a role that may not configure settings', async () => {
    expect((await put(saveLayout, LAYOUT, { fields: [{ key: 'salary', hidden: true }] }, admin)).status).toBe(422);
    expect(
      (
        await put(
          saveLayout,
          LAYOUT,
          {
            fields: [
              { key: 'email', hidden: true },
              { key: 'email', hidden: false },
            ],
          },
          admin,
        )
      ).status,
    ).toBe(422);
    expect((await put(saveLayout, LAYOUT, { fields: [{ key: 'email', hidden: true }] }, agent)).status).toBe(403);
  });
});

describe('a Lead-Eagle-only workspace (M4-13)', () => {
  it('defines a field and fills it on a lead', async () => {
    const b = fixture.b.tenantId;
    await prisma.moduleEntitlement.deleteMany({ where: { tenantId: b } });
    await prisma.moduleEntitlement.create({ data: { tenantId: b, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    await invalidateEntitlements(b);

    expect((await post(addField, API, { label: 'Nationality group', type: 'TEXT' }, fixture.b.cookie)).status).toBe(
      200,
    );
    const res = await patch(
      patchLead,
      leadUrl(fixture.b.leadIds[0]!),
      { custom: { nationality_group: 'GCC' } },
      fixture.b.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // A workspace with no lead product is refused.
    await prisma.moduleEntitlement.updateMany({ where: { tenantId: b }, data: { module: 'HRMS' } });
    await invalidateEntitlements(b);
    expect((await get(listFields, API, fixture.b.cookie)).status).toBe(403);
  });
});
