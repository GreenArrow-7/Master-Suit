import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Audit Log screen reads its session the way Next serves it.
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

import { prisma } from '@/lib/db';
import AuditLogPage from '@/app/(workspace)/[workspaceSlug]/admin/audit/page';
import { grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { pageText } from '../helpers/render';

/**
 * Audit row M18-12: the Audit Log stopped at its newest 150 rows, with no way
 * past them and no date filter. It pages by keyset (Older, carrying the last
 * row's time and id) and narrows to a range of the workspace's days.
 */
let fixture: Fixture;
let tenantId: string;
// 160 probes, one a minute back from 10:00 Dubai time on 5 Oct, and three on 1 Oct.
const START = new Date('2026-10-05T06:00:00Z');

const open = (searchParams: Record<string, string>) =>
  pageText(
    AuditLogPage({
      params: Promise.resolve({ workspaceSlug: fixture.a.slug }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
/** The Older link's cursor, from the rendered tree's href. */
const olderCursor = (text: string) => {
  const href = text.split('\n').find((line) => line.includes('before='));
  return href ? new URLSearchParams(href.slice(href.indexOf('?'))).get('before') : null;
};

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  await grantPermissions(tenantId, roleId, [['auditlogs', 'VIEW']]);
  cookieJar.value = fixture.a.cookie;
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.auditLog.createMany({
    data: [
      ...Array.from({ length: 160 }, (_, i) => ({
        tenantId,
        event: 'RECORD_UPDATED' as const,
        objectType: 'lead',
        metadata: { action: `probe.${i}` },
        occurredAt: new Date(START.getTime() - i * 60_000),
      })),
      ...[0, 1, 2].map((i) => ({
        tenantId,
        event: 'RECORD_UPDATED' as const,
        objectType: 'lead',
        metadata: { action: `early.${i}` },
        occurredAt: new Date(Date.UTC(2026, 9, 1, 8, i)),
      })),
    ],
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('the Audit Log pages and filters by date (M18-12)', () => {
  it('shows the newest 150, and Older reaches the 151st and beyond', async () => {
    const first = await open({});
    expect(first).toContain('Probe 0');
    expect(first).toContain('Probe 149');
    expect(first).not.toContain('Probe 150');
    const before = olderCursor(first);
    expect(before).toBeTruthy();

    const second = await open({ before: before! });
    expect(second).toContain('Probe 150');
    expect(second).toContain('Probe 159');
    expect(second).toContain('Early 0');
    expect(second).not.toContain('Probe 149');
    // The last page offers nothing older.
    expect(olderCursor(second)).toBeNull();
  });

  it('narrows to a range of the workspace’s days', async () => {
    const day = await open({ from: '2026-10-01', to: '2026-10-01' });
    expect(day).toContain('Early 2');
    expect(day).not.toContain('Probe 0');
    const later = await open({ from: '2026-10-02' });
    expect(later).toContain('Probe 0');
    expect(later).not.toContain('Early 0');
    // A malformed date is ignored, not a crash: the shape alone is not a day.
    expect(await open({ from: 'yesterday' })).toContain('Probe 0');
    expect(await open({ from: '2026-00-10' })).toContain('Probe 0');
    expect(await open({ to: '2026-10-00' })).toContain('Probe 0');
    expect(await open({ to: '0000-01-01' })).toContain('Probe 0');
  });
});
