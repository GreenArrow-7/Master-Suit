import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Identity documents scheduled by account deletion are purged by the retention job —
 * file and row — exactly at their boundary, in every workspace, and nothing else is.
 */
const deleted: string[] = [];
let failKey: string | null = null;
vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(async (key: string) => {
    if (key === failKey) throw new Error('storage unavailable');
    deleted.push(key);
  }),
}));
vi.mock('@/services/hr/captureVault', () => ({
  purgeExpiredCaptures: vi.fn(async () => ({ removed: 0, workspaces: 0 })),
  deleteCapture: vi.fn(async () => {}),
}));
const { runRetentionCleanup } = await import('@/lib/jobs/retention');

let fixture: Fixture;
let seq = 0;

async function employeeIn(tenantId: string) {
  const role = await prisma.role.create({
    data: { tenantId, key: `dp-${seq++}-${Date.now()}`, name: 'Doc Purge', rank: 60, defaultScope: 'OWN' },
  });
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `dp-${seq}-${Date.now()}@example.com`,
    fullName: 'Doc Purge',
  });
  const m = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId: user.id },
    select: { id: true },
  });
  return prisma.employeeProfile.create({
    data: { tenantId, membershipId: m.id, employeeNumber: `DP-${seq}-${Date.now()}` },
    select: { id: true, tenantId: true },
  });
}
async function doc(employee: { id: string; tenantId: string }, purgeAt: Date | null, key: string) {
  return prisma.hrEmployeeDocument.create({
    data: {
      tenantId: employee.tenantId,
      employeeId: employee.id,
      kind: 'PASSPORT',
      name: key,
      storageKey: key,
      purgeAt,
    },
    select: { id: true },
  });
}
const exists = (tenantId: string, id: string) => prisma.hrEmployeeDocument.count({ where: { tenantId, id } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
});
afterAll(async () => {
  await fixture.cleanup();
});

describe('scheduled identity-document purge', () => {
  it('removes file and row past the boundary in every workspace, keeps everything else, and retries a failed object', async () => {
    const a = await employeeIn(fixture.a.tenantId);
    const b = await employeeIn(fixture.b.tenantId);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const dueA = await doc(a, past, `hr/${a.id}/due-a.pdf`);
    const dueB = await doc(b, past, `hr/${b.id}/due-b.pdf`);
    const notYet = await doc(a, future, `hr/${a.id}/not-yet.pdf`);
    const never = await doc(a, null, `hr/${a.id}/never.pdf`); // a live employee's document: no purgeAt
    const stuck = await doc(a, past, `hr/${a.id}/stuck.pdf`);
    failKey = `hr/${a.id}/stuck.pdf`;

    const result = await runRetentionCleanup(false);
    expect(result.auditSummary.HrEmployeeDocument).toBeGreaterThanOrEqual(2);

    // Past the boundary, both workspaces: object deleted, row gone.
    expect(deleted).toEqual(expect.arrayContaining([`hr/${a.id}/due-a.pdf`, `hr/${b.id}/due-b.pdf`]));
    expect(await exists(a.tenantId, dueA.id)).toBe(0);
    expect(await exists(b.tenantId, dueB.id)).toBe(0);
    // Not yet due, and never scheduled: untouched, file and row.
    expect(deleted).not.toContain(`hr/${a.id}/not-yet.pdf`);
    expect(deleted).not.toContain(`hr/${a.id}/never.pdf`);
    expect(await exists(a.tenantId, notYet.id)).toBe(1);
    expect(await exists(a.tenantId, never.id)).toBe(1);
    // Object delete failed: the row stays so the next run retries — no orphaned file.
    expect(await exists(a.tenantId, stuck.id)).toBe(1);

    failKey = null;
    await runRetentionCleanup(false);
    expect(deleted).toContain(`hr/${a.id}/stuck.pdf`);
    expect(await exists(a.tenantId, stuck.id)).toBe(0);
  }, 60_000);
});
