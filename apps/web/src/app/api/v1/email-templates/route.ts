import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { placeholdersOf } from '@/services/meta/templates';

/**
 * The workspace's email templates (Lead Eagle audit row M4-28): a name, a
 * subject and a body, `{{1}}` the lead's first name and `{{2}}` the sender's,
 * sent from the lead page and Send template. Kept on MessageTemplate beside
 * the WhatsApp ones Meta approves, as channel EMAIL. Listing is part of
 * writing to a customer (`communications:CREATE`, as the WhatsApp list is);
 * keeping them is the workspace's configuration (`settings:MANAGE_CONFIGURATION`),
 * audited. A template is archived, never deleted: a sent message names it.
 */
const SELECT = {
  id: true,
  key: true,
  name: true,
  subject: true,
  body: true,
  mergeFields: true,
  isActive: true,
} as const;

const fields = {
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
};

const mergeFields = (subject: string, body: string) => [...new Set(placeholdersOf(`${subject} ${body}`))];

export const GET = route(
  { module: 'communications', productModule: LEAD_MODULES, action: 'CREATE' },
  async ({ ctx }) => ({
    templates: await prisma.messageTemplate.findMany({
      where: { tenantId: ctx.tenantId, channel: 'EMAIL', isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: SELECT,
    }),
  }),
);

export const POST = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    body: z.object(fields).strict(),
  },
  async ({ ctx, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const template = await tx.messageTemplate.create({
        data: {
          tenantId: ctx.tenantId,
          key: `email:${randomBytes(6).toString('hex')}`,
          channel: 'EMAIL',
          ...body,
          mergeFields: mergeFields(body.subject, body.body),
          createdById: ctx.actor.id,
        },
        select: SELECT,
      });
      await audit(
        ctx,
        {
          event: 'RECORD_CREATED',
          objectType: 'message-template',
          recordId: template.id,
          metadata: { name: template.name },
        },
        tx,
      );
      return template;
    }),
);

export const PATCH = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    query: z.object({ id: z.string().cuid() }),
    body: z
      .object({ ...fields, isActive: z.boolean() })
      .partial()
      .strict(),
  },
  async ({ ctx, query, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const before = await tx.messageTemplate.findFirst({
        where: { tenantId: ctx.tenantId, id: query.id, channel: 'EMAIL', deletedAt: null },
        select: SELECT,
      });
      if (!before) throw NotFound('Template');
      const subject = body.subject ?? before.subject ?? '';
      const text = body.body ?? before.body;
      const template = await tx.messageTemplate.update({
        where: { tenantId: ctx.tenantId, id: before.id },
        data: { ...body, mergeFields: mergeFields(subject, text), updatedById: ctx.actor.id },
        select: SELECT,
      });
      await audit(
        ctx,
        {
          event: 'RECORD_UPDATED',
          objectType: 'message-template',
          recordId: template.id,
          previousValue: before,
          newValue: template,
        },
        tx,
      );
      return template;
    }),
);
