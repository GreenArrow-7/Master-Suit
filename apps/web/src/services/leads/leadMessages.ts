import { randomUUID } from 'node:crypto';
import { ctxForUser } from '@/lib/auth/session';
import { prisma, withTx } from '@/lib/db';
import { AppError, Invalid, NotFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { sendMail } from '@/lib/mailer';
import { enqueue } from '@/lib/queue';
import { redis } from '@/lib/redis';
import { audit } from '@/lib/security/audit';
import { assertAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
import { consume, limits } from '@/lib/security/ratelimit';
import { assertPermission, can, type Ctx } from '@/lib/security/rbac';
import { assertLeadInScope, leadScope } from '@/lib/security/record-scope';
import { fillTemplate, sendableTemplate, sendWhatsAppTemplate, whatsAppSender } from '@/services/conversations/send';
import { placeholdersOf } from '@/services/meta/templates';
import { normalizePhone } from './normalizePhone';

/**
 * A WhatsApp template or an email sent to a lead from its page (M4-28), or to
 * many from the lead grid (M4-38): the inbox's own send (services/conversations/
 * send.ts), so each is a Communication on the lead, on its timeline, audited as
 * the sender. Only under the sender's lead scope (`leads:EDIT`, 404 outside it),
 * never to a lead that opted out of the channel, and to a number only where it
 * is marked as on WhatsApp. No number or address ever goes back to the sender.
 */
export type MessageChannel = 'WHATSAPP' | 'EMAIL';

/** The most leads one Send template takes. */
export const BATCH_CAP = 100;
/** A workspace's bulk sends go out one at a time, this far apart. */
// ponytail: one a second per workspace, a guess well under Meta's and most SMTP relays' limits; tune once a provider's real limit bites.
export const SEND_SPACING_MS = 1_000;

const CONTACT = {
  id: true,
  fullName: true,
  firstName: true,
  phone: true,
  phoneNormalized: true,
  phoneIsWhatsapp: true,
  email: true,
  whatsappOptOut: true,
  emailOptOut: true,
  consentStatus: true,
  ownerId: true,
  phones: { orderBy: { createdAt: 'asc' }, select: { id: true, normalized: true, isWhatsapp: true } },
} as const;

type LeadContact = {
  fullName: string;
  firstName: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  phoneIsWhatsapp: boolean;
  email: string | null;
  whatsappOptOut: boolean;
  emailOptOut: boolean;
  consentStatus: string;
  phones: { id: string; normalized: string; isWhatsapp: boolean }[];
};

const MESSAGE = { id: true, channel: true, status: true, errorMessage: true, sentAt: true } as const;

const refuse = (code: string, message: string, field = 'lead') => Invalid([{ field, code, message }]);

/**
 * Where a message to the lead goes, or why it cannot. WhatsApp: the number
 * chosen (`to`, "main" or one of its other numbers' ids) if it is marked as on
 * WhatsApp, else the main number if marked, else the first other number marked;
 * as Meta names a thread, the E.164 digits. Email: its address. A lead whose
 * consent is withdrawn has opted out of both, as campaigns and the dialer read it.
 */
/** The lead's numbers as a send names them ("main", or a LeadPhone id), each with its number where marked as on WhatsApp. */
function whatsAppNumbers(lead: LeadContact) {
  const main = lead.phone && lead.phoneIsWhatsapp ? (lead.phoneNormalized ?? normalizePhone(lead.phone)) : null;
  return [
    { id: 'main', number: main },
    ...lead.phones.map((p) => ({ id: p.id, number: p.isWhatsapp ? p.normalized : null })),
  ];
}

export function recipientOf(lead: LeadContact, channel: MessageChannel, to?: string): string {
  if (lead.consentStatus === 'WITHDRAWN') {
    throw refuse('opted_out', `${lead.fullName} has withdrawn consent to be contacted.`);
  }
  if (channel === 'EMAIL') {
    if (lead.emailOptOut) throw refuse('opted_out', `${lead.fullName} has opted out of email.`);
    if (!lead.email) throw refuse('no_email', `${lead.fullName} has no email address.`);
    return lead.email;
  }
  if (lead.whatsappOptOut) throw refuse('opted_out', `${lead.fullName} has opted out of WhatsApp.`);
  const numbers = whatsAppNumbers(lead);
  const chosen = to ? numbers.find((n) => n.id === to) : numbers.find((n) => n.number);
  if (to && !chosen?.number) throw refuse('not_whatsapp', 'That number is not marked as on WhatsApp.', 'to');
  if (!chosen?.number) throw refuse('no_whatsapp_number', `${lead.fullName} has no number marked as on WhatsApp.`);
  return chosen.number.replace(/\D/g, '');
}

/**
 * A template's values, `{{1}}` first: as typed, else `{{1}}` is the lead's
 * first name and `{{2}}` the sender's name. Any other left empty is refused,
 * so a customer never reads a bare placeholder.
 */
export function templateValues(
  text: string,
  given: readonly string[],
  lead: Pick<LeadContact, 'firstName' | 'fullName'>,
  sender: string,
) {
  const count = Math.max(0, ...placeholdersOf(text).map(Number).filter(Number.isInteger));
  const fallback: Record<number, string> = {
    1: lead.firstName?.trim() || lead.fullName.trim().split(/\s+/)[0] || lead.fullName,
    2: sender,
  };
  return Array.from({ length: count }, (_, i) => {
    const value = given[i]?.trim() || fallback[i + 1];
    if (!value) throw refuse('missing_variable', `Fill in {{${i + 1}}}.`, 'variables');
    return value;
  });
}

export interface SendInput {
  channel: MessageChannel;
  templateKey: string;
  /** WhatsApp: "main" or a LeadPhone id; left out, the default number. */
  to?: string;
  variables?: string[];
  /** The bulk send it belongs to: a job run again finds its message and sends nothing. */
  batchId?: string;
}

/**
 * Whether this sender may send the lead a WhatsApp template, decided as
 * `sendLeadMessage` would, before it is tried (the post-call composer, M10-01).
 * Null where the sender may not message the lead at all (no
 * `communications:CREATE`, or the lead beyond its `leads:EDIT` reach); else
 * why it cannot go (opted out, no number marked, not connected), or null, and
 * `to`: the number of the thread found (`thread`, as Meta names it, the E.164
 * digits) where it is still marked as on WhatsApp, so the template reopens
 * that thread; null for the send's own default.
 */
export async function whatsAppTemplateBlock(
  ctx: Ctx,
  leadId: string,
  thread?: string | null,
): Promise<{ blocked: string | null; to: string | null } | null> {
  if (!can(ctx, 'communications', 'CREATE')) return null;
  const reached = await assertLeadInScope(ctx, leadId, prisma, 'EDIT').then(
    () => true,
    (err) => {
      if (err instanceof AppError && (err.status === 403 || err.status === 404)) return false;
      throw err;
    },
  );
  if (!reached) return null;
  const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: ctx.tenantId, id: leadId }, select: CONTACT });
  const to =
    (thread && whatsAppNumbers(lead).find((n) => n.number && n.number.replace(/\D/g, '') === thread)?.id) || null;
  try {
    recipientOf(lead, 'WHATSAPP', to ?? undefined);
    await whatsAppSender(ctx.tenantId);
    return { blocked: null, to };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return { blocked: err.errors[0]?.message ?? err.message, to };
  }
}

