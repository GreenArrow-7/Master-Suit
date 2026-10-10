import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { mockOutbox } from '@/lib/mailer';
import { verifyPassword } from '@/lib/auth/password';
import { settingCacheKey } from '@/lib/platform-settings';
import { POST as requestSignup } from '@/app/api/v1/public/signup/route';
import { POST as confirmSignup } from '@/app/api/v1/public/signup/confirm/route';
import { post } from '../helpers/request';

/**
 * Self-serve sign-up (Lead Eagle plan, gap 8): closed until the platform owner
 * opens it; an emailed link, not the form, makes the workspace; one link, one
 * workspace; and an address that already has an account here keeps it.
 */
const suffix = randomBytes(4).toString('hex');
const PASSWORD = 'Trial-Pass-2026';
const made: string[] = [];
let planId = '';

async function setTrialDays(days: number) {
  await prisma.platformSetting.upsert({
    where: { key: 'signupTrialDays' },
    update: { value: String(days) },
    create: { key: 'signupTrialDays', value: String(days) },
  });
  await redis.del(settingCacheKey('signupTrialDays'));
}

const ask = (slug: string, email: string, password = PASSWORD) =>
  post(requestSignup, '/api/v1/public/signup', {
    companyName: 'Harbour Homes',
    slug,
    fullName: 'Noor Haddad',
    email,
    password,
  });

/** The token from the last mail to `email`. */
function tokenFor(email: string) {
  const mail = mockOutbox.lastTo(email);
  const token = /token=([^\s&]+)/.exec(mail?.body ?? '')?.[1];
  if (!token) throw new Error(`no sign-up link mailed to ${email}`);
  return decodeURIComponent(token);
}

const confirm = (token: string) => post(confirmSignup, '/api/v1/public/signup/confirm', { token });

beforeAll(async () => {
  planId = (
    await prisma.subscriptionPlan.create({
      data: {
        code: `le-trial-${suffix}`,
        name: 'Lead Eagle trial',
        modules: ['LEAD_EAGLE'],
        seatLimit: 1,
        storageMb: 512,
      },
    })
  ).id;
});

// Every request here comes from one address; the hourly limit is the route's, not the spec's.
beforeEach(async () => {
  const buckets = await redis.keys('rl:route:settings:*');
  if (buckets.length) await redis.del(...buckets);
});

afterAll(async () => {
  await setTrialDays(0);
  for (const slug of made) {
    const tenant = await prisma.tenant.findFirst({ where: { slug }, select: { id: true } });
    if (tenant) await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { endsWith: `@signup-${suffix}.test` } } });
  await prisma.signupRequest.deleteMany({ where: { email: { endsWith: `@signup-${suffix}.test` } } });
  await prisma.subscriptionPlan.delete({ where: { id: planId } }).catch(() => {});
});

describe('self-serve sign-up', () => {
  it('is a 404 while closed', async () => {
    await setTrialDays(0);
    expect((await ask(`harbour-${suffix}`, `noor@signup-${suffix}.test`)).status).toBe(404);
  });

  it('stays closed while no active plan includes Lead Eagle, so nobody is mailed a dead link', async () => {
    await setTrialDays(14);
    const others = await prisma.subscriptionPlan.findMany({
      where: { active: true, modules: { has: 'LEAD_EAGLE' } },
      select: { id: true },
    });
    await prisma.subscriptionPlan.updateMany({
      where: { id: { in: others.map((p) => p.id) } },
      data: { active: false },
    });
    try {
      expect((await ask(`harbour-${suffix}`, `noor@signup-${suffix}.test`)).status).toBe(404);
    } finally {
      await prisma.subscriptionPlan.updateMany({
        where: { id: { in: others.map((p) => p.id) } },
        data: { active: true },
      });
    }
  });

  it('mails a link, and the link makes a Lead Eagle workspace on a trial', async () => {
    await setTrialDays(14);
    const slug = `harbour-${suffix}`;
    const email = `noor@signup-${suffix}.test`;
    const asked = await ask(slug, email);
    expect(asked.status).toBe(200);
    // Nothing exists until the link is used.
    expect(await prisma.tenant.count({ where: { slug } })).toBe(0);

    const done = await confirm(tokenFor(email));
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ slug, email, reusedExistingIdentity: false });
    made.push(slug);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug }, select: { id: true } });
    const entitlements = await prisma.moduleEntitlement.findMany({ where: { tenantId: tenant.id } });
    expect(entitlements.map((m) => [m.module, m.state])).toEqual([['LEAD_EAGLE', 'TRIAL']]);
    const days = (entitlements[0]!.endsAt!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(14);
    expect(await prisma.leadStage.count({ where: { tenantId: tenant.id, isDefault: true } })).toBe(1);
    const identity = await prisma.platformUser.findFirstOrThrow({ where: { normalizedEmail: email } });
    expect(await verifyPassword(identity.passwordHash!, PASSWORD)).toBe(true);
  });

  it('makes one workspace per link', async () => {
    const email = `noor@signup-${suffix}.test`;
    expect((await confirm(tokenFor(email))).status).toBe(404);
  });

  it('refuses a taken or reserved address and a weak password, and mails nothing', async () => {
    const email = `other@signup-${suffix}.test`;
    expect((await ask(`harbour-${suffix}`, email)).status).toBe(409);
    expect((await ask('login', email)).status).toBe(409);
    expect((await ask(`fresh-${suffix}`, email, 'short')).status).toBe(422);
    expect(mockOutbox.lastTo(email)).toBeUndefined();
  });

  it('keeps an existing account’s password when its owner signs up a second company', async () => {
    const email = `noor@signup-${suffix}.test`;
    const slug = `harbour-two-${suffix}`;
    expect((await ask(slug, email, 'Different-Pass-2026')).status).toBe(200);
    const done = await confirm(tokenFor(email));
    expect(done.body).toEqual({ slug, email, reusedExistingIdentity: true });
    made.push(slug);
    const identity = await prisma.platformUser.findFirstOrThrow({ where: { normalizedEmail: email } });
    expect(await verifyPassword(identity.passwordHash!, PASSWORD)).toBe(true);
    expect(await prisma.workspaceMembership.count({ where: { platformUserId: identity.id } })).toBe(2);
  });

  it('does not bring back a suspended or deactivated account, and gives the link back', async () => {
    for (const status of ['SUSPENDED', 'DEACTIVATED'] as const) {
      const email = `${status.toLowerCase()}@signup-${suffix}.test`;
      await prisma.platformUser.create({
        data: { email, normalizedEmail: email, fullName: 'Old Account', status },
      });
      const slug = `${status.toLowerCase()}-co-${suffix}`;
      expect((await ask(slug, email)).status).toBe(200);
      const refused = await confirm(tokenFor(email));
      expect(refused.status).toBe(409);
      expect((await prisma.platformUser.findFirstOrThrow({ where: { normalizedEmail: email } })).status).toBe(status);
      expect(await prisma.tenant.count({ where: { slug } })).toBe(0);
      expect((await prisma.signupRequest.findFirstOrThrow({ where: { email } })).consumedAt).toBeNull();
    }
  });
});
