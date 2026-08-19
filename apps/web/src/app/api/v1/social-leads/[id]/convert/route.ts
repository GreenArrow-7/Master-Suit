import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { visibilityWhere } from '@/lib/security/visibility';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { nextReference } from '@/services/shared/reference';

/**
 * Layer 1 → Layer 2. The bridge the whole two-layer design exists to cross.
 *
 * A social enquiry becomes a CRM Lead only here, when a person decides it is
 * one. Meta gives a handle and a sentence — no email, no phone, no legal name —
 * so whatever the salesperson has actually collected comes from the request,
 * and anything they have not collected stays empty rather than invented.
 */
const params = z.object({ id: z.string().min(1).max(60) });

const body = z
  .object({
    fullName: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(160).optional(),
    stageId: z.string().max(60).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    ownerId: z.string().max(60).optional(),
  })
  .strict();

export const POST = route(
  { module: 'leads', action: 'CREATE', params, body, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    /**
     * Loaded through the visibility filter rather than by id, so a leaked or
     * guessed id from another workspace misses rather than being politely
     * refused — and RLS refuses it again underneath.
     */
    const visible = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
    const enquiry = await prisma.socialComment.findFirst({
      where: { ...visible, id: params.id },
      select: {
        id: true,
        provider: true,
        providerCommentId: true,
        providerAuthorId: true,
        authorName: true,
        commentText: true,
        commentCreatedAt: true,
        providerMediaId: true,
        mediaType: true,
        providerAdId: true,
        providerAdTitle: true,
        linkedLeadId: true,
        ownerId: true,
      },
    });
    if (!enquiry) throw NotFound('Social enquiry');
    if (enquiry.linkedLeadId) throw Conflict('This enquiry is already linked to a customer.');

    const phoneNormalized = body.phone ? normalizePhone(body.phone, 'AE') : null;
    const email = body.email?.toLowerCase() ?? null;

    /**
     * The same duplicate rules every other entry point obeys. A social prospect
     * who turns out to be an existing customer is *linked*, not duplicated —
     * which is the second half of keeping the CRM clean.
     */
    const [duplicate] = await findDuplicates(ctx.tenantId, {
      email,
      phoneNormalized,
      fullName: body.fullName,
    });

    const channel = enquiry.provider === 'instagram' ? 'Instagram' : 'Facebook';
    /**
     * Attribution that survives conversion (§41). Without it the lead is just a
     * name, and nobody can answer which post produced it — the question this
     * whole feature exists to make answerable.
     */
    const attribution = {
      channel,
      sourceDetail: `${channel} Comment`,
      comment: enquiry.commentText,
      commentedAt: enquiry.commentCreatedAt.toISOString(),
      providerCommentId: enquiry.providerCommentId,
      providerAuthorId: enquiry.providerAuthorId,
      authorHandle: enquiry.authorName,
      providerMediaId: enquiry.providerMediaId,
      mediaType: enquiry.mediaType,
      providerAdId: enquiry.providerAdId,
      providerAdTitle: enquiry.providerAdTitle,
      convertedAt: new Date().toISOString(),
    };

    if (duplicate) {
      // Merge, never replace: `customData` is shared with whatever else the
      // tenant keeps on the lead. `source` is left alone — a customer who first
      // arrived elsewhere did not become a social lead.
      const current = await prisma.lead.findFirst({
        where: { id: duplicate.id, tenantId: ctx.tenantId },
        select: { customData: true },
      });
      await prisma.lead.update({
        where: { id: duplicate.id, tenantId: ctx.tenantId },
        data: {
          lastActivityAt: new Date(),
          customData: {
            ...((current?.customData ?? {}) as Record<string, unknown>),
            socialEnquiry: attribution,
          },
        },
      });
      await prisma.socialComment.update({
        where: { id: enquiry.id, tenantId: ctx.tenantId },
        data: { linkedLeadId: duplicate.id, status: 'CONVERTED', convertedAt: new Date() },
      });
      return { leadId: duplicate.id, reference: duplicate.reference, linkedToExisting: true };
    }

    const stage = body.stageId
      ? await prisma.leadStage.findFirst({ where: { tenantId: ctx.tenantId, id: body.stageId }, select: { id: true } })
      : await prisma.leadStage.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true }, select: { id: true } });
    if (!stage) throw Conflict('This workspace has no lead stage to place the customer in.');

    const lead = await withTx(ctx.tenantId, async (tx) =>
      tx.lead.create({
        data: {
          tenantId: ctx.tenantId,
          reference: await nextReference(tx, ctx.tenantId, 'LEAD'),
          fullName: body.fullName,
          email,
          phone: body.phone ?? null,
          phoneNormalized,
          stageId: stage.id,
          priority: body.priority,
          // CHAT is the closest existing RecordSource; `sourceDetail` carries
          // the precise channel so reporting can say "Instagram Comment"
          // without a migration for one enum value.
          source: 'CHAT',
          sourceDetail: `${channel} Comment`,
          // They asked a public question rather than submitting a form, so this
          // is not the implied consent a lead form gives.
          consentStatus: 'UNKNOWN',
          ownerId: body.ownerId ?? enquiry.ownerId ?? null,
          customData: { socialEnquiry: attribution },
        },
        select: { id: true, reference: true },
      }),
    );

    await prisma.socialComment.update({
      where: { id: enquiry.id, tenantId: ctx.tenantId },
      data: { linkedLeadId: lead.id, status: 'CONVERTED', convertedAt: new Date() },
    });

    return { leadId: lead.id, reference: lead.reference, linkedToExisting: false };
  },
);