export async function sendLeadMessage(ctx: Ctx, leadId: string, input: SendInput) {
  const { tenantId } = ctx;
  // 404 outside the sender's scope, before anything about the lead is read.
  await assertLeadInScope(ctx, leadId, prisma, 'EDIT');
  const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, select: CONTACT });
  const address = recipientOf(lead, input.channel, input.to);
  const template = await sendableTemplate(tenantId, input.channel, input.templateKey);
  const values = templateValues(
    `${template.subject ?? ''} ${template.body}`,
    input.variables ?? [],
    lead,
    ctx.actor.fullName,
  );
  if (input.batchId) {
    const done = await prisma.communication.findFirst({
      where: { tenantId, leadId, metadata: { path: ['batchId'], equals: input.batchId } },
      select: MESSAGE,
    });
    if (done) return done;
  }
  // The platform's own mail server carries it: a workspace's day of lead email is capped.
  if (input.channel === 'EMAIL') {
    const day = limits.leadEmailDay(tenantId);
    await consume(day, `This workspace has sent today's ${day.max} emails to leads. Try again tomorrow.`);
  }
  const whatsapp = input.channel === 'WHATSAPP' ? await whatsAppSender(tenantId) : null;
  const subject = template.subject ? fillTemplate(template.subject, values) : null;
  const body = fillTemplate(template.body, values);

  // The message and its audit row first, in one transaction: a retry finds it,
  // and nothing reaches a customer unrecorded.
  const { message, threadId } = await withTx(tenantId, async (tx) => {
    // The lead's thread, as an inbound message from that number names it, held
    // by the lead's owner: their inbox is where the reply should land and their
    // timeline shows the message. A new or unowned one goes to the owner (the
    // sender, for a lead with none); one still held by a previous owner of a
    // reassigned lead moves to the new one. One linked to another lead stays.
    const holder = lead.ownerId ?? ctx.actor.id;
    const thread = whatsapp
      ? await tx.conversation.upsert({
          where: { tenantId_channel_externalId: { tenantId, channel: 'WHATSAPP', externalId: address } },
          create: {
            tenantId,
            channel: 'WHATSAPP',
            providerKey: 'meta',
            externalId: address,
            displayName: lead.fullName,
            leadId,
            ownerId: holder,
          },
          update: {},
          select: { id: true, leadId: true, ownerId: true },
        })
      : null;
    if (thread && !thread.leadId) {
      await tx.conversation.updateMany({ where: { tenantId, id: thread.id, leadId: null }, data: { leadId } });
    }
    if (thread && thread.ownerId !== holder && (!thread.ownerId || lead.ownerId)) {
      // Only if still as read, and only this lead's thread.
      const moved = await tx.conversation.updateMany({
        where: { tenantId, id: thread.id, ownerId: thread.ownerId, leadId },
        data: { ownerId: holder },
      });
      if (moved.count) {
        await audit(
          ctx,
          {
            event: 'OWNER_CHANGED',
            objectType: 'conversation',
            recordId: thread.id,
            metadata: { leadId, from: thread.ownerId, ownerId: holder },
          },
          tx,
        );
      }
    }
    const row = await tx.communication.create({
      data: {
        tenantId,
        conversationId: thread?.id ?? null,
        channel: input.channel,
        direction: 'OUTBOUND',
        status: 'QUEUED',
        leadId,
        templateId: template.id,
        fromAddress: whatsapp?.from ?? null,
        toAddress: address,
        subject,
        body,
        providerKey: whatsapp ? 'meta' : null,
        queuedAt: new Date(),
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        metadata: { template: template.key, ...(input.batchId && { batchId: input.batchId }) },
      },
      select: { id: true },
    });
    await audit(
      ctx,
      {
        event: 'MESSAGE_SENT',
        objectType: 'lead',
        recordId: leadId,
        metadata: {
          channel: input.channel,
          template: template.key,
          communicationId: row.id,
          ...(input.batchId && { batchId: input.batchId }),
        },
      },
      tx,
    );
    return { message: row, threadId: thread?.id ?? null };
  });

  // Then the provider. Its answer, a refusal included, is written on the
  // message: a failed message the sender can see beats one that vanished.
  const outcome = whatsapp
    ? await sendWhatsAppTemplate(whatsapp.provider, address, template, values).then(
        (result) =>
          result.status === 'failed'
            ? {
                status: 'FAILED' as const,
                providerMessageId: result.externalMessageId || null,
                errorCode: result.errorCode ?? null,
                errorMessage: result.errorMessage ?? null,
              }
            : { status: 'SENT' as const, providerMessageId: result.externalMessageId || null },
        (err: Error) => ({ status: 'FAILED' as const, errorMessage: err.message?.slice(0, 500) ?? null }),
      )
    : await sendMail(address, subject ?? template.name, body, { replyTo: ctx.actor.email }).then(
        () => ({ status: 'SENT' as const }),
        (err: Error) => ({ status: 'FAILED' as const, errorMessage: err.message?.slice(0, 500) ?? null }),
      );
  const sent = await prisma.communication.update({
    where: { tenantId, id: message.id },
    data: { ...outcome, sentAt: outcome.status === 'SENT' ? new Date() : null },
    select: MESSAGE,
  });
  if (threadId) {
    await prisma.conversation.updateMany({ where: { tenantId, id: threadId }, data: { lastMessageAt: new Date() } });
  }
  return sent;
}

