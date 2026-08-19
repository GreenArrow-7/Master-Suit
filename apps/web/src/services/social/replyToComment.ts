/**
 * Answering a social enquiry.
 *
 * Everything one answer involves lives here: authorization, whether Meta will
 * accept it, the call, the trail, the status change and the clock stopping. A
 * route or a component doing any of that itself would be a second place for the
 * rules to drift.
 *
 * The load-bearing rule is that nothing sends without a person. AI can draft
 * (`draftReply.ts`), and a draft reaches the customer only when somebody reads
 * it and presses Send — there is no code path from a model's output to Meta.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { Forbidden, NotFound, Conflict } from '@/lib/errors';
import { assertPermission } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { connectionCredentials } from '@/lib/integrations/connection';
import { replyCapability } from '@/lib/integrations/meta/replyCapability';
import { sendMetaReply } from '@/lib/integrations/meta/send';
import type { Ctx } from '@/lib/security/rbac';
import type { SocialReplyKind } from '@prisma/client';

export interface ReplyInput {
  socialCommentId: string;
  kind: SocialReplyKind;
  body: string;
  /** Only meaningful for EXTERNAL: how they actually reached the customer. */
  channel?: string | null;
  /** True when the text started as a suggestion. Recorded, never assumed. */
  aiAssisted?: boolean;
}

/** Ways a person can say they answered outside Meta. Free text would make the analytics useless. */
export const EXTERNAL_CHANNELS = ['Phone', 'WhatsApp', 'Email', 'In person', 'Other'] as const;

export async function replyToSocialComment(ctx: Ctx, input: ReplyInput) {
  // Answering a customer is working the record, so it needs EDIT rather than
  // the ASSIGN that handing work to someone else needs.
  assertPermission(ctx, 'leads', 'EDIT');

  const body = input.body.trim();
  if (!body) throw Conflict('Write something to send.');
  if (body.length > 8000) throw Conflict('That message is too long to send.');

  const visible = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const enquiry = await prisma.socialComment.findFirst({
    where: { ...visible, id: input.socialCommentId },
    select: {
      id: true,
      provider: true,
      providerCommentId: true,
      commentCreatedAt: true,
      mediaType: true,
      parentCommentId: true,
      providerReplyId: true,
      repliedAt: true,
      status: true,
      ownerId: true,
      authorName: true,
    },
  });
  if (!enquiry) throw NotFound('Social enquiry');

  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId: ctx.tenantId, provider: 'meta' } },
    select: { scopes: true, metadata: true },
  });

  let providerReplyId: string | null = null;
  let delivered = true;

  if (input.kind === 'EXTERNAL') {
    /**
     * Nothing is sent. A person is recording that they already reached the
     * customer another way — which genuinely stops the clock, because the
     * customer has been answered. §36 asks for who, when and how, so a channel
     * is required here even though the body is the salesperson's own note.
     */
    if (!input.channel) throw Conflict('Say how you contacted them.');
    delivered = false;
  } else {
    /**
     * Re-checked at send time, not trusted from the browser. The window may
     * have closed between the drawer rendering and the salesperson pressing
     * Send — seven days is long, but a tab left open overnight is not rare.
     */
    const privateReplySent =
      (await prisma.socialReply.count({
        where: { tenantId: ctx.tenantId, socialCommentId: enquiry.id, kind: 'PRIVATE' },
      })) > 0;

    const capability = replyCapability(
      {
        ...enquiry,
        privateReplySent,
        grantedScopes: connection?.scopes?.length ? connection.scopes : undefined,
      },
      new Date(),
    );
    const allowed = input.kind === 'PUBLIC' ? capability.canPublicReply : capability.canPrivateReply;
    if (!allowed) {
      const why =
        (input.kind === 'PUBLIC' ? capability.reasonUnavailable.public : capability.reasonUnavailable.private) ??
        'Meta will not accept this reply.';
      throw Conflict(why);
    }

    const credentials = await connectionCredentials(ctx.tenantId, 'meta');
    const metadata = (connection?.metadata ?? {}) as Record<string, string>;

    if (credentials?.accessToken) {
      const sent = await sendMetaReply({
        provider: enquiry.provider,
        kind: input.kind,
        providerCommentId: enquiry.providerCommentId,
        pageId: metadata.pageId ?? null,
        accessToken: credentials.accessToken,
        body,
      });
      /**
       * Nothing is written when Meta refuses. A row saying we answered, when the
       * customer heard nothing, is worse than the error — it stops the SLA
       * clock and tells a manager the enquiry is handled.
       */
      if (!sent.ok) throw Conflict(sent.error);
      providerReplyId = sent.providerReplyId;
    } else {
      /**
       * Demo mode, the same path the rest of the Meta screens use. Recorded as
       * undelivered so nobody mistakes a demonstration for something a real
       * customer received.
       */
      delivered = false;
    }
  }

  const now = new Date();
  const firstResponse = !enquiry.repliedAt;

  const [reply] = await prisma.$transaction([
    prisma.socialReply.create({
      data: {
        tenantId: ctx.tenantId,
        socialCommentId: enquiry.id,
        kind: input.kind,
        channel: input.kind === 'EXTERNAL' ? input.channel : null,
        body,
        providerReplyId,
        delivered,
        aiAssisted: input.aiAssisted ?? false,
        // From the session, never from the request body.
        sentById: ctx.actor.id,
      },
      select: { id: true, kind: true, createdAt: true, delivered: true },
    }),
    prisma.socialComment.update({
      where: { id: enquiry.id, tenantId: ctx.tenantId },
      data: {
        /**
         * `repliedAt` is the *first* response and never moves again: it is what
         * the SLA measures, and a later follow-up must not rewrite how quickly
         * the customer was first answered.
         */
        ...(firstResponse ? { repliedAt: now } : {}),
        // Meta allows one public reply id to be tracked; the first is the one
        // the capability layer checks against.
        ...(input.kind === 'PUBLIC' && providerReplyId && !enquiry.providerReplyId ? { providerReplyId } : {}),
        // Converted and dismissed are further along; answering does not walk
        // an enquiry backwards.
        ...(enquiry.status === 'NEW' || enquiry.status === 'ASSIGNED' || enquiry.status === 'REVIEWED'
          ? { status: 'CONTACTED' as const }
          : {}),
      },
    }),
  ]);

  logger.info(
    { tenantId: ctx.tenantId, socialCommentId: enquiry.id, kind: input.kind, delivered, by: ctx.actor.id },
    'social enquiry answered',
  );
  return { ...reply, firstResponse };
}

/** Guarded for the same reason the write is: a rep must not read another desk's enquiries. */
export async function socialRepliesFor(ctx: Ctx, socialCommentId: string) {
  const visible = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const enquiry = await prisma.socialComment.findFirst({
    where: { ...visible, id: socialCommentId },
    select: { id: true },
  });
  if (!enquiry) throw Forbidden();
  return prisma.socialReply.findMany({
    where: { tenantId: ctx.tenantId, socialCommentId: enquiry.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      kind: true,
      channel: true,
      body: true,
      delivered: true,
      aiAssisted: true,
      sentById: true,
      createdAt: true,
    },
  });
}
