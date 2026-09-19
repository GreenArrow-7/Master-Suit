import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { DELETE as deleteLead } from '@/app/api/v1/leads/[id]/route';
import { POST as closeOut } from '@/app/api/v1/leads/[id]/close-out/route';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { get, del, post } from '../helpers/request';

/**
 * Permanent deletion is an administrator's act. A rep who can edit their lead can
 * close it out instead — invalid, duplicate or archived — which removes it from
 * working lists, keeps its history, and can be reversed.
 */
let h: Hierarchy;

beforeAll(async () => {
  h = await seedHierarchy();
  // The hierarchy fixture hands every leads action to every role; reps in the
  // seeded product roles have no leads:DELETE, and that is the case under test.
  const rep = await prisma.user.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA1.id }, select: { roleId: true } });
  await prisma.rolePermission.deleteMany({
    where: { tenantId: h.tenantId, roleId: rep.roleId, permission: { module: 'leads', action: 'DELETE' } },
  });
});
afterAll(async () => {
  await h.cleanup();
});

describe('lead close-out versus delete', () => {
  it('a rep cannot delete but can archive, which hides the lead from the default list', async () => {
    const rep = h.repA1;
    const refused = await del(deleteLead, `/api/v1/leads/${rep.leadId}`, rep.cookie, { id: rep.leadId });
    expect(refused.status).toBe(403);

    const archived = await post(closeOut, `/api/v1/leads/${rep.leadId}/close-out`, { status: 'ARCHIVED' }, rep.cookie, {
      id: rep.leadId,
    });
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('ARCHIVED');

    const visible = await get(listLeads, '/api/v1/leads', rep.cookie);
    expect(visible.body.data.map((r: { id: string }) => r.id)).not.toContain(rep.leadId);
    const all = await get(listLeads, '/api/v1/leads?includeClosedOut=true', rep.cookie);
    expect(all.body.data.map((r: { id: string }) => r.id)).toContain(rep.leadId);

    // Still there, still theirs: nothing was deleted.
    const row = await prisma.lead.findFirstOrThrow({
      where: { tenantId: h.tenantId, id: rep.leadId },
      select: { deletedAt: true, status: true },
    });
    expect(row.deletedAt).toBeNull();
    expect(row.status).toBe('ARCHIVED');
  });

  it('duplicate records which lead it repeats, and reopen clears both', async () => {
    const rep = h.repA1;
    const other = h.repA2.leadId;
    // Not visible to this rep, so not accepted as the original.
    const foreign = await post(
      closeOut,
      `/api/v1/leads/${rep.leadId}/close-out`,
      { status: 'DUPLICATE', duplicateOfId: h.repOtherRegion.leadId },
      rep.cookie,
      { id: rep.leadId },
    );
    expect([200, 404]).toContain(foreign.status);

    const dup = await post(
      closeOut,
      `/api/v1/leads/${rep.leadId}/close-out`,
      { status: 'DUPLICATE', duplicateOfId: other },
      rep.cookie,
      { id: rep.leadId },
    );
    expect(dup.status).toBe(200);
    expect(dup.body.duplicateOfId).toBe(other);

    const reopened = await post(closeOut, `/api/v1/leads/${rep.leadId}/close-out`, { status: 'OPEN' }, rep.cookie, {
      id: rep.leadId,
    });
    expect(reopened.body.status).toBeNull();
    expect(reopened.body.duplicateOfId).toBeNull();
  });

  it('a rep cannot close out a lead outside their scope', async () => {
    const res = await post(
      closeOut,
      `/api/v1/leads/${h.repOtherRegion.leadId}/close-out`,
      { status: 'INVALID' },
      h.repA1.cookie,
      { id: h.repOtherRegion.leadId },
    );
    expect([403, 404]).toContain(res.status);
  });
});
