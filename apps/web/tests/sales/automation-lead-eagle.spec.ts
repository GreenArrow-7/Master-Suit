import { createHmac, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import https, { type RequestOptions } from 'node:https';
import { Queue, Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

// The automation queue for real, under a name of this file's own: each step of
// an enrollment is a job, and enqueue's job id is a hash of its payload, which a
// test calling runEnrollmentNode in a loop never meets (review of PR #206).
const automationQueue = vi.hoisted(() => `automation-test-${Math.random().toString(36).slice(2, 10)}`);
vi.mock('@/lib/queue', async (importOriginal) => {
  const queue = await importOriginal<typeof import('@/lib/queue')>();
  return {
    ...queue,
    enqueue: (...[name, ...rest]: Parameters<typeof queue.enqueue>) =>
      queue.enqueue((name === 'automation' ? automationQueue : name) as typeof name, ...rest),
  };
});

import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { publicLookup } from '@/lib/security/outboundUrl';
import { handleJob } from '@/workers/jobs';
import { ctxForUser } from '@/lib/auth/session';
import { mockOutbox } from '@/lib/mailer';
import { POST as createAutomation } from '@/app/api/v1/automations/route';
import { PATCH as editAutomation } from '@/app/api/v1/automations/[id]/route';
import { enrollMatchingAutomations, sweepTimeTriggers } from '@/services/automation/engine';
import { runAction } from '@/services/automation/actions';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { patch, post } from '../helpers/request';

/**
 * Automation for a Lead-Eagle-only workspace (audit M7-11, M7-12): its
 * administrator publishes a rule and it runs on the next enquiry; a rule can
 * fire some time after a lead arrives; and a rule can assign the lead, tell
 * the owner's manager, send a template and call a signed webhook.
 */
const suffix = randomBytes(4).toString('hex');
const slug = `eagle-auto-${suffix}`;
let tenantId = '';
let stageId = '';
let cookie = '';
const people: Record<string, string> = {};
let jobs: Queue | undefined;
let worker: Worker | undefined;

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug, legalName: 'Eagle Auto LLC', displayName: 'Eagle Auto', status: 'ACTIVE' },
    })
  ).id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  stageId = (
    await prisma.leadStage.create({
      data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
    })
  ).id;
  await prisma.taskType.create({ data: { tenantId, key: 'call', name: 'Call', category: 'TODO' } });
  const role = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [
    ['automation', 'VIEW'],
    ['automation', 'MANAGE_AUTOMATION'],
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'ASSIGN'],
    ['leads', 'VIEW_SENSITIVE_FIELDS'],
    ['tasks', 'VIEW'],
    ['communications', 'CREATE'],
  ]);
  for (const name of ['admin', 'manager', 'agent', 'closer']) {
    people[name] = (
      await createWorkspaceUser({ tenantId, roleId: role.id, email: `${name}@${slug}.test`, fullName: name })
    ).id;
  }
  await prisma.user.updateMany({ where: { tenantId, id: people.agent }, data: { managerId: people.manager } });
  cookie = await createSessionToken(tenantId, people.admin!);
  jobs = new Queue(automationQueue, { connection: redis });
  worker = new Worker(automationQueue, (job) => handleJob('automation', job), { connection: redis });
});

