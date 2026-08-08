import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NotFound, Invalid } from '@/lib/errors';
import { getWhatsAppProvider } from '@/lib/integrations/whatsapp';
import { connectionCredentials } from '@/lib/integrations/connection';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    /** An approved Meta message template. Business-initiated WhatsApp cannot send free text. */
    template: z.string().min(1).max(120),
    language: z.string().min(2).max(10).default('en'),
    /** Omit to circulate to every not-yet-notified WhatsApp invitee. */
    inviteeIds: z.array(z.string().cuid()).max(100).optional(),
    /** Re-send to invitees already notified once. */
    resend: z.boolean().default(false),
  })
  .strict();

/** ponytail: sequential send, capped per request. Move to the BullMQ queue in
 *  src/lib/queue.ts if a single event ever needs to notify more than a few hundred. */
const BATCH_LIMIT = 100;

export const POST = route(
  { module: 'events', productModule: 'SALES', action: 'EDIT', params, body, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const event = await prisma.event.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!event) throw NotFound('Event');

    const credentials = await connectionCredentials(ctx.tenantId, 'meta');
    if (!credentials?.accessToken || !credentials?.phoneNumberId) {
      throw Invalid([
        {
          field: 'integration',
          code: 'not_connected',
          message: 'Connect WhatsApp Business before circulating an event.',
        },
      ]);
    }

    const invitees = await prisma.eventInvitee.findMany({
      where: {
        tenantId: ctx.tenantId,
        eventId: event.id,
        inviteChannel: 'WHATSAPP',
        phone: { not: null },
        ...(body.inviteeIds ? { id: { in: body.inviteeIds } } : {}),
        ...(body.resend ? {} : { inviteSentAt: null }),
      },
      take: BATCH_LIMIT,
    });
    if (invitees.length === 0) return { sent: 0, failed: 0, remaining: 0 };

    const provider = getWhatsAppProvider('meta', credentials);
    const when = event.startAt.toLocaleString('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: event.timezone,
    });
    const where = event.meetingUrl ?? event.location ?? event.address ?? 'Details to follow';

    let sent = 0;
    let failed = 0;

    for (const invitee of invitees) {
      const result = await provider.sendTemplate({
        to: invitee.phone!,
        template: {
          name: body.template,
          language: body.language,
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: invitee.name ?? 'there' },
                { type: 'text', text: event.title },
                { type: 'text', text: when },
                { type: 'text', text: where },
              ],
            },
          ],
        },
      });

      if (result.status === 'failed') {
        failed += 1;
        logger.warn({ eventId: event.id, inviteeId: invitee.id, code: result.errorCode }, 'WhatsApp invite failed');
        continue;
      }

      sent += 1;
      await prisma.eventInvitee.update({
        where: { id: invitee.id },
        data: {
          inviteSentAt: new Date(),
          inviteDelivered: result.status === 'delivered' || result.status === 'read',
        },
      });
    }

    const remaining = await prisma.eventInvitee.count({
      where: {
        tenantId: ctx.tenantId,
        eventId: event.id,
        inviteChannel: 'WHATSAPP',
        phone: { not: null },
        inviteSentAt: null,
      },
    });

    return { sent, failed, remaining };
  },
);
