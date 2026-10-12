import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Forms and Landing Pages screens read their session the way Next serves it.
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
// The real queue, watched: a submission must hand its lead to distribution itself.
vi.mock('@/lib/queue', async (importOriginal) => {
  const queue = await importOriginal<typeof import('@/lib/queue')>();
  return { ...queue, enqueue: vi.fn(queue.enqueue) };
});

import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { clear as clearLimit } from '@/lib/security/ratelimit';
import { POST as formCreate } from '@/app/api/v1/forms/route';
import { POST as landingCreate } from '@/app/api/v1/landing-pages/route';
import { GET as publicFormGet, POST as publicFormPost } from '@/app/api/v1/public/forms/route';
import FormsPage from '@/app/(workspace)/[workspaceSlug]/sales/forms/page';
import LandingPagesPage from '@/app/(workspace)/[workspaceSlug]/sales/landing-pages/page';
import RealtyFormsPage from '@/app/(workspace)/[workspaceSlug]/realty/forms/page';
import PublicFormPage from '@/app/f/[workspaceSlug]/[formKey]/page';
import PublicLandingPage from '@/app/l/[workspaceSlug]/[pageSlug]/page';
import CapturePage from '@/app/c/[workspaceSlug]/[key]/page';
import { handleJob } from '@/workers/jobs';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { pageText } from '../helpers/render';
import { get, post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

/**
 * Website forms and landing pages for a Lead-Eagle-only workspace (audit rows
 * M6-06 and M6-09): its administrator publishes a form and a landing page, a
 * submission from a site becomes a lead with the right source through the
 * portals' intake — audited, its number normalised, queued for the distribution
 * rule — and a workspace without a lead module has no public form at all.
 */
const suffix = randomBytes(4).toString('hex');
const slug = `eagle-forms-${suffix}`;
const pageSlug = `launch-${suffix}`;
/** A UAE mobile as a visitor types it; never the same twice in a run. */
let dialled = 0;
const phone = () => `05${String(Date.now()).slice(-6)}${String(dialled++).padStart(2, '0')}`;
const normalised = (raw: string) => `+971${raw.slice(1)}`;

let tenantId = '';
let cookie = '';
let agentId = '';
let form: { id: string; key: string };

const submit = async (answers: Record<string, string>, page?: string, formKey = form.key) => {
  // Ten a minute per visitor, and every request here comes from the same unknown address.
  await clearLimit({ key: 'route:forms:CREATE:unknown', max: 10, windowSeconds: 60 });
  return post(publicFormPost, '/api/v1/public/forms', {
    workspace: slug,
    form: formKey,
    answers,
    ...(page ? { page } : {}),
  });
};
const screen = (page: typeof FormsPage, workspaceSlug = slug) =>
  pageText(page({ params: Promise.resolve({ workspaceSlug }), searchParams: Promise.resolve({}) }));
/** The submission itself queued the lead for the distribution rule. */
const queuedForDistribution = (leadId: string) =>
  vi
    .mocked(enqueue)
    .mock.calls.some(
      ([queue, job, payload, opts]) =>
        queue === 'distribution' && job === 'assign-lead' && payload.leadId === leadId && !opts?.skip,
    );

/** A workspace on one lead module, its administrator signed in, and an agent beside them. */
async function workspace(module: 'LEAD_EAGLE' | 'REAL_ESTATE', workspaceSlug: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: workspaceSlug, legalName: `${workspaceSlug} LLC`, displayName: workspaceSlug, status: 'ACTIVE' },
  });
  await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module, state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenant.id, role.id, [
    ['forms', 'VIEW'],
    ['forms', 'CREATE'],
    ['forms', 'MANAGE_CONFIGURATION'],
    ['landingpages', 'VIEW'],
    ['landingpages', 'CREATE'],
    ['leads', 'VIEW'],
  ]);
  const admin = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: role.id,
    email: `admin@${workspaceSlug}.test`,
    fullName: 'Forms Admin',
  });
  const agent = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: role.id,
    email: `agent@${workspaceSlug}.test`,
    fullName: 'Forms Agent',
  });
  return { tenantId: tenant.id, cookie: await createSessionToken(tenant.id, admin.id), agentId: agent.id };
}

const realtySlug = `realty-forms-${suffix}`;
let realtyTenantId = '';

beforeAll(async () => {
  ({ tenantId, cookie, agentId } = await workspace('LEAD_EAGLE', slug));
  await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
  });
  await prisma.distributionRule.create({
    data: {
      tenantId,
      name: 'Website leads',
      objectType: 'LEAD',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: [agentId] },
    },
  });
});