afterAll(async () => {
  await worker?.close();
  await jobs?.obliterate({ force: true }).catch(() => {});
  await jobs?.close();
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const newLead = (data: Record<string, unknown> = {}) =>
  prisma.lead.create({
    data: { tenantId, reference: `AU-${randomBytes(3).toString('hex')}`, fullName: 'Nadia Karim', stageId, ...data },
  });

const publish = (body: Record<string, unknown>) =>
  post(createAutomation, '/api/v1/automations', { objectType: 'LEAD', activate: true, ...body }, cookie);

/** Waits while the automation queue's worker walks an enrollment, one job per step; a stuck one comes back ACTIVE. */
async function drain(automationId: string, recordId: string) {
  const deadline = Date.now() + 10_000;
  let enrollment;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    enrollment = await prisma.automationEnrollment.findFirstOrThrow({ where: { tenantId, automationId, recordId } });
  } while (enrollment.status === 'ACTIVE' && Date.now() < deadline);
  return enrollment;
}

/** The webhook's HTTPS request, answered 200 without leaving the machine. */
function interceptWebhook() {
  const sent: { url: string; options: RequestOptions; body: string }[] = [];
  vi.spyOn(https, 'request').mockImplementation(((
    url: URL,
    options: RequestOptions,
    onResponse: (response: object) => void,
  ) =>
    Object.assign(new EventEmitter(), {
      destroy: () => {},
      end: (body: string) => {
        sent.push({ url: String(url), options, body });
        onResponse({ statusCode: 200, resume: () => {} });
      },
    })) as unknown as typeof https.request);
  return sent;
}

/** The spec the API stored on the published version's action node. */
async function storedAction(automationId: string) {
  const version = await prisma.automationVersion.findFirstOrThrow({ where: { tenantId, automationId } });
  const graph = version.graph as { nodes: { type: string; spec: Record<string, unknown> }[] };
  return graph.nodes.find((node) => node.type === 'action')!.spec;
}

it('a Lead-Eagle-only administrator publishes "on lead created → create task", and the next enquiry gets it', async () => {
  const created = await publish({
    name: 'Call every new lead',
    event: 'created',
    actionSpec: { action: 'create_task', taskTypeKey: 'call', title: 'Call the new lead', dueInMinutes: 15 },
  });
  expect(created.status).toBe(200);
  expect(created.body.state).toBe('PUBLISHED');

  const lead = await newLead();
  await enrollMatchingAutomations(tenantId, 'record.created', 'LEAD', lead.id);
  expect((await drain(created.body.id, lead.id)).status).toBe('COMPLETED');
  expect(await prisma.task.count({ where: { tenantId, leadId: lead.id, title: 'Call the new lead' } })).toBe(1);

  const paused = await patch(editAutomation, `/api/v1/automations/${created.body.id}`, { state: 'PAUSED' }, cookie, {
    id: created.body.id,
  });
  expect(paused.status).toBe(200);
});

it('a time trigger enrolls a lead once it is old enough, and its condition keeps contacted leads out (M7-11)', async () => {
  const created = await publish({
    name: 'Untouched after two hours',
    event: 'time',
    afterMinutes: 120,
    condition: { field: 'firstContactedAt', cmp: 'is_null' },
    actionSpec: { action: 'notify_manager', template: 'Nobody has called this lead' },
  });
  expect(created.status).toBe(200);
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  const untouched = await newLead({ ownerId: people.agent, createdAt: hoursAgo(3) });
  const contacted = await newLead({ ownerId: people.agent, createdAt: hoursAgo(3), firstContactedAt: hoursAgo(2) });
  const fresh = await newLead({ ownerId: people.agent });

  await sweepTimeTriggers();
  await sweepTimeTriggers(); // once per lead, however often it runs
  const enrolled = await prisma.automationEnrollment.findMany({
    where: { tenantId, automationId: created.body.id },
    select: { recordId: true },
  });
  expect(enrolled.map((e) => e.recordId).sort()).toEqual([untouched.id, contacted.id].sort());
  expect(enrolled.map((e) => e.recordId)).not.toContain(fresh.id);

  await drain(created.body.id, untouched.id);
  await drain(created.body.id, contacted.id);
  // notify_manager reaches the owner's manager (M7-12), and only for the lead nobody contacted.
  const notices = await prisma.notification.findMany({
    where: { tenantId, kind: 'AUTOMATION', title: 'Nobody has called this lead' },
    select: { userId: true, recordId: true },
  });
  expect(notices).toEqual([{ userId: people.manager, recordId: untouched.id }]);
});

it('the time trigger and lead-only actions are refused on other records; a time trigger needs its delay', async () => {
  expect((await publish({ name: 'No delay', event: 'time', actionSpec: { action: 'add_tag', tag: 'x' } })).status).toBe(
    422,
  );
  expect(
    (
      await publish({
        name: 'Assign a contact',
        objectType: 'CONTACT',
        event: 'created',
        actionSpec: { action: 'assign', userId: people.closer },
      })
    ).status,
  ).toBe(422);
});

it('assign hands the lead to a named person, or through the rules when none is named (M7-12)', async () => {
  const ctx = await ctxForUser(people.admin!, tenantId, `auto-${suffix}`);
  const named = await newLead({ ownerId: people.agent });
  await runAction({ ctx, objectType: 'LEAD', recordId: named.id, spec: { action: 'assign', userId: people.closer } });
  expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: named.id } })).ownerId).toBe(people.closer);

  await prisma.distributionRule.create({
    data: {
      tenantId,
      name: 'Closers',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: [people.closer] },
      respectWorkingHours: false,
    },
  });
  const unowned = await newLead();
  await runAction({ ctx, objectType: 'LEAD', recordId: unowned.id, spec: { action: 'assign' } });
  expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: unowned.id } })).ownerId).toBe(people.closer);
});

