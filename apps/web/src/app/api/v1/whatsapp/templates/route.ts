import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { syncWhatsAppTemplates, SENDABLE } from '@/services/meta/templates';

/**
 * The approved templates an agent may pick from, and the sync that refreshes
 * them (§31).
 *
 * Listing is gated on sending a communication rather than on administering
 * integrations: choosing a template is part of writing to a customer. Syncing
 * is not — it reaches Meta with the workspace's credentials and rewrites shared
 * configuration, so it needs the integrations permission (§60: not every
 * salesperson is an integration administrator).
 */
const listQuery = z.object({
  /** Administrators reviewing approval state need the ones that are not sendable too. */
  all: z.coerce.boolean().default(false),
});

export const GET = route({ module: 'communications', action: 'CREATE', query: listQuery }, async ({ ctx, query }) => {
  const templates = await prisma.messageTemplate.findMany({
    where: {
      tenantId: ctx.tenantId,
      channel: 'WHATSAPP',
      deletedAt: null,
      ...(query.all ? {} : { isActive: true, approvalState: SENDABLE }),
    },
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
    select: {
      id: true,
      key: true,
      name: true,
      body: true,
      language: true,
      approvalState: true,
      mergeFields: true,
      isActive: true,
    },
  });
  return { templates, sendableState: SENDABLE };
});

export const POST = route(
  { module: 'integrations', action: 'MANAGE_CONFIGURATION', auditEvent: 'INTEGRATION_MODIFIED' },
  async ({ ctx }) => syncWhatsAppTemplates(ctx.tenantId),
);
