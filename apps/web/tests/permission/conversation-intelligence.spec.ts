/**
 * RBAC on the conversation-intelligence routes, through the real handlers.
 *
 * Two lines of defence are asserted: a role with no `calls` grant is refused at
 * the kernel, and a rep whose scope is OWN is refused the manager-only writes
 * (coaching someone else's call) inside the handler.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { seedTwoTenants, createWorkspaceUser, grantPermissions, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, post } from '../helpers/request';
import { GET as listObjections, POST as createObjection } from '@/app/api/v1/objections/route';
import { POST as startPractice } from '@/app/api/v1/practice/route';
import { POST as addCoaching } from '@/app/api/v1/calls/[id]/coaching/route';

let fixture: Fixture;
/** Holds `leads` permissions only — no `calls` grant at any scope. */
let noCallsCookie: string;
/** Holds `calls` at OWN scope — a rep, not a manager. */
let ownRep: { id: string; cookie: string };
/** A call made by somebody else in the same workspace. */
let othersCallId: string;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const tenantId = fixture.a.tenantId;

  const noCallsRole = await prisma.role.create({
    data: { tenantId, key: 'no-calls', name: 'No Calls', rank: 70, defaultScope: 'OWN' },
  });
  await grantPermissions(tenantId, noCallsRole.id, [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
  ]);
  const noCallsUser = await createWorkspaceUser({
    tenantId,
    roleId: noCallsRole.id,
    email: `nocalls@${fixture.a.slug}.test`,
    fullName: 'No Calls',
  });
  noCallsCookie = await createSessionToken(tenantId, noCallsUser.id);

  const ownRole = await prisma.role.create({
    data: { tenantId, key: 'own-rep', name: 'Own Rep', rank: 60, defaultScope: 'OWN' },
  });
  await grantPermissions(
    tenantId,
    ownRole.id,
    [
      ['calls', 'VIEW'],
      ['calls', 'EDIT'],
      ['calls', 'CREATE'],
    ],
    'OWN',
  );
  const rep = await createWorkspaceUser({
    tenantId,
    roleId: ownRole.id,
    email: `ownrep@${fixture.a.slug}.test`,
    fullName: 'Own Rep',
  });
  ownRep = { id: rep.id, cookie: await createSessionToken(tenantId, rep.id) };

  const othersCall = await prisma.call.create({
    data: { tenantId, callerId: fixture.a.userId, recipientNumber: '+971500000001', status: 'COMPLETED' },
  });
  othersCallId = othersCall.id;
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe('conversation intelligence RBAC', () => {
  it('refuses the playbook to a role with no calls grant', async () => {
    const denied = await post(
      createObjection,
      '/api/v1/objections',
      { name: 'Too expensive', triggerPhrases: ['too expensive'] },
      noCallsCookie,
    );
    expect(denied.status).toBe(403);

    const deniedList = await get(listObjections, '/api/v1/objections', noCallsCookie);
    expect(deniedList.status).toBe(403);
  });

  it('refuses practice to a role with no calls grant', async () => {
    const denied = await post(startPractice, '/api/v1/practice', { scenario: 'OPENER' }, noCallsCookie);
    expect(denied.status).toBe(403);
  });

  it('refuses everything to an unauthenticated request', async () => {
    const anonymous = await get(listObjections, '/api/v1/objections');
    expect(anonymous.status).toBe(401);
  });

  it('lets the admin create a playbook entry', async () => {
    const created = await post(
      createObjection,
      '/api/v1/objections',
      { name: 'Permission test objection', triggerPhrases: ['just testing'] },
      fixture.a.cookie,
    );
    expect(created.status).toBe(200);
    expect(created.body.tenantId).toBe(fixture.a.tenantId);
  });

  it('refuses an OWN-scoped rep coaching on another rep’s call', async () => {
    // The kernel passes (the rep holds calls:EDIT); the handler must still
    // refuse, because coaching is defined by seeing beyond your own calls.
    const denied = await post(
      addCoaching,
      `/api/v1/calls/${othersCallId}/coaching`,
      { body: 'You should not be able to read this.' },
      ownRep.cookie,
      { id: othersCallId },
    );
    expect(denied.status).toBe(403);
  });

  it('lets the manager coach a rep’s call, and refuses self-coaching', async () => {
    const repsCall = await prisma.call.create({
      data: {
        tenantId: fixture.a.tenantId,
        callerId: ownRep.id,
        recipientNumber: '+971500000002',
        status: 'COMPLETED',
      },
    });

    const allowed = await post(
      addCoaching,
      `/api/v1/calls/${repsCall.id}/coaching`,
      { body: 'Strong open; ask for the budget earlier.' },
      fixture.a.cookie,
      { id: repsCall.id },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.authorId).toBe(fixture.a.userId);

    // The admin coaching their own call is refused: coaching is defined as a
    // manager writing about someone else's conversation.
    const self = await post(
      addCoaching,
      `/api/v1/calls/${othersCallId}/coaching`,
      { body: 'Note to self.' },
      fixture.a.cookie,
      { id: othersCallId },
    );
    expect(self.status).toBe(403);
  });
});