afterAll(async () => {
  for (const id of [tenantId, realtyTenantId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
});

describe('a Lead-Eagle-only workspace publishes a form and a landing page', () => {
  it('creates a published form', async () => {
    const res = await post(formCreate, '/api/v1/forms', { name: `Contact ${suffix}`, publish: true }, cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    form = res.body;
  });

  it('creates a published landing page carrying the form', async () => {
    const res = await post(
      landingCreate,
      '/api/v1/landing-pages',
      { name: `Launch ${suffix}`, slug: pageSlug, headline: 'Own the Marina view', formId: form.id, publish: true },
      cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.state).toBe('PUBLISHED');
  });

  it('shows both screens to the administrator', async () => {
    cookieJar.value = cookie;
    expect(await screen(FormsPage)).toContain(`Contact ${suffix}`);
    expect(await screen(LandingPagesPage)).toContain(`Launch ${suffix}`);
  });
});

describe('a Real-Estate-only workspace', () => {
  it('publishes a form and sees it under Real Estate', async () => {
    const realty = await workspace('REAL_ESTATE', realtySlug);
    realtyTenantId = realty.tenantId;
    const res = await post(formCreate, '/api/v1/forms', { name: `Viewing ${suffix}`, publish: true }, realty.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    cookieJar.value = realty.cookie;
    expect(await screen(RealtyFormsPage, realtySlug)).toContain(`Viewing ${suffix}`);
  });
});

describe('a submission from a site', () => {
  it('becomes a lead with source PUBLIC_FORM — audited, normalised, queued for the distribution rule', async () => {
    const raw = phone();
    const res = await submit({
      full_name: 'Site Visitor',
      phone: raw,
      email: 'Visitor@Example.com',
      message: 'Two beds in the Marina',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId, phoneNormalized: normalised(raw) },
      include: { submissions: true },
    });
    expect(lead).toMatchObject({
      fullName: 'Site Visitor',
      email: 'visitor@example.com',
      source: 'PUBLIC_FORM',
      sourceDetail: form.key,
      consentStatus: 'IMPLIED',
      ownerId: null,
    });
    expect(lead.submissions).toHaveLength(1);
    expect(lead.submissions[0]!.payload).toMatchObject({
      full_name: 'Site Visitor',
      message: 'Two beds in the Marina',
    });
    // Every lead write is audited; the enquiry's own words are on the timeline.
    expect(
      await prisma.auditLog.count({
        where: { tenantId, event: 'RECORD_CREATED', objectType: 'lead', recordId: lead.id },
      }),
    ).toBe(1);
    expect(
      await prisma.activity.count({
        where: { tenantId, leadId: lead.id, notes: { contains: 'Two beds in the Marina' } },
      }),
    ).toBe(1);

    // The submission queued it; the job the queue runs then lets the rule name the agent.
    expect(queuedForDistribution(lead.id)).toBe(true);
    await handleJob('distribution', { name: 'assign-lead', data: { tenantId, leadId: lead.id } });
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id } })).ownerId).toBe(agentId);
  });

  it('attaches a repeat from the same number to the same lead', async () => {
    const raw = phone();
    expect((await submit({ full_name: 'Twice Visitor', phone: raw })).status).toBe(200);
    expect((await submit({ full_name: 'Twice Visitor', phone: `+971${raw.slice(1)}` })).status).toBe(200);
    const leads = await prisma.lead.findMany({ where: { tenantId, phoneNormalized: normalised(raw) } });
    expect(leads).toHaveLength(1);
    expect(await prisma.formSubmission.count({ where: { tenantId, leadId: leads[0]!.id } })).toBe(2);
  });

  it('attaches a repeat by email, whatever its case, and tells the owner', async () => {
    const email = `mail.${suffix}@example.com`;
    expect((await submit({ full_name: 'Mail Visitor', phone: phone(), email })).status).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email } });
    await handleJob('distribution', { name: 'assign-lead', data: { tenantId, leadId: lead.id } });

    const again = await submit({ full_name: 'Mail Visitor', phone: phone(), email: email.toUpperCase() });
    expect(again.status).toBe(200);
    expect(await prisma.lead.count({ where: { tenantId, fullName: 'Mail Visitor' } })).toBe(1);
    expect(await prisma.formSubmission.count({ where: { tenantId, leadId: lead.id } })).toBe(2);
    expect(
      await prisma.notification.count({
        where: { tenantId, userId: agentId, kind: 'lead.enquiry', recordId: lead.id },
      }),
    ).toBe(1);
  });

  it('never attaches by name alone: a namesake on another number is a lead of their own', async () => {
    expect((await submit({ full_name: 'Common Name', phone: phone() })).status).toBe(200);
    expect((await submit({ full_name: 'Common Name', phone: phone() })).status).toBe(200);
    expect(await prisma.lead.count({ where: { tenantId, fullName: 'Common Name' } })).toBe(2);
  });

  it('keeps contact answers the form does not map off the timeline note', async () => {
    const extra = await prisma.form.create({
      data: {
        tenantId,
        key: `extra-${suffix}`,
        name: 'Extra fields',
        purpose: 'LEAD_CAPTURE',
        targetObject: 'LEAD',
        state: 'PUBLISHED',
        isPublic: true,
        fields: {
          create: (
            [
              ['full_name', 'Your name', 'TEXT', 'fullName'],
              ['phone', 'Phone', 'PHONE', 'phone'],
              ['alt_phone', 'Alternate number', 'PHONE', null],
              ['office_email', 'Office email', 'EMAIL', null],
              ['budget', 'Budget', 'TEXT', null],
            ] as const
          ).map(([key, label, type, mapsToField], position) => ({ tenantId, key, label, type, position, mapsToField })),
        },
      },
    });
    const [main, alternate] = [phone(), phone()];
    const office = `office.${suffix}@example.com`;
    const res = await submit(
      { full_name: 'Detail Visitor', phone: main, alt_phone: alternate, office_email: office, budget: 'AED 2M' },
      undefined,
      extra.key,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId, phoneNormalized: normalised(main) },
      include: { phones: true, submissions: true },
    });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId, leadId: lead.id } });
    expect(note.notes).toContain('Budget: AED 2M');
    expect(note.notes).not.toContain(alternate);
    expect(note.notes).not.toContain(office);
    // The second number is one of the lead's numbers, masked like the first; the address stays in the submission.
    expect(lead.phones.map((p) => p.normalized)).toContain(normalised(alternate));
    expect(lead.submissions[0]!.payload).toMatchObject({ office_email: office });
  });

  it('through a landing page carries source LANDING_PAGE, scores on that page and is queued for distribution', async () => {
    const raw = phone();
    const res = await submit({ full_name: 'Campaign Visitor', phone: raw }, pageSlug);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: normalised(raw) } });
    expect(lead).toMatchObject({ source: 'LANDING_PAGE', sourceDetail: `landing:${pageSlug}` });
    expect(queuedForDistribution(lead.id)).toBe(true);
    const page = await prisma.landingPage.findFirstOrThrow({ where: { tenantId, slug: pageSlug } });
    expect(page.submissionCount).toBe(1);
  });

  it('names a page the form is not on: a plain website-form lead, and nothing scored', async () => {
    const raw = phone();
    expect((await submit({ full_name: 'Stray Visitor', phone: raw }, 'no-such-page')).status).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: normalised(raw) } });
    expect(lead).toMatchObject({ source: 'PUBLIC_FORM', sourceDetail: form.key });
  });

  it('names a published page without this form, or a paused page with it: neither scores', async () => {
    const elsewhere = await prisma.landingPage.create({
      data: { tenantId, slug: `elsewhere-${suffix}`, name: 'Elsewhere', state: 'PUBLISHED' },
    });
    const paused = await prisma.landingPage.create({
      data: { tenantId, slug: `paused-${suffix}`, name: 'Paused', state: 'PAUSED', formId: form.id },
    });
    for (const page of [elsewhere, paused]) {
      const raw = phone();
      expect((await submit({ full_name: `Off-page ${page.name}`, phone: raw }, page.slug)).status).toBe(200);
      const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: normalised(raw) } });
      expect(lead, page.name).toMatchObject({ source: 'PUBLIC_FORM', sourceDetail: form.key });
    }
    const counts = await prisma.landingPage.findMany({
      where: { tenantId, id: { in: [elsewhere.id, paused.id] } },
      select: { submissionCount: true },
    });
    expect(counts).toEqual([{ submissionCount: 0 }, { submissionCount: 0 }]);
  });

  it('is a 404 for a workspace whose lead module has lapsed (the API and the pages) and makes nothing', async () => {
    const capture = await prisma.captureLink.create({ data: { tenantId, key: `stand-${suffix}`, label: 'Stand' } });
    const pages = [
      () =>
        PublicFormPage({
          params: Promise.resolve({ workspaceSlug: slug, formKey: form.key }),
          searchParams: Promise.resolve({}),
        }),
      () => PublicLandingPage({ params: Promise.resolve({ workspaceSlug: slug, pageSlug }) }),
      () => CapturePage({ params: Promise.resolve({ workspaceSlug: slug, key: capture.key }) }),
    ];
    // While the module is live, all three render.
    for (const open of pages) await expect(open()).resolves.toBeTruthy();

    const where = { tenantId_module: { tenantId, module: 'LEAD_EAGLE' as const } };
    await prisma.moduleEntitlement.update({ where, data: { state: 'CANCELED' } });
    await invalidateEntitlements(tenantId);
    try {
      expect((await get(publicFormGet, `/api/v1/public/forms?workspace=${slug}&form=${form.key}`)).status).toBe(404);
      const raw = phone();
      expect((await submit({ full_name: 'Late Visitor', phone: raw })).status).toBe(404);
      expect(await prisma.lead.count({ where: { tenantId, phoneNormalized: normalised(raw) } })).toBe(0);
      for (const open of pages) await expect(open()).rejects.toThrow(/;404$/);
    } finally {
      await prisma.moduleEntitlement.update({ where, data: { state: 'ACTIVE' } });
      await invalidateEntitlements(tenantId);
    }
  });
});
