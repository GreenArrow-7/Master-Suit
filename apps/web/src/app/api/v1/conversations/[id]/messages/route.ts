import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound, Conflict } from '@/lib/errors';
import { visibilityWhere } from '@/lib/security/visibility';
import { connectionCredentials } from '@/lib/integrations/connection';
import { getWhatsAppProvider, serviceWindowOpen } from '@/lib/integrations/whatsapp';
import { SENDABLE } from '@/services/meta/templates';
import type { Ctx } from '@/lib/security/rbac';

/**
 * One conversation's messages, and the reply box.
 *
 * The thread is loaded newest-first with a cursor (§55): a long WhatsApp history
 * must not be read into memory to show the last ten lines, and an offset drifts
 * every time the customer writes.
 */
const params = z.object({ id: z.string().min(1).max(60) });

/**
 * Loads the conversation *through* the visibility filter rather than by id.
 *
 * Fetching by id and checking afterwards is the classic IDOR, and here it would
 * also be a cross-tenant one: conversation ids are cuids, so a guessed or leaked
 * id from another workspace must miss, not merely be refused. The `where` carries
 * tenantId from ctx, and RLS refuses it a second time underneath.
 */
async function visibleConversation(ctx: Ctx, id: string) {
  const visible = await visibilityWhere(ctx, 'communications', 'VIEW', { includeUnassigned: true });
  const conversation = await prisma.conversation.findFirst({
    where: { ...visible, id },
    select: { id: true, channel: true, externalId: true, ownerId: true, leadId: true, status: true },
  });
  if (!conversation) throw NotFound('Conversation');
  return conversation;
}

