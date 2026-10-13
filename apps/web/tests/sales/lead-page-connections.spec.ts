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
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import { GET as readTimeline } from '@/app/api/v1/leads/[id]/timeline/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get } from '../helpers/request';

/**
 * Connections one lead page view asks the pool for at once.
 *
 * A tenant query outside `withTx` is a batched transaction on a pooled
 * connection of its own (runPinned, lib/db.ts), so a Promise.all of N reads
 * asks for N connections. A page asking for more than the pool holds queues
 * behind itself, and with other requests in flight the wait outlasts Prisma's
 * 2 s maxWait: P2028 "Unable to start a transaction in the given time", and the
 * lead page reads "Something went wrong on our side" (main fa01771f).
 *
 * Measured at the pool rather than timed: demand (checked out plus waiting) is
 * read at every checkout, so the peak is the code's fan-out on any machine.
 */
const pool = Object.getPrototypeOf(pg.Pool.prototype) as { connect: (...args: unknown[]) => unknown };
const connect = pool.connect;
let peak = 0;
let size = 0;

async function peakOf(run: () => Promise<unknown>) {
  peak = 0;
  await run();
  return peak;
}

let fixture: Fixture;
let tenantId: string;
let leadId: string;
/** Every grant at TEAM, in a team: the scope reads run too. */
let teamViewer: string;

beforeAll(async () => {
  pool.connect = function (this: pg.Pool, ...args: unknown[]) {
    const result = connect.apply(this, args);
    size = (this as unknown as { options: { max: number } }).options.max;
    peak = Math.max(peak, this.totalCount - this.idleCount + this.waitingCount);
    return result;
  };
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  cookieJar.value = fixture.a.cookie;
  leadId = fixture.a.leadIds[0]!;
  const roleId = (
    await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId }, select: { roleId: true } })
  ).roleId!;
  // Every card on: the inbox, listings (Matching stock), projects and the requirement.
  const cards = [
    ['communications', 'VIEW'],
    ['listings', 'VIEW'],
    ['projects', 'VIEW'],
    ['requirements', 'VIEW'],
  ] as const;
  await grantPermissions(tenantId, roleId, cards);
  await prisma.clientRequirement.create({
    data: { tenantId, leadId, purpose: 'BUY', propertyTypes: ['VILLA'], status: 'OPEN' },
  });

  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `team-${suffix}`, name: 'Team', rank: 60 } });
  await grantPermissions(
    tenantId,
    role.id,
    [['leads', 'VIEW'], ['leads', 'EDIT'], ['leads', 'ASSIGN'], ['tasks', 'VIEW'], ['calls', 'VIEW'], ...cards],
    'TEAM',
  );
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `team-${suffix}@a.test`,
    fullName: 'Team',
  });
  const team = await prisma.team.create({ data: { tenantId, name: 'Team', code: `T-${suffix}` } });
  await prisma.userTeam.create({ data: { tenantId, userId: user.id, teamId: team.id } });
  await prisma.lead.update({ where: { tenantId, id: leadId }, data: { ownerId: user.id } });
  teamViewer = await createSessionToken(tenantId, user.id);
});

afterAll(async () => {
  pool.connect = connect;
  await fixture?.cleanup();
});

describe('one lead page view fits the connection pool', () => {
  it('the lead page asks for no more connections at once than the pool holds', async () => {
    for (const viewer of [fixture.a.cookie, teamViewer]) {
      cookieJar.value = viewer;
      const asked = await peakOf(async () => {
        const tree = (await LeadDetailPage({ params: Promise.resolve({ id: leadId }) })) as {
          props: { children: ({ props?: Record<string, any> } | null)[] };
        };
        // Every card loaded, Matching stock with it.
        const { lead } = tree.props.children.find((child) => child?.props?.lead)!.props!;
        expect(lead.matchingStock).toMatchObject({ hasRequirement: true });
      });
      expect(size).toBeGreaterThan(0);
      expect(asked, `peak ${asked} of a pool of ${size}`).toBeLessThanOrEqual(size);
    }
  });

  it('so does the timeline route', async () => {
    for (const viewer of [fixture.a.cookie, teamViewer]) {
      const asked = await peakOf(async () => {
        const res = await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, viewer, { id: leadId });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
      expect(asked, `peak ${asked} of a pool of ${size}`).toBeLessThanOrEqual(size);
    }
  });
});
