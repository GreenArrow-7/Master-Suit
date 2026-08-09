/**
 * Testimonials.
 *
 * An agent asks, the client writes it themselves over a signed link, and
 * somebody else decides whether it goes anywhere. Those are three different
 * people and three different authorities, which is why this is a small state
 * machine rather than an editable text field on a lead.
 *
 * The client's own words are written once, by them, through `submit` — no staff
 * path sets `body`, `rating` or `consentToPublish`. A testimonial staff can
 * write on a client's behalf is not a testimonial.
 */
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { assertRecordVisible } from '@/lib/security/visibility';
import { publicLink } from '@/lib/publicLink';

export const TESTIMONIAL_STATUSES = ['REQUESTED', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'DECLINED'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/** The client's link. Domain-separated, so it cannot answer an event RSVP. */
export const testimonialLink = publicLink('testimonial', 'testimonial');

const ALLOWED: Record<TestimonialStatus, readonly TestimonialStatus[]> = {
  REQUESTED: ['SUBMITTED', 'DECLINED'],
  SUBMITTED: ['APPROVED', 'DECLINED'],
  APPROVED: ['PUBLISHED', 'DECLINED'],
  // Taking something down is a decline: the client changed their mind, and the
  // reason belongs with it.
  PUBLISHED: ['DECLINED'],
  DECLINED: [],
};

export const canTransition = (from: TestimonialStatus, to: TestimonialStatus) => ALLOWED[from].includes(to);

export interface RequestInput {
  ctx: Ctx;
  leadId?: string | null;
  contactId?: string | null;
  message?: string;
}

/** Asking. Creates the row the public link points at. */
export async function requestTestimonial(input: RequestInput) {
  const { ctx } = input;
  if (!input.leadId && !input.contactId) {
    throw Invalid([{ field: 'leadId', code: 'required', message: 'Say who you are asking.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    // Asking the same person twice while the first ask is still open reads as
    // nagging on their side and as two rows on yours.
    const open = await tx.testimonial.findFirst({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        status: { in: ['REQUESTED', 'SUBMITTED'] },
        ...(input.leadId ? { leadId: input.leadId } : { contactId: input.contactId }),
      },
      select: { id: true, status: true },
    });
    if (open) {
      throw Conflict(`You already have a ${open.status.toLowerCase()} testimonial request with this client.`);
    }

    const testimonial = await tx.testimonial.create({
      data: {
        tenantId: ctx.tenantId,
        leadId: input.leadId ?? null,
        contactId: input.contactId ?? null,
        requestedById: ctx.actor.id,
        requestMessage: input.message,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'testimonials',
        recordId: testimonial.id,
        previousValue: {},
        newValue: { leadId: input.leadId, contactId: input.contactId, message: input.message },
      },
      tx,
    );

    return { testimonial, url: testimonialLink.url(ctx.tenantId, testimonial.id) };
  });
}

export interface SubmitInput {
  token: string;
  rating: number;
  body: string;
  consentToPublish: boolean;
  displayName?: string;
}

/**
 * The client writing it, unauthenticated.
 *
 * Scoped by the tenant carried in the token, exactly as the RSVP path is, so
 * this never becomes an unscoped lookup the tenant guard has to be excused from.
 * Re-submitting is allowed while it is still `REQUESTED` — people reread what
 * they wrote and change a word — but once somebody has read it, editing it
 * behind their back is not on.
 */
export async function submitTestimonial(input: SubmitInput) {
  const claim = testimonialLink.verify(input.token);
  if (!claim) throw NotFound('Testimonial request');

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw Invalid([{ field: 'rating', code: 'range', message: 'Ratings run from 1 to 5.' }]);
  }
  if (input.body.trim().length === 0) {
    throw Invalid([{ field: 'body', code: 'required', message: 'Write a line or two.' }]);
  }

  return withTx(claim.tenantId, async (tx) => {
    const existing = await tx.testimonial.findFirst({
      where: { id: claim.recordId, tenantId: claim.tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) throw NotFound('Testimonial request');

    if (existing.status !== 'REQUESTED') {
      throw Conflict(
        existing.status === 'DECLINED'
          ? 'This request was closed.'
          : 'Thank you — this has already been submitted and is being reviewed.',
      );
    }

    const testimonial = await tx.testimonial.update({
      where: { id: existing.id, tenantId: claim.tenantId },
      data: {
        status: 'SUBMITTED',
        rating: input.rating,
        body: input.body.trim(),
        // Only ever set here, from the client's own tick.
        consentToPublish: input.consentToPublish,
        displayName: input.displayName?.trim() || null,
        submittedAt: new Date(),
      },
    });

    return testimonial;
  });
}

export interface DecideInput {
  ctx: Ctx;
  testimonialId: string;
  to: TestimonialStatus;
  reason?: string;
}

/** Approving, publishing, or closing it. */
export async function decideTestimonial(input: DecideInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const existing = await tx.testimonial.findFirst({
      where: { id: input.testimonialId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!existing) throw NotFound('Testimonial');
    await assertRecordVisible(ctx, 'testimonials', existing, tx, 'EDIT');

    const from = existing.status as TestimonialStatus;
    if (!canTransition(from, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A ${from.toLowerCase()} testimonial cannot become ${input.to.toLowerCase()}.`,
        },
      ]);
    }

    if (input.to === 'SUBMITTED') {
      // The client's words arrive through the public link and nowhere else.
      throw Forbidden('Only the client can submit their own testimonial.');
    }

    if ((input.to === 'APPROVED' || input.to === 'PUBLISHED') && !can(ctx, 'testimonials', 'APPROVE')) {
      throw Forbidden('Deciding what goes out under a client’s name is an approval.');
    }

    if (input.to === 'PUBLISHED' && !existing.consentToPublish) {
      // The database refuses this too. Caught here so the answer is a sentence
      // rather than a constraint violation.
      throw Conflict('This client did not agree to have their words published.');
    }

    if (input.to === 'DECLINED' && !input.reason?.trim()) {
      throw Invalid([
        { field: 'reason', code: 'required', message: 'Say why, so nobody asks them again next quarter.' },
      ]);
    }

    const testimonial = await tx.testimonial.update({
      where: { id: existing.id, tenantId: ctx.tenantId },
      data: {
        status: input.to,
        approvedById: input.to === 'APPROVED' ? ctx.actor.id : undefined,
        approvedAt: input.to === 'APPROVED' ? new Date() : undefined,
        publishedAt: input.to === 'PUBLISHED' ? new Date() : undefined,
        declinedAt: input.to === 'DECLINED' ? new Date() : undefined,
        declineReason: input.to === 'DECLINED' ? input.reason!.trim() : undefined,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'testimonials',
        recordId: existing.id,
        previousValue: { status: from },
        newValue: { status: input.to, reason: input.reason },
      },
      tx,
    );

    return { testimonial, from };
  });
}

/**
 * What the public page shows the client before they write.
 *
 * Deliberately thin: who is asking and what they asked. Returning the lead
 * record would hand anybody holding a link the client's own file.
 */
export async function requestForToken(token: string) {
  const claim = testimonialLink.verify(token);
  if (!claim) return null;

  const testimonial = await prisma.testimonial.findFirst({
    where: { id: claim.recordId, tenantId: claim.tenantId, deletedAt: null },
    select: { id: true, status: true, requestMessage: true, requestedAt: true },
  });
  if (!testimonial) return null;

  const workspace = await prisma.tenant.findFirst({
    where: { id: claim.tenantId },
    select: { displayName: true },
  });

  return { ...testimonial, workspaceName: workspace?.displayName ?? null };
}
