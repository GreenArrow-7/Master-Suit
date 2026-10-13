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
import { GET as readTimeline } from '@/app/api/v1/leads/[id]/timeline/route';
import { PATCH as editLead } from '@/app/api/v1/leads/[id]/route';
import { POST as logActivity } from '@/app/api/v1/activities/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { get, patch, post } from '../helpers/request';

/**
 * The lead's timeline (Lead Eagle audit rows M4-12 and M4-46): one paged feed,
 * newest first, of what was logged, stage moves, field edits from the audit
 * log, assignments, calls and messages, each typed and dated on the
 * workspace's clock, and only what the viewer may see.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
let adminRoleId: string;
let leadId: string;
let secondAgentId: string;
/** Every lead, no sensitive fields and no calls: numbers masked, calls not theirs. */
let masked: string;
/** `leads:VIEW` at OWN: none of the admin's leads. */
let agent: string;

const PHONE = '+971501234567';
const NEW_PHONE = '+971509876543';

interface Entry {
  key: string;
  kind: string;
  at: string;
  when: string;
  title: string;
  detail: string | null;
  notes: string | null;
  by: string | null;
}
const timeline = async (as: string, query = '') => {
  const res = await get(readTimeline, `/api/v1/leads/${leadId}/timeline${query}`, as, { id: leadId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { entries: Entry[]; next: string | null };
};

async function roleUser(key: string, grants: Parameters<typeof grantPermissions>[2], scope: 'OWN' | 'ORGANIZATION') {
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 80 } });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${key}-${suffix}@a.test`,
    fullName: key,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  cookieJar.value = admin;
  leadId = fixture.a.leadIds[0]!;
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  await prisma.lead.update({ where: { tenantId, id: leadId }, data: { phone: PHONE, phoneNormalized: PHONE } });
  adminRoleId = (
    await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId }, select: { roleId: true } })
  ).roleId!;
  secondAgentId = (
    await createWorkspaceUser({
      tenantId,
      roleId: adminRoleId,
      email: `second-${randomBytes(3).toString('hex')}@a.test`,
      fullName: 'Second Agent',
    })
  ).id;
  masked = (await roleUser('masked', [['leads', 'VIEW']], 'ORGANIZATION')).cookie;
  agent = (await roleUser('agent', [['leads', 'VIEW']], 'OWN')).cookie;

  const qualified = await prisma.leadStage.create({
    data: { tenantId, key: `qualified-${randomBytes(3).toString('hex')}`, name: 'Qualified', position: 1 },
  });
  const callType = await prisma.activityType.create({
    data: { tenantId, key: 'call_out', name: 'Outbound call', scoreDelta: 3 },
  });

  // What happened to the lead, through the routes that do it.
  const steps: Record<string, unknown>[] = [
    { phone: NEW_PHONE },
    { stageId: qualified.id },
    { ownerId: secondAgentId },
    { secondaryOwnerId: fixture.a.userId },
  ];
  for (const body of steps) {
    const res = await patch(editLead, `/api/v1/leads/${leadId}`, body, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const logged = await post(
    logActivity,
    '/api/v1/activities',
    { typeId: callType.id, leadId, outcome: 'Interested', notes: 'Wants a viewing' },
    admin,
  );
  expect(logged.status).toBe(200);

  // A call placed through the workspace's provider, and a WhatsApp template sent.
  await prisma.call.create({
    data: {
      tenantId,
      leadId,
      callerId: fixture.a.userId,
      direction: 'OUTBOUND',
      status: 'COMPLETED',
      outcome: 'CONNECTED',
      durationSecs: 125,
      providerName: 'twilio',
      recipientNumber: PHONE,
      notes: 'Discussed the payment plan',
      createdAt: new Date('2026-10-01T20:30:00.000Z'),
    },
  });
  await prisma.communication.create({
    data: {
      tenantId,
      leadId,
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      toAddress: PHONE,
      body: 'Hello from the Marina launch',
      ownerId: fixture.a.userId,
      createdById: fixture.a.userId,
    },
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('the lead timeline merges every kind of entry (M4-12, M4-46)', () => {
  it('shows field edits, stage moves, assignments, calls, messages and logged activity, newest first', async () => {
    const { entries } = await timeline(admin);
    const by = (kind: string) => entries.filter((e) => e.kind === kind);

    // A field edit, before and after; the normalised copy and the timestamps are not edits.
    expect(by('field').filter((e) => e.title === 'Phone changed')).toEqual([
      expect.objectContaining({ detail: `${PHONE} → ${NEW_PHONE}`, by: 'manath Administrator' }),
    ]);
    expect(entries.map((e) => e.title)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(Updated|Phone normalized)/)]),
    );
    // A user id as the value is a name.
    expect(by('field').find((e) => e.title === 'Second owner changed')).toMatchObject({
      detail: '— → manath Administrator',
    });
    expect(JSON.stringify(entries)).not.toContain(fixture.a.userId);
    expect(JSON.stringify(entries)).not.toContain(secondAgentId);

    expect(by('stage')).toEqual([expect.objectContaining({ title: 'Stage: New → Qualified' })]);
    expect(by('assignment')).toEqual([
      expect.objectContaining({
        title: 'Assigned to Second Agent',
        detail: expect.stringContaining('from manath Administrator'),
      }),
    ]);
    expect(by('activity')).toEqual([
      expect.objectContaining({ title: 'Outbound call', detail: 'Interested', notes: 'Wants a viewing' }),
    ]);
    // The vendor call, dated on the workspace's clock: 20:30 UTC is 00:30 the next day in Dubai.
    expect(by('call')).toEqual([
      expect.objectContaining({
        title: 'Outgoing call',
        detail: 'Connected · 2 min',
        notes: 'Discussed the payment plan',
        when: '02 Oct 2026, 00:30',
        by: 'manath Administrator',
      }),
    ]);
    expect(by('message')).toEqual([expect.objectContaining({ title: 'WhatsApp sent', detail: 'Delivered' })]);

    // Newest first.
    const times = entries.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('pages with a cursor: every entry once, in the same order, entries at the same instant included', async () => {
    // Three edits audited at one instant, as one save writes them.
    const at = new Date('2026-10-05T09:00:00.000Z');
    await prisma.auditLog.createMany({
      data: ['company', 'city', 'jobTitle'].map((fieldKey) => ({
        tenantId,
        actorUserId: fixture.a.userId,
        event: 'RECORD_UPDATED' as const,
        objectType: 'lead',
        recordId: leadId,
        fieldKey,
        previousValue: 'Before',
        newValue: 'After',
        occurredAt: at,
      })),
    });
    const all = (await timeline(admin, '?limit=50')).entries;
    expect(all.filter((e) => e.at === at.toISOString())).toHaveLength(3);

    const paged: Entry[] = [];
    let cursor: string | null = null;
    do {
      const page: { entries: Entry[]; next: string | null } = await timeline(
        admin,
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.entries.length).toBeLessThanOrEqual(2);
      paged.push(...page.entries);
      cursor = page.next;
    } while (cursor);
    expect(paged.map((e) => e.key)).toEqual(all.map((e) => e.key));
    expect(new Set(paged.map((e) => e.key)).size).toBe(all.length);
  });

  it('refuses a cursor that is not one', async () => {
    const res = await get(readTimeline, `/api/v1/leads/${leadId}/timeline?cursor=nonsense`, admin, { id: leadId });
    expect(res.status).toBe(422);
  });

  it('is the lead’s: another agent’s or workspace’s lead answers 404', async () => {
    expect((await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, agent, { id: leadId })).status).toBe(404);
    const other = fixture.b.leadIds[0]!;
    expect((await get(readTimeline, `/api/v1/leads/${other}/timeline`, admin, { id: other })).status).toBe(404);
  });

  it('shows only what the viewer may see: masked numbers, no calls outside their reach, no message text without the inbox', async () => {
    const seen = (await timeline(masked)).entries;
    const phone = seen.find((e) => e.title === 'Phone changed');
    expect(phone?.detail).toContain('•');
    expect(JSON.stringify(seen)).not.toContain('501234567');
    expect(JSON.stringify(seen)).not.toContain('509876543');
    // No `calls` grant: their own calls only, and this one is the administrator's.
    expect(seen.filter((e) => e.kind === 'call')).toEqual([]);
    // The message is on the timeline; its text is the inbox's to show.
    expect(seen.find((e) => e.kind === 'message')).toMatchObject({ title: 'WhatsApp sent', notes: null });
    expect(JSON.stringify(seen)).not.toContain('Hello from the Marina launch');

    // With the inbox's own permission, the text is there.
    await grantPermissions(tenantId, adminRoleId, [['communications', 'VIEW']]);
    const withInbox = (await timeline(admin)).entries;
    expect(withInbox.find((e) => e.kind === 'message')).toMatchObject({ notes: 'Hello from the Marina launch' });
  });

  it('the lead page opens on the first page of it', async () => {
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    for (const shown of [
      'Phone changed',
      `${PHONE} → ${NEW_PHONE}`,
      'Assigned to Second Agent',
      'Outgoing call',
      '02 Oct 2026, 00:30',
      'WhatsApp sent',
      'Stage: New → Qualified',
    ]) {
      expect(text).toContain(shown);
    }
  });
});