it('send_template sends the workspace’s email template to the lead (M7-12)', async () => {
  await prisma.messageTemplate.create({
    data: {
      tenantId,
      key: 'email:welcome',
      name: 'Welcome',
      channel: 'EMAIL',
      subject: 'Welcome',
      body: 'Hello {{1}}',
    },
  });
  const created = await publish({
    name: 'Welcome email',
    event: 'created',
    actionSpec: { action: 'send_template', channel: 'EMAIL', templateKey: 'email:welcome' },
  });
  expect(created.status).toBe(200);
  const email = `nadia-${suffix}@client.test`;
  const lead = await newLead({ email, ownerId: people.agent });
  const ctx = await ctxForUser(people.admin!, tenantId, `auto-mail-${suffix}`);
  await runAction({ ctx, objectType: 'LEAD', recordId: lead.id, spec: await storedAction(created.body.id) });

  expect(mockOutbox.lastTo(email)).toMatchObject({ subject: 'Welcome', body: 'Hello Nadia' });
  expect(await prisma.communication.count({ where: { tenantId, leadId: lead.id, channel: 'EMAIL' } })).toBe(1);
});

it('webhook posts the event signed with a secret shown once, and refuses an address inside the network (M7-12)', async () => {
  const created = await publish({
    name: 'Tell the CRM',
    event: 'created',
    actionSpec: { action: 'webhook', url: 'https://93.184.215.14/hooks/youhan' },
  });
  expect(created.status).toBe(200);
  const secret = created.body.webhookSecret as string;
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  // Kept sealed, never as written.
  const spec = await storedAction(created.body.id);
  expect(JSON.stringify(spec)).not.toContain(secret);

  const sent = interceptWebhook();
  const lead = await newLead({ ownerId: people.agent, phone: '+971501234567' });
  const ctx = await ctxForUser(people.admin!, tenantId, `auto-hook-${suffix}`);
  await runAction({ ctx, objectType: 'LEAD', recordId: lead.id, spec });

  expect(sent).toHaveLength(1);
  const { url, options, body } = sent[0]!;
  expect(url).toBe('https://93.184.215.14/hooks/youhan');
  expect(options.method).toBe('POST');
  const headers = options.headers as Record<string, string>;
  expect(headers['x-youhan-signature']).toBe(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  expect(JSON.parse(body)).toMatchObject({ objectType: 'LEAD', recordId: lead.id, reference: lead.reference });
  expect(body).not.toContain('+971501234567');

  // An address on the inside is refused before anything is sent.
  sent.length = 0;
  await expect(
    runAction({ ctx, objectType: 'LEAD', recordId: lead.id, spec: { ...spec, url: 'https://169.254.169.254/latest' } }),
  ).rejects.toThrow(/private address/);
  expect(sent).toHaveLength(0);
  expect(
    (await publish({ name: 'Plain', event: 'created', actionSpec: { action: 'webhook', url: 'http://x.test/' } }))
      .status,
  ).toBe(422);
});

it('webhook sends only what its author may see: authoring needs VIEW on the record, and each run checks the record', async () => {
  // An IT administrator manages automations but holds no lead or contact access.
  const itRole = await prisma.role.create({
    data: { tenantId, key: `it-${suffix}`, name: 'IT', rank: 30, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, itRole.id, [
    ['automation', 'VIEW'],
    ['automation', 'MANAGE_AUTOMATION'],
  ]);
  const it = await createWorkspaceUser({ tenantId, roleId: itRole.id, email: `it@${slug}.test`, fullName: 'IT' });
  const itCookie = await createSessionToken(tenantId, it.id);
  for (const objectType of ['LEAD', 'CONTACT']) {
    const refused = await post(
      createAutomation,
      '/api/v1/automations',
      {
        name: 'Export',
        objectType,
        event: 'created',
        activate: true,
        actionSpec: { action: 'webhook', url: 'https://93.184.215.14/x' },
      },
      itCookie,
    );
    expect(refused.status).toBe(403);
  }

  // A seller who sees only their own leads may author one; it carries their own leads only.
  const ownRole = await prisma.role.create({
    data: { tenantId, key: `own-${suffix}`, name: 'Seller', rank: 50, defaultScope: 'OWN' },
  });
  await grantPermissions(tenantId, ownRole.id, [['automation', 'MANAGE_AUTOMATION']]);
  await grantPermissions(tenantId, ownRole.id, [['leads', 'VIEW']], 'OWN');
  const seller = await createWorkspaceUser({
    tenantId,
    roleId: ownRole.id,
    email: `seller@${slug}.test`,
    fullName: 'Seller',
  });
  const created = await post(
    createAutomation,
    '/api/v1/automations',
    {
      name: 'Mine',
      objectType: 'LEAD',
      event: 'created',
      actionSpec: { action: 'webhook', url: 'https://93.184.215.14/x' },
    },
    await createSessionToken(tenantId, seller.id),
  );
  expect(created.status).toBe(200);
  const spec = await storedAction(created.body.id);

  const sent = interceptWebhook();
  const sellerCtx = await ctxForUser(seller.id, tenantId, `auto-own-${suffix}`);
  const someoneElses = await newLead({ ownerId: people.agent });
  await runAction({ ctx: sellerCtx, objectType: 'LEAD', recordId: someoneElses.id, spec });
  expect(sent).toHaveLength(0);
  const theirs = await newLead({ ownerId: seller.id });
  await runAction({ ctx: sellerCtx, objectType: 'LEAD', recordId: theirs.id, spec });
  expect(sent).toHaveLength(1);

  // A webhook stored before (or whose author has since lost access) still sends nothing.
  sent.length = 0;
  const itCtx = await ctxForUser(it.id, tenantId, `auto-it-${suffix}`);
  await runAction({ ctx: itCtx, objectType: 'LEAD', recordId: theirs.id, spec });
  const contact = await prisma.contact.create({
    data: { tenantId, reference: `CT-${suffix}`, fullName: 'Omar Haddad' },
  });
  await runAction({ ctx: itCtx, objectType: 'CONTACT', recordId: contact.id, spec });
  expect(sent).toHaveLength(0);
});

it('the webhook connects only to the address it checked, so a name that re-resolves inside is refused (review)', async () => {
  const resolve = (host: string, options: { all?: boolean }) =>
    new Promise((done, fail) => publicLookup(host, options, (err, address) => (err ? fail(err) : done(address))));
  // The connection's own lookup: a name that resolves inside the network fails it, a public one is what it dials.
  await expect(resolve('localhost', {})).rejects.toThrow(/private address/);
  await expect(resolve('93.184.215.14', { all: true })).resolves.toEqual([{ address: '93.184.215.14', family: 4 }]);

  const created = await publish({
    name: 'Pinned',
    event: 'created',
    actionSpec: { action: 'webhook', url: 'https://93.184.215.14/pinned' },
  });
  const sent = interceptWebhook();
  const lead = await newLead({ ownerId: people.agent });
  const ctx = await ctxForUser(people.admin!, tenantId, `auto-pin-${suffix}`);
  await runAction({ ctx, objectType: 'LEAD', recordId: lead.id, spec: await storedAction(created.body.id) });
  // That lookup on a connection of its own: no pooled socket another caller resolved unchecked.
  expect(sent.map(({ options }) => [options.lookup, options.agent])).toEqual([[publicLookup, false]]);
});

it('assign needs the author to hold leads:ASSIGN or REASSIGN, when it is written and each time it runs (review)', async () => {
  const role = await prisma.role.create({
    data: { tenantId, key: `editor-${suffix}`, name: 'Editor', rank: 40, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [
    ['automation', 'MANAGE_AUTOMATION'],
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
  ]);
  const editor = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `editor@${slug}.test`,
    fullName: 'Editor',
  });
  const editorCookie = await createSessionToken(tenantId, editor.id);
  for (const actionSpec of [{ action: 'assign', userId: editor.id }, { action: 'assign' }]) {
    const refused = await post(
      createAutomation,
      '/api/v1/automations',
      { name: 'Assign', objectType: 'LEAD', event: 'created', activate: true, actionSpec },
      editorCookie,
    );
    expect(refused.status).toBe(403);
  }

  // One already stored fails its step, rather than leaving the lead unassigned under a COMPLETED run.
  const lead = await newLead();
  const ctx = await ctxForUser(editor.id, tenantId, `auto-editor-${suffix}`);
  for (const spec of [{ action: 'assign', userId: editor.id }, { action: 'assign' }]) {
    await expect(runAction({ ctx, objectType: 'LEAD', recordId: lead.id, spec })).rejects.toThrow(/assign leads/);
  }
  expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id } })).ownerId).toBeNull();
});