interface ReserveCommand {
  reserveSendSlots(key: string, now: string, count: string, spacing: string): Promise<number>;
}

/**
 * The first free send time for `count` messages of this workspace, and those
 * slots taken: a second Send template queues behind the first, not beside it.
 * One script, so two batches at once cannot take the same slots.
 */
redis.defineCommand('reserveSendSlots', {
  numberOfKeys: 1,
  lua: `
    local now = tonumber(ARGV[1])
    local start = math.max(tonumber(redis.call('GET', KEYS[1]) or '0'), now)
    local finish = start + tonumber(ARGV[2]) * tonumber(ARGV[3])
    redis.call('SET', KEYS[1], finish, 'PX', finish - now + 60000)
    return start
  `,
});

export interface BatchInput {
  leadIds: string[];
  channel: MessageChannel;
  templateKey: string;
  variables?: string[];
}

/**
 * Send template on the lead grid (M4-38): one job per lead the sender may
 * message, spaced `SEND_SPACING_MS` apart per workspace, each sent when its turn
 * comes through `sendLeadMessage`. Leads that opted out, have nowhere to send
 * it, or are outside the sender's scope (or not found) are counted, not queued.
 */
export async function queueLeadMessages(ctx: Ctx, input: BatchInput) {
  const { tenantId } = ctx;
  // Refused before anything is queued: a template that cannot go, a channel not connected, a value missing.
  const template = await sendableTemplate(tenantId, input.channel, input.templateKey);
  if (input.channel === 'WHATSAPP') await whatsAppSender(tenantId);
  const given = input.variables ?? [];
  templateValues(`${template.subject ?? ''} ${template.body}`, given, { firstName: 'x', fullName: 'x' }, 'x');

  const wanted = [...new Set(input.leadIds)];
  const leads = await prisma.lead.findMany({
    where: { ...(await leadScope(ctx, 'EDIT', { includeUnassigned: true })), id: { in: wanted }, deletedAt: null },
    select: CONTACT,
  });
  const skipped = { optedOut: 0, noRecipient: 0, notFound: wanted.length - leads.length };
  const ready = new Set<string>();
  for (const lead of leads) {
    try {
      recipientOf(lead, input.channel);
      ready.add(lead.id);
    } catch (err) {
      if ((err as AppError).errors?.[0]?.code === 'opted_out') skipped.optedOut += 1;
      else skipped.noRecipient += 1;
    }
  }
  // In the order they were picked.
  const queue = wanted.filter((id) => ready.has(id));

  const batchId = randomUUID();
  if (queue.length) {
    const now = Date.now();
    const start = await (redis as unknown as ReserveCommand).reserveSendSlots(
      `lead-send:slots:${tenantId}`,
      String(now),
      String(queue.length),
      String(SEND_SPACING_MS),
    );
    for (const [index, leadId] of queue.entries()) {
      await enqueue(
        'campaign',
        'lead-message',
        {
          tenantId,
          batchId,
          actorId: ctx.actor.id,
          leadId,
          channel: input.channel,
          templateKey: template.key,
          variables: given,
        },
        { delayMs: Math.max(0, Number(start) - now) + index * SEND_SPACING_MS },
      );
    }
  }
  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'lead-message-batch',
    recordId: batchId,
    metadata: { channel: input.channel, template: template.key, queued: queue.length, skipped },
  });
  return { batchId, total: wanted.length, queued: queue.length, skipped };
}

