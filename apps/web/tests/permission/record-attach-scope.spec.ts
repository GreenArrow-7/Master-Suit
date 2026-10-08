import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as createCall } from '@/app/api/v1/calls/route';
import { POST as saveProfile } from '@/app/api/v1/client-profiles/route';
import { POST as createFollowUp } from '@/app/api/v1/follow-ups/route';
import { POST as referral } from '@/app/api/v1/referrals/route';
import { POST as createRequirement } from '@/app/api/v1/requirements/route';
import { POST as createVisit } from '@/app/api/v1/site-visits/route';
import { POST as askTestimonial } from '@/app/api/v1/testimonials/route';
import { grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { post } from '../helpers/request';

/**
 * #140 checked the lead a body names. The same bodies name a contact or a
 * call, and those got a workspace check at most: an agent at OWN scope could
 * read a colleague's contact back through a call's follow-up email or a
 * visit's page, take the one referral code, testimonial ask or client profile
 * a contact may have, or put a follow-up on a colleague's call page.
 */
type Ref = 'contact' | 'call';
let h: Hierarchy;
const mine = {} as Record<Ref, string>;
const theirs = {} as Record<Ref, string>;
let otherTeamContact: string;
let unassignedContact: string;
const MISSING = `c${'0'.repeat(24)}`;
const soon = () => new Date(Date.now() + 86_400_000).toISOString();

/** Every write that names a contact or a call, as the OWN-scope rep `as` sends it. */
const ATTACH: { name: string; ref: Ref; send: (id: string, as: string) => ReturnType<typeof post> }[] = [
  {
    name: 'a call with a contact',
    ref: 'contact',
    send: (contactId, as) => post(createCall, '/api/v1/calls', { contactId, recipientNumber: '+971500000001' }, as),
  },
  {
    name: 'a site visit',
    ref: 'contact',
    send: (contactId, as) =>
      post(
        createVisit,
        '/api/v1/site-visits',
        { kind: 'CLIENT_MEETING', contactId, address: 'The office', scheduledAt: soon() },
        as,
      ),
  },
  {
    name: 'a requirement',
    ref: 'contact',
    send: (contactId, as) => post(createRequirement, '/api/v1/requirements', { contactId, purpose: 'BUY' }, as),
  },
  {
    name: 'a referral code',
    ref: 'contact',
    send: (contactId, as) => post(referral, '/api/v1/referrals', { action: 'ISSUE', contactId }, as),
  },
  {
    name: 'a testimonial ask',
    ref: 'contact',
    send: (contactId, as) => post(askTestimonial, '/api/v1/testimonials', { contactId }, as),
  },
  {
    name: 'a client profile',
    ref: 'contact',
    send: (contactId, as) => post(saveProfile, '/api/v1/client-profiles', { contactId, profession: 'Engineer' }, as),
  },
  {
    name: 'a follow-up from a call',
    ref: 'call',
    send: (callId, as) => post(createFollowUp, '/api/v1/follow-ups', { callId, title: 'Call back', dueAt: soon() }, as),
  },
];

beforeAll(async () => {
  h = await seedHierarchy();
  const { tenantId } = h;
  // The fixture's roles hold only `leads`. The reps get each other module at
  // OWN, the team manager reads and claims contacts across the team.
  const roleOf = async (id: string) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId, id }, select: { roleId: true } })).roleId;
  await grantPermissions(
    tenantId,
    await roleOf(h.repA1.id),
    [
      ['calls', 'CREATE'],
      ['visits', 'CREATE'],
      ['requirements', 'CREATE'],
      ['referrals', 'CREATE'],
      ['testimonials', 'CREATE'],
      ['clientprofiles', 'CREATE'],
      ['contacts', 'VIEW'],
    ],
    'OWN',
  );
  await grantPermissions(
    tenantId,
    await roleOf(h.teamManagerA.id),
    [
      ['requirements', 'CREATE'],
      ['contacts', 'VIEW'],
      ['contacts', 'ASSIGN'],
    ],
    'TEAM',
  );

  const contact = async (reference: string, ownerId: string | null) =>
    (await prisma.contact.create({ data: { tenantId, reference, fullName: reference, ownerId } })).id;
  mine.contact = await contact('CT-A1', h.repA1.id);
  theirs.contact = await contact('CT-A2', h.repA2.id);
  otherTeamContact = await contact('CT-B1', h.repB1.id);
  unassignedContact = await contact('CT-NONE', null);

  const call = async (callerId: string) =>
    (await prisma.call.create({ data: { tenantId, callerId, recipientNumber: '+971500000003' } })).id;
  mine.call = await call(h.repA1.id);
  theirs.call = await call(h.repA2.id);
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe.each(ATTACH)('$name', ({ ref, send }) => {
  it('refuses a teammate’s record exactly as one that does not exist', async () => {
    const theirsRes = await send(theirs[ref], h.repA1.cookie);
    const missing = await send(MISSING, h.repA1.cookie);
    expect(theirsRes.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirsRes.body.detail).toBe(missing.body.detail);
  });

  it('takes the caller’s own', async () => {
    const res = await send(mine[ref], h.repA1.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe('the refusals', () => {
  it('left nothing on the teammate’s contact or call', async () => {
    const { tenantId } = h;
    const contactId = theirs.contact;
    const counts = await Promise.all([
      prisma.call.count({ where: { tenantId, contactId } }),
      prisma.siteVisit.count({ where: { tenantId, contactId } }),
      prisma.clientRequirement.count({ where: { tenantId, contactId } }),
      prisma.referralCode.count({ where: { tenantId, contactId } }),
      prisma.testimonial.count({ where: { tenantId, contactId } }),
      prisma.clientProfile.count({ where: { tenantId, contactId } }),
      prisma.followUpTask.count({ where: { tenantId, callId: theirs.call } }),
    ]);
    expect(counts).toEqual(counts.map(() => 0));
  });
});

describe('a contact follows the contacts list’s rule', () => {
  const requirement = (contactId: string, as: string) =>
    post(createRequirement, '/api/v1/requirements', { contactId, purpose: 'RENT' }, as);

  it('a team manager names the team’s contacts and not another team’s', async () => {
    expect((await requirement(mine.contact, h.teamManagerA.cookie)).status).toBe(200);
    expect((await requirement(otherTeamContact, h.teamManagerA.cookie)).status).toBe(404);
  });

  it('an unassigned contact is for those who may claim it', async () => {
    expect((await requirement(unassignedContact, h.repA1.cookie)).status).toBe(404);
    expect((await requirement(unassignedContact, h.teamManagerA.cookie)).status).toBe(200);
  });
});
