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

import { prisma } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { POST as formCreate } from '@/app/api/v1/forms/route';
import { POST as landingCreate } from '@/app/api/v1/landing-pages/route';
import { GET as publicFormGet, POST as publicFormPost } from '@/app/api/v1/public/forms/route';
import FormsPage from '@/app/(workspace)/[workspaceSlug]/sales/forms/page';
import LandingPagesPage from '@/app/(workspace)/[workspaceSlug]/sales/landing-pages/page';
import { handleJob } from '@/workers/jobs';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { pageText } from '../helpers/render';
import { get, post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

/**
 * Website forms and landing pages for a Lead-Eagle-only workspace (audit rows
 * M6-06 and M6-09): its administrator publishes a form and a landing page, a
 * submission from a site becomes a lead with the right source through the
 * portals' intake — audited, its number normalised, handed to the distribution
 * rule — and a workspace without a lead module has no public form at all.
 */
const suffix = randomBytes(4).toString('hex');
const slug = `eagle-forms-${suffix}`;
const pageSlug = `launch-${suffix}`;
/** A UAE mobile as a visitor types it; unique per call. */
const phone = () => `05${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`;
const normalised = (raw: string) => `+971${raw.slice(1)}`;

let tenantId = '';
let cookie = '';
let agentId = '';
let form: { id: string; key: string };

const submit = (answers: Record<string, string>, page?: string) =>
  post(publicFormPost, '/api/v1/public/forms', {
    workspace: slug,
    form: form.key,
    answers,
    ...(page ? { page } : {}),
  });
const screen = (page: typeof FormsPage) =>
  pageText(page({ params: Promise.resolve({ workspaceSlug: slug }), searchParams: Promise.resolve({}) }));

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Eagle Forms LLC', displayName: 'Eagle Forms', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [
    ['forms', 'VIEW'],
    ['forms', 'CREATE'],
    ['forms', 'MANAGE_CONFIGURATION'],
    ['landingpages', 'VIEW'],
    ['landingpages', 'CREATE'],
    ['leads', 'VIEW'],
  ]);
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `admin@${slug}.test`,
    fullName: 'Eagle Admin',
  });
  cookie = await createSessionToken(tenantId, admin.id);
  const agent = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `agent@${slug}.test`,
    fullName: 'Eagle Agent',
  });
  agentId = agent.id;
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
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
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

describe('a submission from a site', () => {
  it('becomes a lead with source Website form — audited, normalised, handed to the distribution rule', async () => {
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

    // What the distribution queue runs next: the rule names the agent.
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

  it('through a landing page carries source Landing page and scores on that page', async () => {
    const raw = phone();
    const res = await submit({ full_name: 'Campaign Visitor', phone: raw }, pageSlug);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: normalised(raw) } });
    expect(lead).toMatchObject({ source: 'LANDING_PAGE', sourceDetail: `landing:${pageSlug}` });
    const page = await prisma.landingPage.findFirstOrThrow({ where: { tenantId, slug: pageSlug } });
    expect(page.submissionCount).toBe(1);
  });

  it('names a page the form is not on: a plain website-form lead, and nothing scored', async () => {
    const raw = phone();
    expect((await submit({ full_name: 'Stray Visitor', phone: raw }, 'no-such-page')).status).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: normalised(raw) } });
    expect(lead).toMatchObject({ source: 'PUBLIC_FORM', sourceDetail: form.key });
  });

  it('is a 404 for a workspace whose lead module has lapsed, and makes nothing', async () => {
    const where = { tenantId_module: { tenantId, module: 'LEAD_EAGLE' as const } };
    await prisma.moduleEntitlement.update({ where, data: { state: 'CANCELED' } });
    await invalidateEntitlements(tenantId);
    try {
      expect((await get(publicFormGet, `/api/v1/public/forms?workspace=${slug}&form=${form.key}`)).status).toBe(404);
      const raw = phone();
      expect((await submit({ full_name: 'Late Visitor', phone: raw })).status).toBe(404);
      expect(await prisma.lead.count({ where: { tenantId, phoneNormalized: normalised(raw) } })).toBe(0);
    } finally {
      await prisma.moduleEntitlement.update({ where, data: { state: 'ACTIVE' } });
      await invalidateEntitlements(tenantId);
    }
  });
});
