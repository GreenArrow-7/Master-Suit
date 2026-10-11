/**
 * P1-7 — field-level security had no tests at all.
 *
 * `tests/permission/field.spec.ts` was deleted rather than fixed: it asserted
 * against `/api/v1/leads/export` and `/api/v1/reports/run`, neither of which
 * exists, using fabricated fixtures. Deleting it was the right call for that
 * file and left `loadFieldRules`, `applyFieldSecurity`, `stripUneditableFields`
 * and `assertFilterableFields` — the whole of field security — untested.
 *
 * This suite is written against `/api/v1/opportunities`, which is where field
 * security is actually wired, plus unit coverage of the masking strategies. The
 * route half is what matters: field security lives in the serialiser precisely
 * so that it cannot be forgotten on an egress path, and only a test that goes
 * through the route proves the serialiser is still in the path.
 *
 * The binary-search case is the one worth reading. Masking a field is worthless
 * if a caller can filter or sort on it: ten requests recover a masked salary by
 * bisection. `assertFilterableFields` refuses instead of silently dropping the
 * clause, and that refusal is asserted here through the real query parameter.
 *
 * The last block is a lead's main phone and email (M2-06): `leads:` VIEW_SENSITIVE_FIELDS
 * in the role editor is the switch, on every screen and route a lead leaves by.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The lead screens are server components that read the session cookie through
// next/headers; the routes take it from the request, so this only feeds pages.
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
// The dial route's provider: answers as a connected vendor would, without one.
vi.mock('@/lib/integrations/telephony/resolve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/telephony/resolve')>()),
  resolveTelephony: async () => ({
    vendor: 'twilio',
    webhookKey: 'fieldsec',
    callerNumber: '+97145550000',
    recordingEnabled: false,
    consentRequired: false,
    provider: {
      capabilities: [],
      initiateCall: async () => ({ externalCallId: `ext-${Date.now()}`, event: 'CALL_INITIATED' }),
    },
  }),
}));

import { prisma, withPlatformTx } from '@/lib/db';
import {
  applyFieldSecurity,
  assertFilterableFields,
  loadFieldRules,
  stripUneditableFields,
  type FieldRule,
} from '@/lib/security/fieldSecurity';
import { GET as listOpportunities, POST as createOpportunityRoute } from '@/app/api/v1/opportunities/route';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { GET as readLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { GET as exportLeads } from '@/app/api/v1/leads/export/route';
import { POST as addPhone, DELETE as removePhone } from '@/app/api/v1/leads/[id]/phones/route';
import { GET as listCalls, POST as createCall } from '@/app/api/v1/calls/route';
import { GET as readCall } from '@/app/api/v1/calls/[id]/route';
import { POST as dialCall } from '@/app/api/v1/calls/[id]/dial/route';
import { POST as draftFollowUp, PUT as sendFollowUp } from '@/app/api/v1/calls/[id]/follow-up-email/route';
import { GET as sellerDay } from '@/app/api/v1/targets/daily/[userId]/route';
import CallAuditsPage from '@/app/(workspace)/[workspaceSlug]/sales/call-audits/page';
import { executeTool } from '@/lib/ai/assistant/tools';
import { coachingCallList } from '@/services/shared/coachingInsights';
import { runReminderSweep } from '@/services/crm/reminders';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import CallsPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/page';
import { dialable } from '@/components/workspace/CallLink';
import { createSessionToken } from '../helpers/session';
import { buildActor, buildCtx } from '../helpers/ctx';
import { del, get, patch, post } from '../helpers/request';
import { grantPermissions, type Grants, createWorkspaceUser } from '../helpers/fixtures';
import { pageText } from '../helpers/render';

const suffix = randomBytes(4).toString('hex');
const slug = `fieldsec-${suffix}`;

let tenantId = '';
let restrictedRoleId = '';
let openRoleId = '';
const cookies: Record<string, string> = {};
const userIds: Record<string, string> = {};

/** Base64url-encodes a filter tree the way the route's `filter` parameter expects. */
const encodeFilter = (tree: unknown) => Buffer.from(JSON.stringify(tree)).toString('base64url');

const ctxFor = (label: string, roleId: string) =>
  buildCtx(
    buildActor({
      id: userIds[label]!,
      tenantId,
      roleId,
      roleKey: label,
      roleRank: 50,
      permissions: new Map([
        ['opportunities:VIEW', 'ORGANIZATION' as const],
        ['opportunities:CREATE', 'ORGANIZATION' as const],
      ]),
    }),
  );

