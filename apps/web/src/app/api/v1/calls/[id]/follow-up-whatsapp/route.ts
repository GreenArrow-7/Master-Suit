import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { serviceWindowOpen } from '@/lib/integrations/whatsapp';
import { draftFollowUpWhatsApp } from '@/lib/ai/followUpEmail';

const params = z.object({ id: z.string().cuid() });

/**
 * The post-call WhatsApp follow-up, as a draft.
 *
 * POST drafts only. The send goes through the existing conversation reply
 * route (`/api/v1/conversations/[id]/messages`), which owns the Meta service
 * window, template enforcement, Communication logging and thread ownership —
 * duplicating any of that here would be a second copy that drifts. This route
 * answers the two questions the composer needs: what to say, and whether a
 * free-form send is currently possible for this call's lead.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params },
  async ({ ctx, params }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, leadId: true },
    });
    if (!call) throw NotFound('Call');

    const [analysis, lead, sender, settings] = await Promise.all([
      prisma.aIAnalysis.findFirst({ where: { callId: call.id, tenantId: ctx.tenantId } }),
      call.leadId
        ? prisma.lead.findFirst({
            where: { id: call.leadId, tenantId: ctx.tenantId },
            select: { id: true, fullName: true, whatsappOptOut: true },
          })
        : null,
      prisma.user.findFirst({ where: { id: ctx.actor.id, tenantId: ctx.tenantId }, select: { fullName: true } }),
      prisma.organizationSetting.findFirst({ where: { tenantId: ctx.tenantId }, select: { productName: true } }),
    ]);

    // The most recent WhatsApp thread with this lead — the only place a
    // free-form follow-up can legally go.
    const conversation = lead
      ? await prisma.conversation.findFirst({
          where: { tenantId: ctx.tenantId, leadId: lead.id, channel: 'WHATSAPP' },
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true },
        })
      : null;
    const lastInbound = conversation
      ? await prisma.communication.findFirst({
          where: { tenantId: ctx.tenantId, conversationId: conversation.id, direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      : null;
    const windowOpen = Boolean(conversation) && serviceWindowOpen(lastInbound?.createdAt);

    const draft = await draftFollowUpWhatsApp({
      tenantId: ctx.tenantId,
      recipientName: lead?.fullName,
      senderName: sender?.fullName ?? 'Your account manager',
      companyName: settings?.productName ?? null,
      summary: analysis?.summary,
      actionItems: (analysis?.actionItems as string[] | undefined) ?? [],
      nextSteps: (analysis?.nextSteps as string[] | undefined) ?? [],
    });

    return {
      ...draft,
      recipientName: lead?.fullName ?? null,
      optedOut: lead?.whatsappOptOut ?? false,
      conversationId: conversation?.id ?? null,
      windowOpen,
      reason: !lead
        ? 'This call has no linked lead.'
        : !conversation
          ? 'No WhatsApp conversation with this lead yet — they must message first, or you can start one with an approved template from the Inbox.'
          : !windowOpen
            ? 'The 24-hour service window has closed. Send an approved template from the Inbox to reopen it, or copy the draft.'
            : null,
    };
  },
);