/**
 * One queued send, as the person who asked for it. A refusal now (the lead
 * opted out since, left their scope, the template was withdrawn, their role
 * lost the permission) is the answer, not a fault to retry.
 */
export async function runQueuedLeadMessage(data: {
  tenantId: string;
  batchId: string;
  actorId: string;
  leadId: string;
  channel: MessageChannel;
  templateKey: string;
  variables?: string[];
}) {
  try {
    // Suspended, or without a lead module, since the batch was queued: nothing more goes.
    const live = await withTx(data.tenantId, (tx) =>
      tx.tenant.count({ where: { id: data.tenantId, status: 'ACTIVE', deletedAt: null } }),
    );
    if (!live) throw NotFound('Workspace');
    await assertAnyModuleEntitlement(data.tenantId, LEAD_MODULES);
    const ctx = await ctxForUser(data.actorId, data.tenantId, randomUUID());
    assertPermission(ctx, 'communications', 'CREATE');
    await sendLeadMessage(ctx, data.leadId, {
      channel: data.channel,
      templateKey: data.templateKey,
      variables: data.variables,
      batchId: data.batchId,
    });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    logger.info(
      { tenantId: data.tenantId, batchId: data.batchId, leadId: data.leadId, code: err.code },
      'queued lead message not sent',
    );
  }
}
