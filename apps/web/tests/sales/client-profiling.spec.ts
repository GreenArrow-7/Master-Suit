import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { completeness, deleteProfile, profileFor, upsertProfile } from '@/services/clients/profile';
import {
  canTransition as canTestimonialTransition,
  decideTestimonial,
  requestTestimonial,
  submitTestimonial,
  testimonialLink,
} from '@/services/clients/testimonials';
import {
  canTransition as canReferralTransition,
  deactivateCode,
  issueCode,
  progressReferral,
  redeemCode,
  referrerScoreboard,
} from '@/services/clients/referrals';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx, Scope } from '@/lib/security/rbac';

/**
 * M3 — who the buyer is, what they say about you, and who they send next.
 *
 * The properties worth pinning are the ones a form cannot enforce: one profile
 * per person, a testimonial nobody on staff can write, and a referral that two
 * agents cannot both claim.
 */
let fixture: Fixture;
let agent: Ctx;
let approver: Ctx;

const perms = (extra: [string, Scope][] = []) =>
  new Map<string, Scope>([
    ['clientprofiles:VIEW', 'ORGANIZATION'],
    ['clientprofiles:CREATE', 'ORGANIZATION'],
    ['clientprofiles:EDIT', 'ORGANIZATION'],
    ['clientprofiles:DELETE', 'ORGANIZATION'],
    ['testimonials:VIEW', 'ORGANIZATION'],
    ['testimonials:CREATE', 'ORGANIZATION'],
    ['testimonials:EDIT', 'ORGANIZATION'],
    ['referrals:VIEW', 'ORGANIZATION'],
    ['referrals:CREATE', 'ORGANIZATION'],
    ['referrals:EDIT', 'ORGANIZATION'],
    ...extra,
  ]);

beforeAll(async () => {
  fixture = await seedTwoTenants();
  agent = buildCtx(buildActor({ id: fixture.a.userId, tenantId: fixture.a.tenantId, permissions: perms() }));
  approver = buildCtx(
    buildActor({
      id: 'profiling-approver',
      tenantId: fixture.a.tenantId,
      permissions: perms([['testimonials:APPROVE', 'ORGANIZATION']]),
    }),
  );
});

/**
 * Cleanup, one tenant at a time.
 *
 * `tenantId: { in: [a, b] }` is not a literal id, so the tenant guard cannot pin
 * `app.tenant_id` for it — row-level security then matches nothing and the
 * delete reports success having removed nothing at all. Two scalar calls.
 */
async function wipe(fn: (tenantId: string) => Promise<unknown>) {
  await fn(fixture.a.tenantId);
  await fn(fixture.b.tenantId);
}

/** Referral before ReferralCode: the foreign key is RESTRICT. */
const clear = () =>
  wipe(async (tenantId) => {
    await prisma.referral.deleteMany({ where: { tenantId } });
    await prisma.referralCode.deleteMany({ where: { tenantId } });
    await prisma.testimonial.deleteMany({ where: { tenantId } });
    await prisma.clientProfile.deleteMany({ where: { tenantId } });
  });

beforeEach(clear);

afterAll(async () => {
  await clear();
  await fixture.cleanup();
});

const lead = (i = 0) => fixture.a.leadIds[i];

describe('the client profile', () => {
  it('saves one step without blanking another', async () => {
    await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { profession: 'Cardiologist' } });
    await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { investmentCapacity: 2_500_000 } });

    const { profile } = await profileFor(agent, { leadId: lead() });
    // Step two must not erase step one — the difference between "not answered
    // yet" and "answered as nothing".
    expect(profile?.profession).toBe('Cardiologist');
    expect(profile?.investmentCapacity?.toString()).toBe('2500000');
  });

  it('keeps exactly one profile per person', async () => {
    const first = await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { profession: 'Pilot' } });
    const second = await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { profession: 'Captain' } });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.profile.id).toBe(first.profile.id);
    expect(await prisma.clientProfile.count({ where: { tenantId: fixture.a.tenantId, leadId: lead() } })).toBe(1);
  });

  it('refuses a profile that belongs to nobody, or to two people', async () => {
    await expect(upsertProfile({ ctx: agent, subject: {}, fields: {} })).rejects.toMatchObject({ status: 422 });
    await expect(
      upsertProfile({ ctx: agent, subject: { leadId: lead(), contactId: lead(1) }, fields: {} }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('treats the undecided defaults as unanswered', async () => {
    const empty = completeness({ purchaseIntent: 'UNDECIDED', education: 'UNDISCLOSED', languages: [] });
    // Otherwise every brand-new profile reports itself partly done and the
    // wizard opens on a step nobody has touched.
    expect(empty.percent).toBe(0);
    expect(empty.nextStep).toBe('identity');
  });

  it('walks the wizard forward as answers arrive', async () => {
    expect(completeness(null).nextStep).toBe('identity');

    await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { profession: 'Architect' } });
    let state = (await profileFor(agent, { leadId: lead() })).completeness;
    expect(state.nextStep).toBe('means');

    await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { investmentCapacity: 900_000 } });
    state = (await profileFor(agent, { leadId: lead() })).completeness;
    expect(state.nextStep).toBe('intent');

    await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { purchaseIntent: 'INVESTMENT' } });
    state = (await profileFor(agent, { leadId: lead() })).completeness;
    expect(state.nextStep).toBeNull();
  });

  it('refuses an income band that runs backwards', async () => {
    await expect(
      upsertProfile({
        ctx: agent,
        subject: { leadId: lead() },
        fields: { annualIncomeMin: 500_000, annualIncomeMax: 100_000 },
      }),
    ).rejects.toThrow();
  });

  it('frees the person up again after a soft delete', async () => {
    const { profile } = await upsertProfile({
      ctx: agent,
      subject: { leadId: lead() },
      fields: { profession: 'Chef' },
    });
    await deleteProfile({ ctx: agent, profileId: profile.id });

    // The partial unique index excludes soft-deleted rows, so somebody who
    // asked to be forgotten can still be profiled again later.
    const again = await upsertProfile({ ctx: agent, subject: { leadId: lead() }, fields: { profession: 'Chef' } });
    expect(again.created).toBe(true);
    expect(again.profile.id).not.toBe(profile.id);
  });
});

