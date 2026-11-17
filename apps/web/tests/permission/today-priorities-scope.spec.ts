/**
 * Today may not name a lead the viewer cannot open.
 *
 * A follow-up carries its own `ownerId`, and it does not have to match the
 * lead's. Assigning one person a follow-up on another person's lead is
 * ordinary, and the Follow-ups list shows exactly that under `workListScope`.
 *
 * The pilot's first version filtered follow-ups by `ownerId` alone and then
 * rendered `lead.fullName` through the relation. For a representative whose
 * `leads:VIEW` is OWN, that put a colleague's lead — name and all — at the top
 * of their own dashboard, with an action beside it that answered 404. Found by
 * clicking the first row, which is the only way it could have been found.
 *
 * `leadScope` is the predicate every other read of the Lead model uses, and
 * `agentToday` now takes it. These cases fail without it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma, type TxClient } from '@/lib/db';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import { leadScope } from '@/lib/security/record-scope';
import { agentToday } from '@/services/today/priorities';
import type { PermissionMap } from '@/lib/security/rbac';

const ZONE = 'Asia/Dubai';

let org: Hierarchy;
afterAll(async () => {
  await org?.cleanup();
});

/** A representative: `leads:VIEW` reaches their own records and no further. */
function repCtx(tenantId: string, id: string) {
  return buildCtx(
    buildActor({
      id,
      tenantId,
      permissions: new Map([['leads:VIEW', 'OWN']]) as PermissionMap,
    }),
  );
}

async function todayFor(tenantId: string, userId: string) {
  const ctx = repCtx(tenantId, userId);
  const where = await leadScope(ctx, 'VIEW');
  return agentToday(prisma as unknown as TxClient, tenantId, userId, ZONE, where);
}

describe("Today and another person's lead", () => {
  it('does not name a lead outside the viewer’s scope, even via their own follow-up', async () => {
    org = await seedHierarchy();
    const { tenantId, repA1, repA2 } = org;

    // repA1's own follow-up, on repA2's lead. Both are in Team 1; repA1's
    // grant is OWN, so repA2's lead is out of reach.
    await prisma.followUpTask.create({
      data: {
        tenantId,
        leadId: repA2.leadId,
        ownerId: repA1.id,
        title: 'Call the client back',
        dueAt: new Date(Date.now() - 3 * 86_400_000),
        kind: 'CALL',
        status: 'OPEN',
      },
    });

    const { items } = await todayFor(tenantId, repA1.id);

    // The whole point: not the row, not the name, not the link.
    expect(items.map((i) => i.leadId)).not.toContain(repA2.leadId);

    const other = await prisma.lead.findFirst({
      where: { tenantId, id: repA2.leadId },
      select: { fullName: true },
    });
    expect(items.map((i) => i.title)).not.toContain(other!.fullName);
  });

  it('still shows the viewer their own work, so the first case is not vacuous', async () => {
    const { tenantId, repA1 } = org;
    const { items } = await todayFor(tenantId, repA1.id);
    // seedHierarchy gives each rep one lead, never contacted, on an
    // OPEN-category stage: the "untouched" band.
    expect(items.map((i) => i.leadId)).toContain(repA1.leadId);
  });

  it('shows the lead to the person who actually owns it', async () => {
    const { tenantId, repA2 } = org;
    const { items } = await todayFor(tenantId, repA2.id);
    expect(items.map((i) => i.leadId)).toContain(repA2.leadId);
  });
});