async function member(label: string, grants: Grants) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, grants);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@fs.test`,
    fullName: label,
  });
  userIds[label] = user.id;
  cookies[label] = await createSessionToken(tenantId, user.id);
  return role.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'FieldSec LLC', displayName: 'FieldSec', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const grants = [
    ['opportunities', 'VIEW'],
    ['opportunities', 'CREATE'],
  ] as const;
  restrictedRoleId = await member('restricted', grants);
  openRoleId = await member('open', grants);

  // The restricted role: cannot see `amount` at all, sees `currency` masked, and
  // may not write `probability`.
  await prisma.fieldPermission.createMany({
    data: [
      {
        tenantId,
        roleId: restrictedRoleId,
        objectType: 'OPPORTUNITY',
        fieldKey: 'amount',
        canView: false,
        canEdit: false,
        maskStrategy: 'HIDE',
      },
      {
        tenantId,
        roleId: restrictedRoleId,
        objectType: 'OPPORTUNITY',
        fieldKey: 'currency',
        canView: false,
        canEdit: false,
        maskStrategy: 'MASK_ALL',
      },
      {
        tenantId,
        roleId: restrictedRoleId,
        objectType: 'OPPORTUNITY',
        fieldKey: 'probability',
        canView: true,
        canEdit: false,
        maskStrategy: null,
      },
    ],
  });

  const pipeline = await prisma.pipeline.create({
    data: { tenantId, key: `pipe-${suffix}`, name: 'Default', isDefault: true },
  });
  const stage = await prisma.pipelineStage.create({
    data: { tenantId, pipelineId: pipeline.id, key: `new-${suffix}`, name: 'New', position: 1 },
  });
  await prisma.opportunity.create({
    data: {
      tenantId,
      name: `Tower deal ${suffix}`,
      reference: `OP-${suffix}`,
      amount: 1_250_000,
      currency: 'AED',
      probability: 40,
      ownerId: userIds.restricted!,
      pipelineId: pipeline.id,
      stageId: stage.id,
    },
  });
});

afterAll(async () => {
  await prisma.workspaceMembership.deleteMany({ where: { tenantId } });
  await prisma.platformUser.deleteMany({ where: { email: { endsWith: `-${suffix}@fs.test` } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe('through the route it is actually wired into', () => {
  it('hides a field the role may not view', async () => {
    const response = await get(listOpportunities, '/api/v1/opportunities', cookies.restricted);
    expect(response.status).toBe(200);
    const row = response.body.data[0];
    // HIDE means the key is absent, not null: a null still tells the caller the
    // field exists and is empty.
    expect(row).not.toHaveProperty('amount');
    expect(row.name).toContain('Tower deal');
  });

  it('masks a field whose rule asks for masking rather than removal', async () => {
    const response = await get(listOpportunities, '/api/v1/opportunities', cookies.restricted);
    const row = response.body.data[0];
    expect(row.currency).toBe('•••');
    expect(row.currency).not.toBe('AED');
  });

  it('returns the real values to a role with no restriction', async () => {
    const response = await get(listOpportunities, '/api/v1/opportunities', cookies.open);
    const row = response.body.data[0];
    expect(row.amount).toBe('1250000');
    expect(row.currency).toBe('AED');
  });

  it('refuses to filter on a hidden field, rather than ignoring the clause', async () => {
    // Silently dropping the clause is the dangerous alternative: the caller gets
    // an unfiltered list and cannot tell, but a caller who *does* know can
    // recover a masked value by bisection over the filter.
    const filter = encodeFilter({ op: 'AND', children: [{ field: 'amount', cmp: 'gt', value: 1000000 }] });
    const response = await get(listOpportunities, `/api/v1/opportunities?filter=${filter}`, cookies.restricted);
    expect(response.status).toBe(403);
    expect(response.body.detail).toMatch(/restricted field/i);
  });

  it('lets the unrestricted role past the field-security gate on the same field', async () => {
    const filter = encodeFilter({ op: 'AND', children: [{ field: 'amount', cmp: 'gt', value: 1000000 }] });
    const response = await get(listOpportunities, `/api/v1/opportunities?filter=${filter}`, cookies.open);

    // The positive control for the case above: the same filter, the same field,
    // a role without the rule — and no 403. That is the whole claim this suite
    // makes, and it is what proves the 403 came from field security rather than
    // from the filter being rejected for some unrelated reason.
    expect(response.status).not.toBe(403);

    // It used to be a 400: FIELD_MAP registered only LEAD, so `filter` on any
    // other list route was rejected as "unknown-object" for every caller. The
    // OPPORTUNITY map exists now, and this line is the one the previous comment
    // said to change on the day it did.
    expect(response.status).toBe(200);

    // And the filter is applied, not merely accepted — the seeded opportunity is
    // 1_250_000, so a `> 1_000_000` filter must keep it while a `> 2_000_000`
    // filter must not. Without this, registering a map that compiled to nothing
    // would pass.
    expect(response.body.data.length).toBeGreaterThan(0);

    const narrower = encodeFilter({ op: 'AND', children: [{ field: 'amount', cmp: 'gt', value: 2000000 }] });
    const empty = await get(listOpportunities, `/api/v1/opportunities?filter=${narrower}`, cookies.open);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
  });

  it('drops an uneditable field from a create payload instead of writing it', async () => {
    const response = await post(
      createOpportunityRoute,
      '/api/v1/opportunities',
      { name: `Smuggled ${suffix}`, amount: 999, tags: [], custom: {} },
      cookies.restricted,
    );
    expect(response.status).toBe(200);

    // `amount` is canEdit:false for this role, so the crafted value must not have
    // reached the database — and the response must not echo it back either.
    const stored = await prisma.opportunity.findFirst({
      where: { tenantId, name: `Smuggled ${suffix}` },
      select: { amount: true },
    });
    // The column defaults to 0 rather than null, so the assertion is that the
    // crafted 999 did not survive — not that the field is empty.
    expect(Number(stored?.amount ?? 0)).not.toBe(999);
    expect(response.body).not.toHaveProperty('amount');
  });
});

describe('rules are scoped to the role that owns them', () => {
  it('loads only this role’s rules', async () => {
    const restricted = await loadFieldRules(ctxFor('restricted', restrictedRoleId), 'OPPORTUNITY');
    const open = await loadFieldRules(ctxFor('open', openRoleId), 'OPPORTUNITY');
    expect([...restricted.keys()].sort()).toEqual(['amount', 'currency', 'probability']);
    expect(open.size).toBe(0);
  });

  it('loads only this object type’s rules', async () => {
    const other = await loadFieldRules(ctxFor('restricted', restrictedRoleId), 'LEAD');
    expect(other.size).toBe(0);
  });
});

describe('masking strategies', () => {
  const rule = (fieldKey: string, maskStrategy: FieldRule['maskStrategy']): [string, FieldRule] => [
    fieldKey,
    { fieldKey, canView: false, canEdit: false, maskStrategy },
  ];
  const ctx = () => ctxFor('restricted', restrictedRoleId);
  const apply = (record: Record<string, unknown>, rules: Map<string, FieldRule>) =>
    applyFieldSecurity(ctx(), 'OPPORTUNITY', rules, record);

  it('MASK_ALL reveals nothing, not even the true length', () => {
    const out = apply({ secret: 'a-very-long-secret-value' }, new Map([rule('secret', 'MASK_ALL')]));
    expect(out.secret).toBe('•••••••••');
    expect(String(out.secret)).not.toContain('secret');
  });

  it('MASK_PARTIAL keeps enough to recognise a record and not enough to use it', () => {
    const out = apply({ iban: 'AE070331234567890123456' }, new Map([rule('iban', 'MASK_PARTIAL')]));
    expect(String(out.iban).startsWith('AE07')).toBe(true);
    expect(String(out.iban).endsWith('56')).toBe(true);
    expect(out.iban).not.toBe('AE070331234567890123456');
  });

  it('MASK_PARTIAL reads a phone number as the country code and the last two digits', () => {
    // The owner's shape (M2-06): the country code and the last two, the spacing as
    // typed — and nothing from the subscriber number before the last two.
    const phone = (value: string) => apply({ phone: value }, new Map([rule('phone', 'MASK_PARTIAL')])).phone;
    expect(phone('+971 50 123 4567')).toBe('+971 •• ••• ••67');
    expect(phone('+971501234567')).toBe('+971•••••••67');
    expect(phone('+1 (555) 123-4567')).toBe('+1 (•••) •••-••67');
    // A local number keeps no prefix: "0501" would leave four digits to guess,
    // and a masked role can still find a lead by its whole number.
    expect(phone('0501234567')).toBe('••••••••67');
    expect(phone('050 123 4567')).toBe('••• ••• ••67');
  });

  it('MASK_PARTIAL does not leak a short value whole', () => {
    const out = apply({ pin: '1234' }, new Map([rule('pin', 'MASK_PARTIAL')]));
    expect(out.pin).toBe('••••');
  });

  it('MASK_EMAIL keeps the domain, which is what makes it useful', () => {
    const out = apply({ email: 'amina.alrashid@example.com' }, new Map([rule('email', 'MASK_EMAIL')]));
    expect(out.email).toBe('a•••••••••••••@example.com');
  });

  it('MASK_EMAIL does not treat a non-address as one', () => {
    const out = apply({ email: 'not-an-address' }, new Map([rule('email', 'MASK_EMAIL')]));
    expect(String(out.email)).toMatch(/^•+$/);
  });

  it('masks null as null rather than as a row of dots', () => {
    const out = apply({ amount: null }, new Map([rule('amount', 'MASK_ALL')]));
    expect(out.amount).toBeNull();
  });

  it('HIDE removes the key entirely', () => {
    const out = apply({ amount: 42, name: 'keep' }, new Map([rule('amount', 'HIDE')]));
    expect(out).not.toHaveProperty('amount');
    expect(out.name).toBe('keep');
  });

  it('a rule with no strategy removes the key too', () => {
    const out = apply({ amount: 42 }, new Map([rule('amount', null)]));
    expect(out).not.toHaveProperty('amount');
  });
});

describe('sensitive fields', () => {
  const ctxWithout = () => ctxFor('restricted', restrictedRoleId);
  const ctxWith = () =>
    buildCtx(
      buildActor({
        id: userIds.restricted!,
        tenantId,
        roleId: restrictedRoleId,
        roleKey: 'restricted',
        roleRank: 50,
        // The module the role editor grants, `opportunities` — not the object
        // type's own name. The check read `opportunity:` (and `lead:`), which no
        // role can be given, so the switch reached nobody.
        permissions: new Map([['opportunities:VIEW_SENSITIVE_FIELDS', 'ORGANIZATION' as const]]),
      }),
    );

  it('are withheld by default, with no rule row needed', () => {
    const out = applyFieldSecurity(ctxWithout(), 'OPPORTUNITY', new Map(), { salary: 100 }, { salary: 'HIDE' });
    expect(out).not.toHaveProperty('salary');
  });

  it('are masked by default when the field names a mask', () => {
    const out = applyFieldSecurity(ctxWithout(), 'OPPORTUNITY', new Map(), { code: 'ABCDEFGH' }, { code: 'MASK_ALL' });
    expect(out.code).toBe('••••••••');
  });

  it('are returned to a role holding VIEW_SENSITIVE_FIELDS', () => {
    const out = applyFieldSecurity(ctxWith(), 'OPPORTUNITY', new Map(), { salary: 100 }, { salary: 'HIDE' });
    expect(out.salary).toBe(100);
  });
});

describe('write and filter guards as units', () => {
  const uneditable = new Map<string, FieldRule>([
    ['amount', { fieldKey: 'amount', canView: true, canEdit: false, maskStrategy: null }],
  ]);

  it('strips only what the role may not write', () => {
    const out = stripUneditableFields(uneditable, { name: 'keep', amount: 999 });
    expect(out).toEqual({ name: 'keep' });
  });

  it('leaves a payload alone when the role has no rules', () => {
    const out = stripUneditableFields(new Map(), { name: 'keep', amount: 999 });
    expect(out).toEqual({ name: 'keep', amount: 999 });
  });

  it('names every blocked field, so the caller can fix the request in one go', () => {
    const hidden = new Map<string, FieldRule>([
      ['amount', { fieldKey: 'amount', canView: false, canEdit: false, maskStrategy: 'HIDE' }],
      ['currency', { fieldKey: 'currency', canView: false, canEdit: false, maskStrategy: 'MASK_ALL' }],
    ]);
    expect(() => assertFilterableFields(hidden, ['amount', 'currency', 'name'])).toThrow(/amount, currency/);
  });

  it('allows filtering on a viewable-but-uneditable field', () => {
    expect(() => assertFilterableFields(uneditable, ['amount'])).not.toThrow();
  });
});

describe("a lead's main phone and email follow leads:VIEW_SENSITIVE_FIELDS (M2-06)", () => {
  const PHONE = '+971 50 123 4567';
  const MASKED_PHONE = '+971 •• ••• ••67';
  const NORMALIZED = '+971501234567';
  const MASKED_NORMALIZED = '+971•••••••67';
  const OTHER = '+971 55 765 4321';
  const MASKED_OTHER = '+971 •• ••• ••21';
  const SECONDARY = '+971 4 555 0199';
  let email = '';
  let maskedEmail = '';
  let leadId = '';
  let leadName = '';
  let maskedRoleId = '';
  let callId = '';
  // The telecaller as a service sees them: no VIEW_SENSITIVE_FIELDS.
  const maskedCtx = () =>
    buildCtx(
      buildActor({
        id: userIds.leadmasked!,
        tenantId,
        roleId: maskedRoleId,
        grants: [
          ['leads', 'VIEW'],
          ['calls', 'VIEW'],
          ['events', 'VIEW'],
        ],
      }),
    );
  const leaks = (value: unknown) => /123 ?4567|1234567/.test(JSON.stringify(value));

  const exportCsv = async (cookie: string) => {
    const res = await exportLeads(new Request('http://localhost/api/v1/leads/export', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    return res.text();
  };
  const leadPage = (cookie: string) => {
    cookieJar.value = cookie;
    return pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
  };
  const listPage = (cookie: string, q?: string) => {
    cookieJar.value = cookie;
    return pageText(LeadsPage({ searchParams: Promise.resolve(q ? { q } : {}) }));
  };

  beforeAll(async () => {
    const grants = [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['leads', 'EXPORT'],
      ['calls', 'VIEW'],
      ['calls', 'CREATE'],
      ['calls', 'EDIT'],
    ] as const;
    // No VIEW_SENSITIVE_FIELDS: the telecaller the switch exists for.
    maskedRoleId = await member('leadmasked', grants);
    await member('leadopen', [...grants, ['leads', 'VIEW_SENSITIVE_FIELDS']]);

    email = `contact.${suffix}@example.com`;
    maskedEmail = `c${'•'.repeat(`contact.${suffix}`.length - 1)}@example.com`;
    leadName = `Amina ${suffix}`;
    // The lead grid and its CSV show phone and email only where the workspace chose them.
    await prisma.organizationSetting.create({ data: { tenantId, gridColumns: { LEAD: ['email', 'phone'] } } });
    const stage = await prisma.leadStage.create({
      data: { tenantId, key: `lead-new-${suffix}`, name: 'New', position: 1, isDefault: true },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        reference: `LD-${suffix}`,
        fullName: leadName,
        phone: PHONE,
        phoneNormalized: NORMALIZED,
        whatsappNumber: NORMALIZED,
        secondaryPhone: SECONDARY,
        email,
        stageId: stage.id,
      },
    });
    leadId = lead.id;
    await prisma.leadPhone.create({
      data: { tenantId, leadId, raw: OTHER, normalized: '+971557654321', label: 'Work', isWhatsapp: true },
    });
    callId = (
      await prisma.call.create({
        data: { tenantId, callerId: userIds.leadmasked!, leadId, recipientNumber: PHONE, status: 'COMPLETED' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.communication.deleteMany({ where: { tenantId } });
    await prisma.call.deleteMany({ where: { tenantId } });
    await prisma.leadPhone.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
  });

  it('masks them on GET /api/v1/leads', async () => {
    const res = await get(listLeads, '/api/v1/leads', cookies.leadmasked);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { id: string }) => r.id === leadId);
    expect(row.phone).toBe(MASKED_PHONE);
    expect(row.email).toBe(maskedEmail);
  });

  it('masks every number on GET /api/v1/leads/{id}', async () => {
    const res = await get(readLead, `/api/v1/leads/${leadId}`, cookies.leadmasked);
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(MASKED_PHONE);
    expect(res.body.phoneNormalized).toBe(MASKED_NORMALIZED);
    expect(res.body.whatsappNumber).toBe(MASKED_NORMALIZED);
    expect(res.body.email).toBe(maskedEmail);
    const body = JSON.stringify(res.body);
    for (const leaked of ['123 4567', '501234567', '555 0199', email]) expect(body).not.toContain(leaked);
  });

  it('masks them in the CSV export', async () => {
    const csv = await exportCsv(cookies.leadmasked);
    expect(csv).toContain(MASKED_PHONE);
    expect(csv).toContain(maskedEmail);
    expect(csv).not.toContain(PHONE);
    expect(csv).not.toContain(email);
  });

  it('masks them on the lead list', async () => {
    const text = await listPage(cookies.leadmasked);
    expect(text).toContain(leadName);
    expect(text).toContain(MASKED_PHONE);
    expect(text).toContain(maskedEmail);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(email);
  });

  it('finds a masked lead by its whole number or address, never by a fragment', async () => {
    // A fragment search is the bisection the filter guard refuses: a few
    // searches would read the number back digit by digit.
    expect(await listPage(cookies.leadmasked, '4567')).not.toContain(leadName);
    expect(await listPage(cookies.leadmasked, `contact.${suffix}`)).not.toContain(leadName);
    // The whole number, as anyone would type it, and the whole address still
    // find the lead: they tell the caller nothing they did not type.
    expect(await listPage(cookies.leadmasked, '050 123 4567')).toContain(leadName);
    expect(await listPage(cookies.leadmasked, email.toUpperCase())).toContain(leadName);
  });

  it('masks them, and the other numbers, on the lead page, with nothing left to dial', async () => {
    const text = await leadPage(cookies.leadmasked);
    expect(text).toContain(leadName);
    expect(text).toContain(MASKED_PHONE);
    expect(text).toContain(maskedEmail);
    expect(text).toContain(MASKED_OTHER);
    for (const leaked of ['123 4567', '501234567', '765 4321', '557654321', email]) expect(text).not.toContain(leaked);
    // What the page's Phone, WhatsApp and number links are built from.
    expect(dialable(MASKED_PHONE)).toBeNull();
    expect(dialable(MASKED_OTHER)).toBeNull();
    expect(dialable(PHONE)).toBe(NORMALIZED);
  });

  it('refuses to add, remove or change a number for a role that cannot see them (403)', async () => {
    const added = await post(
      addPhone,
      `/api/v1/leads/${leadId}/phones`,
      { phone: '+971 52 000 1111' },
      cookies.leadmasked,
    );
    expect(added.status).toBe(403);
    const other = await prisma.leadPhone.findFirstOrThrow({ where: { tenantId, leadId } });
    const removed = await del(removePhone, `/api/v1/leads/${leadId}/phones?phoneId=${other.id}`, cookies.leadmasked);
    expect(removed.status).toBe(403);
    const changed = await patch(
      patchLead,
      `/api/v1/leads/${leadId}`,
      { phone: '+971 52 999 0000' },
      cookies.leadmasked,
    );
    expect(changed.status).toBe(403);
    const rewritten = await patch(patchLead, `/api/v1/leads/${leadId}`, { email: `x.${email}` }, cookies.leadmasked);
    expect(rewritten.status).toBe(403);

    const stored = await prisma.lead.findFirstOrThrow({
      where: { tenantId, id: leadId },
      select: { phone: true, email: true },
    });
    expect(stored).toEqual({ phone: PHONE, email });
    expect(await prisma.leadPhone.count({ where: { tenantId, leadId } })).toBe(1);

    // Everything else on the lead is still theirs to edit, and the answer is masked.
    const edited = await patch(
      patchLead,
      `/api/v1/leads/${leadId}`,
      { company: 'Marina Holdings' },
      cookies.leadmasked,
    );
    expect(edited.status).toBe(200);
    expect(edited.body.phone).toBe(MASKED_PHONE);

    // A lead they cannot reach still answers as a missing one, never 403.
    const missing = `c${'0'.repeat(24)}`;
    const notThere = await post(
      addPhone,
      `/api/v1/leads/${missing}/phones`,
      { phone: '+971 52 000 1111' },
      cookies.leadmasked,
    );
    expect(notThere.status).toBe(404);
    expect((await patch(patchLead, `/api/v1/leads/${missing}`, { phone: PHONE }, cookies.leadmasked)).status).toBe(404);
  });

  it('refuses a filter on a masked field rather than letting it be bisected', async () => {
    const filter = encodeFilter({ op: 'AND', children: [{ field: 'phone', cmp: 'starts', value: '+9715' }] });
    const masked = await get(listLeads, `/api/v1/leads?filter=${filter}`, cookies.leadmasked);
    expect(masked.status).toBe(403);
    expect(masked.body.detail).toMatch(/restricted field/i);
    const open = await get(listLeads, `/api/v1/leads?filter=${filter}`, cookies.leadopen);
    expect(open.status).toBe(200);
  });

  it('masks the number a call to the lead went to, on the calls list and its API', async () => {
    cookieJar.value = cookies.leadmasked;
    const text = await pageText(CallsPage({ searchParams: Promise.resolve({}) }));
    expect(text).toContain(MASKED_PHONE);
    expect(text).not.toContain('123 4567');
    const api = await get(listCalls, '/api/v1/calls', cookies.leadmasked);
    expect(api.status).toBe(200);
    expect(api.body.data.map((c: { recipientNumber: string }) => c.recipientNumber)).toEqual([MASKED_PHONE]);
  });

  it('still places a call by lead id for a masked role, to the real number', async () => {
    // "Call with AI assistance" sends the number the screen holds, which is the
    // masked one; the call has to go to the lead, not to the dots.
    const res = await post(createCall, '/api/v1/calls', { leadId, recipientNumber: MASKED_PHONE }, cookies.leadmasked);
    expect(res.status).toBe(200);
    expect(res.body.recipientNumber).toBe(MASKED_PHONE);
    const stored = await prisma.call.findFirstOrThrow({ where: { tenantId, id: res.body.id } });
    expect(stored.recipientNumber).toBe(PHONE);
    await prisma.call.deleteMany({ where: { tenantId, id: res.body.id } });
  });

  it('returns everything whole to a role holding leads:VIEW_SENSITIVE_FIELDS', async () => {
    const list = await get(listLeads, '/api/v1/leads', cookies.leadopen);
    const row = list.body.data.find((r: { id: string }) => r.id === leadId);
    expect(row.phone).toBe(PHONE);
    expect(row.email).toBe(email);

    const one = await get(readLead, `/api/v1/leads/${leadId}`, cookies.leadopen);
    expect(one.body.phone).toBe(PHONE);
    expect(one.body.phoneNormalized).toBe(NORMALIZED);
    // The secondary number was withheld from every role, holders included: the
    // check read `lead:VIEW_SENSITIVE_FIELDS`, which the role editor cannot grant.
    expect(one.body.secondaryPhone).toBe(SECONDARY);

    const csv = await exportCsv(cookies.leadopen);
    expect(csv).toContain(PHONE);
    expect(csv).toContain(email);

    const page = await leadPage(cookies.leadopen);
    expect(page).toContain(PHONE);
    expect(page).toContain(OTHER);
    expect(await listPage(cookies.leadopen)).toContain(PHONE);

    const added = await post(
      addPhone,
      `/api/v1/leads/${leadId}/phones`,
      { phone: '+971 52 000 1111' },
      cookies.leadopen,
    );
    expect(added.status).toBe(200);
    await prisma.leadPhone.deleteMany({ where: { tenantId, id: added.body.id } });
  });

  it('masks the number a placed call answers with, and on the assistant’s calendar', async () => {
    // "Call with AI assistance", then "Place call": the provider dials the stored
    // number; the answers that carry it back read masked.
    const booked = await post(
      createCall,
      '/api/v1/calls',
      { leadId, recipientNumber: MASKED_PHONE },
      cookies.leadmasked,
    );
    expect(booked.status).toBe(200);
    try {
      const dialled = await post(
        dialCall,
        `/api/v1/calls/${booked.body.id}/dial`,
        { agentNumber: '+971500000001' },
        cookies.leadmasked,
        { id: booked.body.id },
      );
      expect(dialled.status).toBe(200);
      expect(dialled.body.recipientNumber).toBe(MASKED_PHONE);
      expect(leaks(dialled.body)).toBe(false);
      const placed = await prisma.call.findFirstOrThrow({ where: { tenantId, id: booked.body.id } });
      expect(placed.recipientNumber).toBe(PHONE);

      // Still SCHEDULED for the calendar's purposes: the vendor has not called back.
      await prisma.call.updateMany({ where: { tenantId, id: booked.body.id }, data: { status: 'SCHEDULED' } });
      const calendar = await executeTool(maskedCtx(), 'getCalendar', {});
      expect(JSON.stringify(calendar.data)).toContain(MASKED_PHONE);
      expect(leaks(calendar)).toBe(false);
    } finally {
      await prisma.call.deleteMany({ where: { tenantId, id: booked.body.id } });
    }
  });

  it('masks the number on the seller’s own day board, coaching list and call audits', async () => {
    const day = await get(sellerDay, `/api/v1/targets/daily/${userIds.leadmasked}`, cookies.leadmasked, {
      userId: userIds.leadmasked!,
    });
    expect(day.status).toBe(200);
    expect(day.body.calls.map((c: { recipientNumber: string }) => c.recipientNumber)).toEqual([MASKED_PHONE]);
    expect(leaks(day.body)).toBe(false);

    const coaching = await coachingCallList(maskedCtx(), { analysedOnly: false });
    expect(coaching.map((c) => c.recipientNumber)).toEqual([MASKED_PHONE]);

    await prisma.callAudit.create({
      data: { tenantId, callId, scorecardId: 'fieldsec', status: 'COMPLETED', overallScore: 7, maxScore: 10 },
    });
    cookieJar.value = cookies.leadmasked;
    const audits = await pageText(CallAuditsPage());
    expect(audits).toContain(MASKED_PHONE);
    expect(leaks(audits)).toBe(false);
  });

  it("masks the lead's number on an inbound call, where it is the one that rang", async () => {
    const inbound = await prisma.call.create({
      data: {
        tenantId,
        callerId: userIds.leadmasked!,
        leadId,
        direction: 'INBOUND',
        callerNumber: PHONE,
        recipientNumber: '+97145550000',
        status: 'COMPLETED',
      },
    });
    const one = await get(readCall, `/api/v1/calls/${inbound.id}`, cookies.leadmasked);
    expect(one.status).toBe(200);
    expect(one.body.callerNumber).toBe(MASKED_PHONE);
    // The other side is the workspace's own line.
    expect(one.body.recipientNumber).toBe('+97145550000');
    const list = await get(listCalls, '/api/v1/calls', cookies.leadmasked);
    expect(list.status).toBe(200);
    expect(leaks(list.body)).toBe(false);
    expect((await get(readCall, `/api/v1/calls/${inbound.id}`, cookies.leadopen)).body.callerNumber).toBe(PHONE);
    await prisma.call.deleteMany({ where: { tenantId, id: inbound.id } });
  });

  it('drafts and sends the follow-up email without showing a masked address', async () => {
    const draft = await post(draftFollowUp, `/api/v1/calls/${callId}/follow-up-email`, {}, cookies.leadmasked, {
      id: callId,
    });
    expect(draft.status).toBe(200);
    expect(draft.body.to).toBe(maskedEmail);
    const res = await sendFollowUp(
      new Request(`http://localhost/api/v1/calls/${callId}/follow-up-email`, {
        method: 'PUT',
        headers: { cookie: cookies.leadmasked!, 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'After our call', body: 'Thank you.' }),
      }),
      { params: Promise.resolve({ id: callId }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).to).toBe(maskedEmail);
    // The send itself went to the stored address.
    const sent = await prisma.communication.findFirstOrThrow({
      where: { tenantId, leadId },
      select: { toAddress: true },
    });
    expect(sent.toAddress).toBe(email);

    const open = await post(draftFollowUp, `/api/v1/calls/${callId}/follow-up-email`, {}, cookies.leadopen, {
      id: callId,
    });
    expect(open.body.to).toBe(email);
  });

  it('names the lead, never its number, in the bell its owner reads', async () => {
    await prisma.lead.updateMany({ where: { tenantId, id: leadId }, data: { ownerId: userIds.leadmasked! } });
    try {
      // A manager who sees the number books a call on the telecaller's lead,
      // with a follow-up time the reminder sweep picks up.
      const booked = await post(createCall, '/api/v1/calls', { leadId, recipientNumber: PHONE }, cookies.leadopen);
      expect(booked.status).toBe(200);
      await prisma.call.updateMany({
        where: { tenantId, id: booked.body.id },
        data: { followUpAt: new Date(Date.now() + 10 * 60_000) },
      });
      await runReminderSweep();

      const bell = await prisma.notification.findMany({
        where: { tenantId, userId: userIds.leadmasked! },
        select: { kind: true, title: true, body: true },
      });
      expect(bell.map((n) => n.kind).sort()).toEqual(['call.reminder', 'call.scheduled']);
      expect(bell.find((n) => n.kind === 'call.scheduled')!.title).toBe(`Call scheduled with ${leadName}`);
      expect(bell.find((n) => n.kind === 'call.reminder')!.title).toBe(`Call follow-up due: ${leadName}`);
      expect(leaks(bell)).toBe(false);
      await prisma.call.deleteMany({ where: { tenantId, id: booked.body.id } });
    } finally {
      await prisma.lead.updateMany({ where: { tenantId, id: leadId }, data: { ownerId: null } });
    }
  });

  it('is granted on deploy to every role that can already read leads, at the same scope', async () => {
    const sql = readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        'prisma',
        'migrations',
        '20261011000000_lead_contact_sensitive',
        'migration.sql',
      ),
      'utf8',
    );
    const role = (key: string) =>
      prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 60, defaultScope: 'TEAM' } });
    const reader = await role('m-reader');
    const caller = await role('m-caller');
    const other = await role('m-other');
    await grantPermissions(tenantId, reader.id, [['leads', 'VIEW']], 'TEAM');
    await grantPermissions(tenantId, caller.id, [['calls', 'VIEW']], 'OWN');
    await grantPermissions(tenantId, other.id, [['tasks', 'VIEW']], 'TEAM');

    // Only this case's roles: the statements as written, narrowed by one clause.
    const scoped = sql.replaceAll(
      'AND rp."granted"',
      `AND rp."granted" AND rp."roleId" IN ('${reader.id}', '${caller.id}', '${other.id}')`,
    );
    expect(scoped).not.toBe(sql);
    await withPlatformTx(async (tx) => {
      for (const statement of scoped.split(/;\s*\n/).filter((part) => /INSERT INTO/.test(part))) {
        await tx.$executeRawUnsafe(statement);
      }
    });

    const sensitive = (roleId: string) =>
      prisma.rolePermission.findFirst({
        where: { tenantId, roleId, permission: { module: 'leads', action: 'VIEW_SENSITIVE_FIELDS' } },
        select: { granted: true, scope: true },
      });
    expect(await sensitive(reader.id)).toEqual({ granted: true, scope: 'TEAM' });
    // A role reading calls but not leads saw the number on the calls screens.
    expect(await sensitive(caller.id)).toEqual({ granted: true, scope: 'OWN' });
    expect(await sensitive(other.id)).toBeNull();
  });
});