describe('testimonials', () => {
  it('permits only the moves the flow describes', () => {
    expect(canTestimonialTransition('REQUESTED', 'SUBMITTED')).toBe(true);
    expect(canTestimonialTransition('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTestimonialTransition('APPROVED', 'PUBLISHED')).toBe(true);
    expect(canTestimonialTransition('REQUESTED', 'PUBLISHED')).toBe(false);
    expect(canTestimonialTransition('DECLINED', 'APPROVED')).toBe(false);
  });

  it('will not let staff write the client’s words', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    await expect(
      decideTestimonial({ ctx: approver, testimonialId: testimonial.id, to: 'SUBMITTED' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('takes the client’s own submission over the link', async () => {
    const { testimonial, url } = await requestTestimonial({ ctx: agent, leadId: lead() });
    expect(url).toContain(testimonialLink.token(fixture.a.tenantId, testimonial.id));

    const submitted = await submitTestimonial({
      token: testimonialLink.token(fixture.a.tenantId, testimonial.id),
      rating: 5,
      body: 'Patient, straight with me, and found the place in a fortnight.',
      consentToPublish: true,
      displayName: 'A. K.',
    });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.consentToPublish).toBe(true);
  });

  it('refuses a token from another tenant', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    await expect(
      submitTestimonial({
        token: testimonialLink.token(fixture.b.tenantId, testimonial.id),
        rating: 5,
        body: 'Nice',
        consentToPublish: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to publish what the client did not consent to', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    await submitTestimonial({
      token: testimonialLink.token(fixture.a.tenantId, testimonial.id),
      rating: 4,
      body: 'Good service, but please do not put my name on anything.',
      consentToPublish: false,
    });
    await decideTestimonial({ ctx: approver, testimonialId: testimonial.id, to: 'APPROVED' });

    await expect(
      decideTestimonial({ ctx: approver, testimonialId: testimonial.id, to: 'PUBLISHED' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('needs the approve permission to publish', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    await submitTestimonial({
      token: testimonialLink.token(fixture.a.tenantId, testimonial.id),
      rating: 5,
      body: 'Excellent throughout.',
      consentToPublish: true,
    });
    await expect(
      decideTestimonial({ ctx: agent, testimonialId: testimonial.id, to: 'APPROVED' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('will not take a second submission once somebody has read it', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    const token = testimonialLink.token(fixture.a.tenantId, testimonial.id);
    await submitTestimonial({ token, rating: 5, body: 'First words.', consentToPublish: true });

    await expect(
      submitTestimonial({ token, rating: 1, body: 'Second thoughts.', consentToPublish: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a second open request to the same client', async () => {
    await requestTestimonial({ ctx: agent, leadId: lead() });
    await expect(requestTestimonial({ ctx: agent, leadId: lead() })).rejects.toMatchObject({ status: 409 });
  });

  it('needs a reason to decline, so nobody asks them again next quarter', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    await expect(
      decideTestimonial({ ctx: agent, testimonialId: testimonial.id, to: 'DECLINED' }),
    ).rejects.toMatchObject({ status: 422 });

    const declined = await decideTestimonial({
      ctx: agent,
      testimonialId: testimonial.id,
      to: 'DECLINED',
      reason: 'Client asked not to be quoted.',
    });
    expect(declined.testimonial.status).toBe('DECLINED');
  });

  it('rejects a rating outside one to five', async () => {
    const { testimonial } = await requestTestimonial({ ctx: agent, leadId: lead() });
    await expect(
      submitTestimonial({
        token: testimonialLink.token(fixture.a.tenantId, testimonial.id),
        rating: 7,
        body: 'Off the scale.',
        consentToPublish: true,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('referrals', () => {
  it('permits only the moves the flow describes', () => {
    expect(canReferralTransition('PENDING', 'QUALIFIED')).toBe(true);
    expect(canReferralTransition('QUALIFIED', 'CONVERTED')).toBe(true);
    expect(canReferralTransition('PENDING', 'CONVERTED')).toBe(false);
    expect(canReferralTransition('CONVERTED', 'REJECTED')).toBe(false);
  });

  it('issues a code from an alphabet nobody has to spell out', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    // No vowels, no 0/O, no 1/I/L — it gets read down a phone line.
    expect(code.code).toMatch(/^[BCDFGHJKMNPQRSTVWXYZ23456789]{8}$/);
  });

  it('refuses a second live code for the same client', async () => {
    await issueCode({ ctx: agent, leadId: lead() });
    await expect(issueCode({ ctx: agent, leadId: lead() })).rejects.toMatchObject({ status: 409 });
  });

  it('issues again once the first is retired', async () => {
    const first = await issueCode({ ctx: agent, leadId: lead() });
    await deactivateCode({ ctx: agent, codeId: first.id });
    const second = await issueCode({ ctx: agent, leadId: lead() });
    expect(second.id).not.toBe(first.id);
  });

  it('credits a lead to whoever’s code they arrived with, and freezes it', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    const referral = await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) });

    expect(referral.referrerLeadId).toBe(lead());
    expect(referral.status).toBe('PENDING');

    // Retiring the code must not un-credit the introduction.
    await deactivateCode({ ctx: agent, codeId: code.id });
    const after = await prisma.referral.findFirstOrThrow({ where: { id: referral.id, tenantId: fixture.a.tenantId } });
    expect(after.referrerLeadId).toBe(lead());
  });

  it('accepts a code typed in lower case with stray spaces', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    const referral = await redeemCode({ ctx: agent, code: `  ${code.code.toLowerCase()} `, referredLeadId: lead(1) });
    expect(referral.codeId).toBe(code.id);
  });

  it('refuses to credit the same lead twice', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) });

    const other = await issueCode({ ctx: agent, leadId: lead(2) });
    // Two agents both claiming to have introduced the same buyer is a
    // commission dispute.
    await expect(redeemCode({ ctx: agent, code: other.code, referredLeadId: lead(1) })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('will not let anybody refer themselves', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    await expect(redeemCode({ ctx: agent, code: code.code, referredLeadId: lead() })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('stops honouring a code once its use limit is reached', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead(), maxUses: 1 });
    await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) });
    await expect(redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(2) })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('stops honouring an expired code', async () => {
    const code = await prisma.referralCode.create({
      data: {
        tenantId: fixture.a.tenantId,
        code: 'EXPIRED9',
        leadId: lead(),
        issuedById: agent.actor.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('needs a reason to reject, and refuses illegal jumps', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    const referral = await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) });

    await expect(progressReferral({ ctx: agent, referralId: referral.id, to: 'CONVERTED' })).rejects.toMatchObject({
      status: 422,
    });
    await expect(progressReferral({ ctx: agent, referralId: referral.id, to: 'REJECTED' })).rejects.toMatchObject({
      status: 422,
    });

    await progressReferral({ ctx: agent, referralId: referral.id, to: 'QUALIFIED' });
    const done = await progressReferral({ ctx: agent, referralId: referral.id, to: 'CONVERTED' });
    expect(done.referral.convertedAt).not.toBeNull();
  });

  it('counts who has actually sent business', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    const first = await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) });
    await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(2) });
    await progressReferral({ ctx: agent, referralId: first.id, to: 'QUALIFIED' });
    await progressReferral({ ctx: agent, referralId: first.id, to: 'CONVERTED' });

    const board = await referrerScoreboard(fixture.a.tenantId);
    expect(board).toHaveLength(1);
    expect(board[0].referrerLeadId).toBe(lead());
    expect(board[0].total).toBe(2);
    expect(board[0].counts.CONVERTED).toBe(1);
    expect(board[0].counts.PENDING).toBe(1);
  });

  it('keeps one tenant’s referrals out of another’s scoreboard', async () => {
    const code = await issueCode({ ctx: agent, leadId: lead() });
    await redeemCode({ ctx: agent, code: code.code, referredLeadId: lead(1) });
    expect(await referrerScoreboard(fixture.b.tenantId)).toHaveLength(0);
  });
});
