/**
 * A search must not widen the inbox past the reader's scope.
 *
 * The conversation list built its `where` by object spread, and the search's
 * `OR` replaced the `OR` that visibilityWhere uses for ownership. A rep holding
 * `communications:VIEW` at OWN who typed anything into the search box was listed
 * every matching thread in the workspace. lib/api/where.ts explains the bug
 * class; mergeWhere is the fix every other list route already used, and
 * visibility-where-merge.spec.ts covers the same property for the leads grid.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get } from '../helpers/request';
import { GET as listConversations } from '@/app/api/v1/conversations/route';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
let repCookie = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `convscope-${suffix}`, legalName: 'ConvScope LLC', displayName: 'ConvScope', planCode: 'free' },
  });
  tenantId = tenant.id;

  const role = await prisma.role.create({
    data: { tenantId, key: 'sales_rep', name: 'Sales Representative', rank: 60 },
  });
  await grantPermissions(tenantId, role.id, [['communications', 'VIEW']], 'OWN');

  const rep = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `rep.convscope.${suffix}@test.local`,
    fullName: 'ConvScope Rep',
  });
  const colleague = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `colleague.convscope.${suffix}@test.local`,
    fullName: 'ConvScope Colleague',
  });
  repCookie = await createSessionToken(tenantId, rep.id);

  // Both match the search below; only the first is the rep's.
  await prisma.conversation.createMany({
    data: [
      {
        tenantId,
        channel: 'WHATSAPP',
        externalId: `mine-${suffix}`,
        displayName: 'Harbour View Mine',
        ownerId: rep.id,
      },
      {
        tenantId,
        channel: 'WHATSAPP',
        externalId: `theirs-${suffix}`,
        displayName: 'Harbour View Theirs',
        ownerId: colleague.id,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('the conversation list at OWN scope', () => {
  const names = (body: unknown) =>
    (body as { conversations: { displayName: string }[] }).conversations.map((c) => c.displayName);

  it('lists only the rep’s own thread without a search', async () => {
    const res = await get(listConversations, '/api/v1/conversations', repCookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(names(res.body)).toEqual(['Harbour View Mine']);
  });

  it('still lists only the rep’s own thread when a search matches a colleague’s too', async () => {
    const res = await get(listConversations, '/api/v1/conversations?search=Harbour%20View', repCookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(names(res.body)).toEqual(['Harbour View Mine']);
  });
});
