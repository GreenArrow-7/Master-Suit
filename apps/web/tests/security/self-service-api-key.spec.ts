/**
 * A notification feed answers "your own record", so only a person may read it.
 *
 * `selfService: true` waives the permission check by design — that is what lets
 * an HR-only employee read their own notifications without holding a Sales
 * grant. An API key authenticates through the same kernel and inherits
 * `actor.id = key.createdById`, so without the route's own refusal any key in
 * the tenant would reach the creator's feed regardless of its scopes, and could
 * mark their alerts read.
 *
 * Scope note: this is enforced by /api/v1/notifications itself, not by the
 * handler kernel. The other self-service routes (identity/self, hr/self) still
 * accept API keys, deliberately and unchanged — so this spec covers
 * notifications only and must not be read as a platform-wide guarantee.
 *
 * The key issued below holds the tenant's full administrator role — the most
 * generous credential the fixture can mint — so a pass here is not "the key was
 * under-privileged", it is "a machine credential is refused on principle".
 */
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { issueApiKey } from '@/lib/auth/apiKey';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { get, patch } from '../helpers/request';
import { GET as listNotifications, PATCH as markNotifications } from '@/app/api/v1/notifications/route';

let fixture: Fixture;
let apiKey: string;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const user = await prisma.user.findFirstOrThrow({
    where: { id: fixture.a.userId, tenantId: fixture.a.tenantId },
    select: { roleId: true },
  });
  const issued = await issueApiKey(fixture.a.tenantId, 'budget-test-key', user.roleId, [], fixture.a.userId);
  apiKey = issued.key;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('SELFSVC-001: the notifications feed refuses machine credentials', () => {
  it('lets a signed-in session read its own notifications', async () => {
    const res = await get(listNotifications, '/api/v1/notifications?unread=true', fixture.a.cookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.unreadCount).toBe('number');
  });

  it('refuses an API key on GET, however privileged the key is', async () => {
    const res = await get(listNotifications, '/api/v1/notifications?unread=true', { apiKey });
    expect(res.status).toBe(403);
    // The feed must not come back in the refusal body.
    expect(res.body.unreadCount).toBeUndefined();
    expect(res.body.data).toBeUndefined();
  });

  it('refuses an API key on PATCH, so it cannot mark the creator’s alerts read', async () => {
    const notification = await prisma.notification.create({
      data: {
        tenantId: fixture.a.tenantId,
        userId: fixture.a.userId,
        kind: 'TEST',
        title: 'Unread alert',
      },
    });

    const res = await patch(markNotifications, '/api/v1/notifications', { ids: [notification.id] }, { apiKey });
    expect(res.status).toBe(403);

    const after = await prisma.notification.findFirstOrThrow({
      where: { id: notification.id, tenantId: fixture.a.tenantId },
      select: { readAt: true },
    });
    expect(after.readAt).toBeNull();
  });
});