const listQuery = z.object({
  cursor: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const GET = route(
  { module: 'communications', action: 'VIEW', params, query: listQuery },
  async ({ ctx, params, query }) => {
    const conversation = await visibleConversation(ctx, params.id);

    const rows = await prisma.communication.findMany({
      where: { tenantId: ctx.tenantId, conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        direction: true,
        status: true,
        body: true,
        createdAt: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        errorCode: true,
        errorMessage: true,
        createdById: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    // Reading the thread is what marks it read; there is no separate call to
    // forget to make.
    if (!query.cursor) {
      await prisma.conversation.updateMany({
        where: { id: conversation.id, tenantId: ctx.tenantId },
        data: { unreadCount: 0 },
      });
    }

    return {
      conversation,
      // Returned oldest-first for rendering; fetched newest-first for the cursor.
      messages: page.slice().reverse(),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      window: await windowState(ctx.tenantId, conversation.id),
    };
  },
);

/**
 * Whether a free-form reply is currently allowed (§32).
 *
 * Returned with the thread so the composer can say why it is disabled rather
 * than letting an agent type a message Meta will reject.
 */
async function windowState(tenantId: string, conversationId: string) {
  const lastInbound = await prisma.communication.findFirst({
    where: { tenantId, conversationId, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const open = serviceWindowOpen(lastInbound?.createdAt);
  return {
    open,
    lastInboundAt: lastInbound?.createdAt ?? null,
    reason: open
      ? null
      : lastInbound
        ? 'The 24-hour service window has closed. Send an approved template to reopen it.'
        : 'This customer has not messaged you yet. Only an approved template may be sent first.',
  };
}

/**
 * Either a free-form reply or an approved template — never both, and the choice
 * is not the client's to make freely: free-form is legal only inside the service
 * window, a template only outside it is *required* but it is always permitted.
 */
const sendBody = z
  .object({
    body: z.string().trim().min(1).max(4096).optional(),
    templateKey: z.string().trim().min(1).max(120).optional(),
    /** Values for the template's {{1}}, {{2}} placeholders, in order. */
    variables: z.array(z.string().max(500)).max(20).default([]),
  })
  .strict()
  .refine((v) => Boolean(v.body) !== Boolean(v.templateKey), {
    message: 'Send either a message or a template, not both.',
  });

export const POST = route(
  { module: 'communications', action: 'CREATE', params, body: sendBody, auditEvent: 'MESSAGE_SENT' },
  async ({ ctx, params, body }) => {
    const conversation = await visibleConversation(ctx, params.id);
    if (conversation.channel !== 'WHATSAPP') throw Conflict('Only WhatsApp conversations can be replied to here.');

    /**
     * The service window is enforced here, on the server, and not merely
     * indicated in the UI.
     *
     * §32 is explicit that free-form outbound is not unrestricted. Meta rejects
     * a service message sent outside the window, so without this the agent sees
     * a message in the thread that the customer never received — which is worse
     * than being told they cannot send it. A template is exempt: that is
     * precisely what templates are for, and it is how a lapsed window reopens.
     */
    const state = await windowState(ctx.tenantId, conversation.id);
    if (!state.open && !body.templateKey) throw Conflict(state.reason ?? 'The service window is closed.');

    const credentials = await connectionCredentials(ctx.tenantId, 'meta');
    if (!credentials?.accessToken || !credentials.phoneNumberId) {
      throw Forbidden('WhatsApp is not connected for this workspace.');
    }

    const provider = getWhatsAppProvider('meta', credentials);

    let result;
    let sentText: string;
    if (body.templateKey) {
      /**
       * The template is re-read here rather than trusted from the request.
       *
       * A client that could name a template and its body would be able to send
       * unreviewed content through an approved name, which is the whole thing
       * template review exists to prevent. Approval state is checked at send
       * time too: a template approved when the page loaded can be paused by
       * Meta minutes later.
       */
      const template = await prisma.messageTemplate.findFirst({
        where: {
          tenantId: ctx.tenantId,
          key: body.templateKey,
          channel: 'WHATSAPP',
          deletedAt: null,
        },
        select: { name: true, body: true, language: true, approvalState: true, isActive: true },
      });
      if (!template) throw NotFound('Template');
      if (!template.isActive || template.approvalState !== SENDABLE) {
        throw Conflict(
          `That template is ${(template.approvalState ?? 'unavailable').toLowerCase()} and cannot be sent.`,
        );
      }

      result = await provider.sendTemplate({
        to: conversation.externalId,
        template: {
          name: template.name,
          language: template.language,
          components: body.variables.length
            ? [{ type: 'body', parameters: body.variables.map((text) => ({ type: 'text', text })) }]
            : undefined,
        },
      });
      // Stored with the variables already substituted, so the thread shows what
      // the customer actually received rather than a row of placeholders.
      sentText = template.body.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, token) => {
        const index = Number(token);
        return Number.isInteger(index) && index >= 1 ? (body.variables[index - 1] ?? _m) : _m;
      });
    } else {
      result = await provider.sendText(conversation.externalId, body.body!);
      sentText = body.body!;
    }

    // Written whether or not the send succeeded, with the provider's own reason:
    // a failed message the agent can see and retry beats one that vanished.
    const message = await prisma.communication.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: conversation.id,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        status: result.status === 'failed' ? 'FAILED' : 'SENT',
        leadId: conversation.leadId,
        fromAddress: String(credentials.phoneNumberId),
        toAddress: conversation.externalId,
        body: sentText,
        providerKey: 'meta',
        providerMessageId: result.externalMessageId || null,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        sentAt: result.status === 'failed' ? null : new Date(),
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
      select: { id: true, status: true, createdAt: true, errorMessage: true },
    });

    await prisma.conversation.updateMany({
      where: { id: conversation.id, tenantId: ctx.tenantId },
      data: {
        lastMessageAt: new Date(),
        // Replying claims an unowned thread. Someone answering a customer is the
        // clearest possible statement of who owns the relationship (§30).
        ...(conversation.ownerId ? {} : { ownerId: ctx.actor.id }),
      },
    });

    return { message };
  },
);
