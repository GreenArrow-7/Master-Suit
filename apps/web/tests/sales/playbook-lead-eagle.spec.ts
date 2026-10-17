import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, patch, post } from '../helpers/request';
import { POST as createObjection } from '@/app/api/v1/objections/route';
import { PATCH as editObjection } from '@/app/api/v1/objections/[id]/route';
import { GET as listPlaybooks, POST as createPlaybook } from '@/app/api/v1/sales-playbooks/route';
import { POST as coach } from '@/app/api/v1/calls/[id]/coach/route';

/**
 * M21-01: Lead Eagle gets the objection playbook, and the live call's hints
 * cite it. The playbook and its APIs were Sales-only, so a Lead-Eagle-only
 * workspace's live coach could only answer an objection with built-in wording.
 */
const suffix = randomBytes(4).toString('hex');
const ANSWER = 'Service charges here are AED 14 per square foot, below the community average.';
let tenantId = '';
let cookie = '';
let callId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `playbook-${suffix}`, legalName: 'Playbook LLC', displayName: 'Playbook', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId, key: `mgr-${suffix}`, name: 'Manager', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [
    ['calls', 'VIEW'],
    ['calls', 'CREATE'],
    ['calls', 'EDIT'],
  ]);
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `mgr-${suffix}@playbook.test`,
    fullName: 'Manager',
  });
  cookie = await createSessionToken(tenantId, admin.id);
  const call = await prisma.call.create({
    data: { tenantId, callerId: admin.id, recipientNumber: '+971500000009', status: 'IN_PROGRESS' },
  });
  callId = call.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('the objection playbook in a Lead-Eagle-only workspace', () => {
  it('an administrator adds and edits an objection card, and a buyer-type playbook', async () => {
    const created = await post(
      createObjection,
      '/api/v1/objections',
      { name: 'Service charges', triggerPhrases: ['service charge'], recommendedResponses: ['An older answer.'] },
      cookie,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const edited = await patch(
      editObjection,
      `/api/v1/objections/${created.body.id}`,
      { recommendedResponses: [ANSWER] },
      cookie,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);

    expect((await post(createPlaybook, '/api/v1/sales-playbooks', { name: 'Investors' }, cookie)).status).toBe(200);
    expect((await get(listPlaybooks, '/api/v1/sales-playbooks', cookie)).body.data).toHaveLength(1);
  });

  it("the live call's Handle objection answers with the edited card, citing it", async () => {
    const res = await post(
      coach,
      `/api/v1/calls/${callId}/coach`,
      {
        action: 'HANDLE_OBJECTION',
        window: 'Agent: The unit has a sea view.\nCustomer: The service charge worries me.',
      },
      cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hint).toMatchObject({
      kind: 'OBJECTION',
      text: 'Service charges',
      say: ANSWER,
      why: 'From your playbook: Service charges',
      source: 'playbook',
    });
  });

  it('answers the objection just raised: an earlier, answered card does not take the button', async () => {
    const res = await post(
      coach,
      `/api/v1/calls/${callId}/coach`,
      {
        action: 'HANDLE_OBJECTION',
        window: [
          'Customer: The service charge worries me.',
          'Agent: It is AED 14 per sq ft, below the community.',
          'Customer: Also the handover date is too late for us.',
        ].join('\n'),
      },
      cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hint.source).not.toBe('playbook');
    expect(res.body.hint.say).not.toBe(ANSWER);
  });
});
