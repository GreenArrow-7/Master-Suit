/**
 * The front doors added to campaigns, forms, landing pages and automations —
 * each was an engine with no way in. One spec drives the whole loop: create a
 * campaign, attach an audience; create a form, submit it anonymously, get a
 * lead; create an automation and see the published graph the engine expects;
 * create a landing page and read it back public-side.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as campaignCreate } from '@/app/api/v1/campaigns/route';
import { POST as audiencePost } from '@/app/api/v1/campaigns/[id]/audience/route';
import { POST as formCreate } from '@/app/api/v1/forms/route';
import { PATCH as formPatch } from '@/app/api/v1/forms/[id]/route';
import { GET as publicFormGet, POST as publicFormPost } from '@/app/api/v1/public/forms/route';
import { POST as automationCreate } from '@/app/api/v1/automations/route';
import { PATCH as automationPatch } from '@/app/api/v1/automations/[id]/route';
import { POST as landingCreate } from '@/app/api/v1/landing-pages/route';
import { automationGraph } from '@/services/automation/graph';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get, post, patch } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `growth-${suffix}`;

let tenantId = '';
let cookie = '';
let leadId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Growth LLC', displayName: 'Growth', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `growth-${suffix}`, name: 'Growth', rank: 5, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of [
    ['campaigns', 'CREATE'],
    ['campaigns', 'EDIT'],
    ['leads', 'VIEW'],
    ['forms', 'CREATE'],
    ['forms', 'MANAGE_CONFIGURATION'],
    ['landingpages', 'CREATE'],
    ['automation', 'MANAGE_AUTOMATION'],
  ] as const) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `growth-${suffix}@growth.test`,
    fullName: 'Growth Tester',
  });
  cookie = await createSessionToken(tenantId, user.id);

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
  });
  const lead = await prisma.lead.create({
    data: {
      tenantId,
      reference: `GR-${suffix}`,
      fullName: 'Existing Lead',
      stageId: stage.id,
      phone: '+971501234567',
      consentStatus: 'GRANTED',
    },
  });
  leadId = lead.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('campaigns', () => {
  it('creates a campaign and attaches an audience', async () => {
    const created = await post(
      campaignCreate,
      '/api/v1/campaigns',
      { name: `Ramadan Push ${suffix}`, channel: 'WHATSAPP' },
      cookie,
    );
    expect(created.status).toBe(200);
    expect(created.body.code).toContain('RAMADAN');

    const attach = await post(
      audiencePost,
      `/api/v1/campaigns/${created.body.id}/audience`,
      { add: [leadId] },
      cookie,
      { id: created.body.id },
    );
    expect(attach.status).toBe(200);
    expect(attach.body.added).toBe(1);

    const row = await prisma.lead.findFirst({ where: { tenantId, id: leadId }, select: { campaignId: true } });
    expect(row?.campaignId).toBe(created.body.id);
  });
});

describe('forms — the lead-gen loop', () => {
  let formId = '';
  let formKey = '';

  it('creates a published lead-capture form with the standard fields', async () => {
    const created = await post(formCreate, '/api/v1/forms', { name: `Enquiry ${suffix}`, publish: true }, cookie);
    expect(created.status).toBe(200);
    expect(created.body.state).toBe('PUBLISHED');
    formId = created.body.id;
    formKey = created.body.key;

    const fields = await prisma.formField.count({ where: { tenantId, formId } });
    expect(fields).toBe(4);
  });

  it('serves the public definition without authentication', async () => {
    const res = await get(publicFormGet, `/api/v1/public/forms?workspace=${slug}&form=${formKey}`);
    expect(res.status).toBe(200);
    expect(res.body.fields.map((f: { key: string }) => f.key)).toContain('full_name');
  });

  it('turns an anonymous submission into a lead', async () => {
    const res = await post(publicFormPost, '/api/v1/public/forms', {
      workspace: slug,
      form: formKey,
      answers: { full_name: 'Walk-in Visitor', phone: '+971502223344', message: '2BR in the Marina' },
    });
    expect(res.status).toBe(200);

    const lead = await prisma.lead.findFirst({
      where: { tenantId, fullName: 'Walk-in Visitor' },
      include: { submissions: true },
    });
    expect(lead).not.toBeNull();
    expect(lead!.source).toBe('PUBLIC_FORM');
    expect(lead!.submissions.length).toBe(1);
  });

  it('refuses a submission missing a required field', async () => {
    const res = await post(publicFormPost, '/api/v1/public/forms', {
      workspace: slug,
      form: formKey,
      answers: { message: 'no name given' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('goes dark the moment it is paused', async () => {
    const paused = await patch(formPatch, `/api/v1/forms/${formId}`, { state: 'PAUSED' }, cookie, { id: formId });
    expect(paused.status).toBe(200);

    const res = await get(publicFormGet, `/api/v1/public/forms?workspace=${slug}&form=${formKey}`);
    expect(res.status).toBe(404);
  });
});

describe('automations', () => {
  it('creates and publishes a graph the engine accepts', async () => {
    await prisma.taskType.create({
      data: { tenantId, key: `follow-${suffix}`, name: 'Follow up', isActive: true },
    });
    const created = await post(
      automationCreate,
      '/api/v1/automations',
      {
        name: `Welcome task ${suffix}`,
        objectType: 'LEAD',
        event: 'created',
        actionSpec: { action: 'create_task', taskTypeKey: `follow-${suffix}`, title: 'Call the new lead', dueInMinutes: 60 },
        activate: true,
      },
      cookie,
    );
    expect(created.status).toBe(200);
    expect(created.body.state).toBe('PUBLISHED');

    const automation = await prisma.automation.findFirst({
      where: { tenantId, id: created.body.id },
      include: { versions: true },
    });
    expect(automation?.activeVersionId).toBe(automation?.versions[0]?.id);
    // The graph must be one the engine's own schema accepts, or enrollment
    // would silently skip it at trigger time.
    expect(automationGraph.safeParse(automation!.versions[0]!.graph).success).toBe(true);

    const paused = await patch(
      automationPatch,
      `/api/v1/automations/${created.body.id}`,
      { state: 'PAUSED' },
      cookie,
      { id: created.body.id },
    );
    expect(paused.status).toBe(200);
    expect(paused.body.state).toBe('PAUSED');
  });
});

describe('landing pages', () => {
  it('creates a published page whose public route resolves', async () => {
    const created = await post(
      landingCreate,
      '/api/v1/landing-pages',
      { name: `Marina Launch ${suffix}`, headline: 'Own the Marina view', body: 'Two towers. One address.', publish: true },
      cookie,
    );
    expect(created.status).toBe(200);
    expect(created.body.state).toBe('PUBLISHED');

    const page = await prisma.landingPage.findFirst({ where: { tenantId, id: created.body.id } });
    expect(page?.publishedAt).not.toBeNull();
    expect((page?.blocks as { type: string }[]).map((b) => b.type)).toEqual(['headline', 'body']);
  });
});
