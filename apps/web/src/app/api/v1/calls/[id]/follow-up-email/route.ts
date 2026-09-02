import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { Invalid, NotFound } from '@/lib/errors';
import { sendMail } from '@/lib/mailer';
import { draftFollowUpEmail } from '@/lib/ai/followUpEmail';
import { requireVisibleCall } from '@/services/crm/callVisibility';

const params = z.object({ id: z.string().cuid() });

/**
 * The post-call follow-up email.
 *
 * POST drafts one, PUT sends the (edited) draft. Two verbs on one resource
 * rather than a `/draft` and a `/send` path, because they share the recipient
 * resolution below and splitting them means two copies of it.
 *
 * The draft is not stored. It exists in the composer until the rep sends it, at
 * which point the sent copy is a Communication row like every other outbound
 * message — retention policy already reaches that table, and it would not reach
 * a drafts table nobody remembered to add it to.
 */

/**
 * Who the follow-up goes to, resolved from the call's own links.
 *
 * The address is never taken from the request body. A route that accepts an
 * arbitrary `to` and sends from the workspace's own mail server is an open
 * relay with a permission check in front of it; the rep may edit the words, not
 * the recipient. Changing who a call is about is an edit to the call.
 */
async function recipientFor(tenantId: string, call: { contactId: string | null; leadId: string | null }) {
  if (call.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: call.contactId, tenantId, deletedAt: null },
      select: { fullName: true, email: true, emailOptOut: true },
    });
    if (contact?.email) return { name: contact.fullName, email: contact.email, optedOut: contact.emailOptOut };
  }
  if (call.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: call.leadId, tenantId, deletedAt: null },
      select: { fullName: true, email: true, emailOptOut: true },
    });
    if (lead?.email) return { name: lead.fullName, email: lead.email, optedOut: lead.emailOptOut };
  }
  return null;
}

async function loadContext(tenantId: string, callId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, tenantId, deletedAt: null },
    select: { id: true, leadId: true, contactId: true, accountId: true },
  });
  if (!call) throw NotFound('Call');

  const [analysis, transcript, settings] = await Promise.all([
    prisma.aIAnalysis.findFirst({ where: { callId, tenantId } }),
    prisma.transcript.findFirst({ where: { callId, tenantId }, select: { content: true } }),
    prisma.organizationSetting.findFirst({ where: { tenantId }, select: { productName: true } }),
  ]);

  return { call, analysis, transcript, companyName: settings?.productName ?? null };
}

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params },
  async ({ ctx, params }) => {
    await requireVisibleCall(ctx, params.id);
    const { call, analysis, transcript, companyName } = await loadContext(ctx.tenantId, params.id);
    const recipient = await recipientFor(ctx.tenantId, call);

    const draft = await draftFollowUpEmail({
      tenantId: ctx.tenantId,
      recipientName: recipient?.name,
      senderName: (await senderName(ctx.tenantId, ctx.actor.id)) ?? 'Your account manager',
      companyName,
      summary: analysis?.summary,
      actionItems: (analysis?.actionItems as string[] | undefined) ?? [],
      nextSteps: (analysis?.nextSteps as string[] | undefined) ?? [],
      objections: (analysis?.objections as string[] | undefined) ?? [],
      transcript: transcript?.content,
    });

    return {
      ...draft,
      /** Rendered read-only in the composer; the rep cannot retarget the send. */
      to: recipient?.email ?? null,
      recipientName: recipient?.name ?? null,
      optedOut: recipient?.optedOut ?? false,
    };
  },
);

const sendBody = z
  .object({
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(20_000),
  })
  .strict();

export const PUT = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: sendBody,
    auditEvent: 'MESSAGE_SENT',
    // Sending mail in someone's name is not a read. Tighter than the kernel's
    // per-session default so a stuck composer cannot fan out.
    rateLimit: { max: 20, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) => {
    await requireVisibleCall(ctx, params.id);
    const { call } = await loadContext(ctx.tenantId, params.id);
    const recipient = await recipientFor(ctx.tenantId, call);

    if (!recipient) {
      throw Invalid([
        {
          field: 'recipient',
          code: 'no_address',
          message: 'This call has no contact or lead with an email address. Add one before sending.',
        },
      ]);
    }
    if (recipient.optedOut) {
      throw Invalid([{ field: 'recipient', code: 'opted_out', message: `${recipient.name} has opted out of email.` }]);
    }

    const communication = await prisma.communication.create({
      data: {
        tenantId: ctx.tenantId,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        status: 'QUEUED',
        leadId: call.leadId,
        contactId: call.contactId,
        accountId: call.accountId,
        toAddress: recipient.email,
        subject: body.subject,
        body: body.body,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        queuedAt: new Date(),
        metadata: { callId: call.id, kind: 'CALL_FOLLOW_UP' },
      },
      select: { id: true },
    });

    try {
      await sendMail(recipient.email, body.subject, body.body);
    } catch (err) {
      await prisma.communication.update({
        where: { id: communication.id, tenantId: ctx.tenantId },
        data: { status: 'FAILED', errorMessage: (err as Error).message?.slice(0, 500) },
      });
      throw err;
    }

    await prisma.communication.update({
      where: { id: communication.id, tenantId: ctx.tenantId },
      data: { status: 'SENT', sentAt: new Date() },
    });

    await logActivity(ctx.tenantId, ctx.actor.id, call, body.subject);

    return { id: communication.id, status: 'SENT', to: recipient.email };
  },
);

async function senderName(tenantId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { fullName: true } });
  return user?.fullName ?? null;
}

/**
 * The CRM activity beside the message.
 *
 * `Communication` is the message; `Activity` is what shows on the customer
 * timeline next to calls and meetings, and it is what "log the send as a CRM
 * activity" means. The type row is upserted rather than assumed: a workspace
 * provisioned before this feature existed has no `email` activity type, and a
 * missing one must not be the reason a sent email goes unrecorded.
 *
 * Best effort by design — the mail has already left. Failing the request here
 * would tell the rep the send failed when it did not, and they would send again.
 */
async function logActivity(
  tenantId: string,
  userId: string,
  call: { id: string; leadId: string | null; contactId: string | null; accountId: string | null },
  subject: string,
) {
  try {
    const type = await prisma.activityType.upsert({
      where: { tenantId_key: { tenantId, key: 'email' } },
      update: {},
      create: { tenantId, key: 'email', name: 'Email', direction: 'OUTBOUND', icon: 'mail' },
      select: { id: true },
    });

    await prisma.activity.create({
      data: {
        tenantId,
        typeId: type.id,
        leadId: call.leadId,
        contactId: call.contactId,
        accountId: call.accountId,
        ownerId: userId,
        createdById: userId,
        outcome: 'SENT',
        notes: `Follow-up email sent after call: ${subject}`,
      },
    });
  } catch (err) {
    logger.warn({ err, callId: call.id }, 'follow-up email activity log failed');
  }
}
