import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as createBooking } from '@/app/api/v1/bookings/route';
import { POST as createCall } from '@/app/api/v1/calls/route';
import { POST as saveProfile } from '@/app/api/v1/client-profiles/route';
import { POST as createFollowUp } from '@/app/api/v1/follow-ups/route';
import { PATCH as patchFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { POST as createProposal } from '@/app/api/v1/proposals/route';
import { POST as referral } from '@/app/api/v1/referrals/route';
import { POST as createRequirement } from '@/app/api/v1/requirements/route';
import { POST as createVisit } from '@/app/api/v1/site-visits/route';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { POST as askTestimonial } from '@/app/api/v1/testimonials/route';
import { grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { patch, post } from '../helpers/request';

/**
 * A record names its lead in the body, so the lead has to be one the caller may
 * work. These routes checked their own module's permission and, at most, that
 * the lead was in the workspace: an agent at OWN scope could hang a call, visit,
 * task or sale on a colleague's lead and read its name back on their own
 * screens, or take the one referral code, testimonial ask or client profile a
 * lead may have. The activity route was the first of them (#136).
 */
let h: Hierarchy;
let typeId: string;
let listingId: string;
let campaignId: string;
let followUpId: string;
let taskId: string;
const MISSING = `c${'0'.repeat(24)}`;
const CODE = 'BCDFGHJK';
const soon = () => new Date(Date.now() + 86_400_000).toISOString();

const visit = (leadId: string) => ({ kind: 'CLIENT_MEETING', leadId, address: 'The office', scheduledAt: soon() });
const sale = (leadId: string) => ({ leadId, listingId, saleValue: 1_500_000, bookingDate: new Date().toISOString() });

/** Every write that names a lead, as the OWN-scope rep `as` sends it. */
const ATTACH = [
  {
    name: 'a call',
    send: (leadId: string, as: string) =>
      post(createCall, '/api/v1/calls', { leadId, recipientNumber: '+971500000001' }, as),
  },
  {
    name: 'a follow-up',
    send: (leadId: string, as: string) =>
      post(createFollowUp, '/api/v1/follow-ups', { leadId, title: 'Call back', dueAt: soon() }, as),
  },
  {
    name: 'moving a follow-up',
    send: (leadId: string, as: string) => patch(patchFollowUp, `/api/v1/follow-ups/${followUpId}`, { leadId }, as),
  },
  {
    name: 'a task',
    send: (leadId: string, as: string) =>
      post(createTask, '/api/v1/tasks', { typeId, leadId, title: 'Send the brochure', dueAt: soon() }, as),
  },
  {
    name: 'moving a task',
    send: (leadId: string, as: string) => patch(patchTask, `/api/v1/tasks/${taskId}`, { leadId }, as),
  },
  {
    name: 'a site visit',
    send: (leadId: string, as: string) => post(createVisit, '/api/v1/site-visits', visit(leadId), as),
  },
  {
    name: 'a requirement',
    send: (leadId: string, as: string) =>
      post(createRequirement, '/api/v1/requirements', { leadId, purpose: 'BUY' }, as),
  },
  {
    name: 'a shortlist',
    send: (leadId: string, as: string) =>
      post(createProposal, '/api/v1/proposals', { leadId, title: 'A few places', listingIds: [listingId] }, as),
  },
  { name: 'a sale', send: (leadId: string, as: string) => post(createBooking, '/api/v1/bookings', sale(leadId), as) },
  {
    name: 'a referral code',
    send: (leadId: string, as: string) => post(referral, '/api/v1/referrals', { action: 'ISSUE', leadId }, as),
  },
  {
    name: 'a referral credit',
    send: (leadId: string, as: string) =>
      post(referral, '/api/v1/referrals', { action: 'REDEEM', code: CODE, referredLeadId: leadId }, as),
  },
  {
    name: 'a testimonial ask',
    send: (leadId: string, as: string) => post(askTestimonial, '/api/v1/testimonials', { leadId }, as),
  },
  {
    name: 'a client profile',
    send: (leadId: string, as: string) =>
      post(saveProfile, '/api/v1/client-profiles', { leadId, profession: 'Engineer' }, as),
  },
];

beforeAll(async () => {
  h = await seedHierarchy();
  const { tenantId } = h;
  // The fixture's roles hold only `leads`; the rep gets each other module at OWN.
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: h.repA1.id },
    select: { roleId: true },
  });
  await grantPermissions(
    tenantId,
    roleId,
    [
      ['calls', 'CREATE'],
      ['visits', 'CREATE'],
      ['requirements', 'CREATE'],
      ['bookings', 'CREATE'],
      ['referrals', 'CREATE'],
      ['testimonials', 'CREATE'],
      ['clientprofiles', 'CREATE'],
      ['dialer', 'VIEW'],
    ],
    'OWN',
  );

  typeId = (await prisma.taskType.create({ data: { tenantId, key: 'call', name: 'Call' } })).id;
  listingId = (
    await prisma.listing.create({
      data: {
        tenantId,
        reference: 'LS-ATTACH',
        title: 'Marina two bed',
        listingType: 'SALE',
        status: 'ACTIVE',
        price: new Prisma.Decimal(1_800_000),
        ownerId: h.repA1.id,
      },
    })
  ).id;
  const own = { tenantId, ownerId: h.repA1.id, leadId: h.repA1.leadId, dueAt: new Date(soon()) };
  followUpId = (await prisma.followUpTask.create({ data: { ...own, title: 'Chase' } })).id;
  taskId = (await prisma.task.create({ data: { ...own, typeId, title: 'Chase' } })).id;
  // A code the rep's own client holds; the credit is what names a lead.
  const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: h.repA1.leadId } });
  const referrer = await prisma.lead.create({
    data: { tenantId, reference: 'REFERRER', fullName: 'Referrer', stageId, ownerId: h.repA1.id },
  });
  await prisma.referralCode.create({
    data: { tenantId, code: CODE, leadId: referrer.id, issuedById: h.repA1.id, ownerId: h.repA1.id },
  });
  // A calling campaign whose queue holds a lead in the other team.
  campaignId = (
    await prisma.campaign.create({
      data: { tenantId, name: 'Launch calls', code: 'LC-ATTACH', campaignType: 'CALLING', status: 'RUNNING' },
    })
  ).id;
  await prisma.campaignContact.create({
    data: { tenantId, campaignId, leadId: h.repB1.leadId, displayName: 'repB1 lead', phone: '+971500000009' },
  });
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe.each(ATTACH)('$name', ({ send }) => {
  it('refuses a teammate’s lead exactly as a lead that does not exist', async () => {
    const theirs = await send(h.repA2.leadId, h.repA1.cookie);
    const missing = await send(MISSING, h.repA1.cookie);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.detail).toBe(missing.body.detail);
  });

  it('takes the caller’s own lead', async () => {
    const res = await send(h.repA1.leadId, h.repA1.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe('the refusals', () => {
  it('left nothing on the teammate’s lead', async () => {
    const where = { tenantId: h.tenantId, leadId: h.repA2.leadId };
    const counts = await Promise.all([
      prisma.call.count({ where }),
      prisma.followUpTask.count({ where }),
      prisma.task.count({ where }),
      prisma.siteVisit.count({ where }),
      prisma.clientRequirement.count({ where }),
      prisma.proposal.count({ where }),
      prisma.booking.count({ where }),
      prisma.referralCode.count({ where }),
      prisma.referral.count({ where: { tenantId: h.tenantId, referredLeadId: h.repA2.leadId } }),
      prisma.testimonial.count({ where }),
      prisma.clientProfile.count({ where }),
    ]);
    expect(counts).toEqual(counts.map(() => 0));
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA2.leadId } });
    expect(lead.lastActivityAt).toBeNull();
    expect(lead.nextFollowUpAt).toBeNull();
  });
});

describe('a team manager', () => {
  it('works the team’s leads and not another team’s', async () => {
    const followUp = (leadId: string) =>
      post(createFollowUp, '/api/v1/follow-ups', { leadId, title: 'Coach', dueAt: soon() }, h.teamManagerA.cookie);
    expect((await followUp(h.repA1.leadId)).status).toBe(200);
    expect((await followUp(h.repB1.leadId)).status).toBe(404);
  });
});

describe('the dialer', () => {
  it('calls a queued lead the agent does not own, and books a visit from that call — not a sale', async () => {
    const call = await post(
      createCall,
      '/api/v1/calls',
      { leadId: h.repB1.leadId, campaignId, recipientNumber: '+971500000009' },
      h.repA1.cookie,
    );
    expect(call.status, JSON.stringify(call.body)).toBe(200);
    expect((await post(createVisit, '/api/v1/site-visits', visit(h.repB1.leadId), h.repA1.cookie)).status).toBe(200);
    expect((await post(createBooking, '/api/v1/bookings', sale(h.repB1.leadId), h.repA1.cookie)).status).toBe(404);
  });
});
