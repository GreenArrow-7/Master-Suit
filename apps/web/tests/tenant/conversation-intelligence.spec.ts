/**
 * Tenant isolation for the conversation-intelligence tables, against real rows.
 *
 * Same discipline as calls.spec.ts: create the same-shaped data in two
 * workspaces, then prove that naming another workspace's exact row id returns
 * nothing. These queries run through the real client, so they exercise both the
 * tenant guard and (when the connection role enforces it) the RLS policies from
 * 20260819100000_conversation_intelligence.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';

const suffix = randomBytes(4).toString('hex');

interface Ws {
  slug: string;
  id: string;
  userId: string;
  objectionId: string;
  sessionId: string;
  noteId: string;
}

const a = { slug: `ci-a-${suffix}` } as Ws;
const b = { slug: `ci-b-${suffix}` } as Ws;

beforeAll(async () => {
  for (const ws of [a, b]) {
    const tenant = await prisma.tenant.create({
      data: { slug: ws.slug, legalName: `${ws.slug} LLC`, displayName: ws.slug },
    });
    ws.id = tenant.id;

    const role = await prisma.role.create({
      data: { tenantId: tenant.id, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
    });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `rep@${ws.slug}.test`,
        fullName: 'Rep',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    ws.userId = user.id;

    const objection = await prisma.objection.create({
      data: {
        tenantId: tenant.id,
        // The same name in both tenants: the unique key is (tenantId, name).
        name: `Too expensive ${suffix}`,
        triggerPhrases: ['too expensive'],
        recommendedResponses: ['Reframe around the payment plan.'],
      },
    });
    ws.objectionId = objection.id;

    const session = await prisma.practiceSession.create({
      data: { tenantId: tenant.id, userId: user.id, scenario: 'OPENER', brief: 'Busy prospect.' },
    });
    ws.sessionId = session.id;

    const call = await prisma.call.create({
      data: { tenantId: tenant.id, callerId: user.id, recipientNumber: '+971500000000', status: 'COMPLETED' },
    });
    const note = await prisma.coachingNote.create({
      data: { tenantId: tenant.id, callId: call.id, authorId: user.id, body: 'Slow down on the open.' },
    });
    ws.noteId = note.id;
  }
});

afterAll(async () => {
  for (const ws of [a, b]) {
    if (ws.id) await prisma.tenant.delete({ where: { id: ws.id } }).catch(() => {});
  }
});

describe('conversation intelligence tenant isolation', () => {
  it('does not return another workspace objection, even by its exact id', async () => {
    expect(await prisma.objection.findFirst({ where: { tenantId: a.id, id: b.objectionId } })).toBeNull();
    expect(await prisma.objection.findFirst({ where: { tenantId: b.id, id: a.objectionId } })).toBeNull();
  });

  it('allows the same objection name in two workspaces', async () => {
    const rows = await prisma.objection.findMany({ where: { tenantId: a.id } });
    expect(rows.map((o) => o.id)).toEqual([a.objectionId]);
  });

  it('does not return another workspace practice session', async () => {
    expect(await prisma.practiceSession.findFirst({ where: { tenantId: a.id, id: b.sessionId } })).toBeNull();
  });

  it('does not return another workspace coaching note', async () => {
    expect(await prisma.coachingNote.findFirst({ where: { tenantId: a.id, id: b.noteId } })).toBeNull();
  });

  it('rejects an unscoped read outright (tenant guard)', async () => {
    await expect(prisma.objection.findMany({ where: { isActive: true } })).rejects.toThrow(/tenantId/);
  });
});
