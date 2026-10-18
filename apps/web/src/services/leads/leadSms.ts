import { prisma, withTx } from '@/lib/db';
import { type AppError, Forbidden, Invalid } from '@/lib/errors';
import { TelephonyConfigError } from '@/lib/integrations/telephony';
import { TelephonyApiError } from '@/lib/integrations/telephony/http';
import { resolveSms, type SmsSetup } from '@/lib/integrations/telephony/resolve';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { normalizePhone } from './normalizePhone';

/**
 * A text sent to a lead from its page (Lead Eagle audit row M4-29), through
 * the workspace's calling provider when it sends SMS (resolve.ts `resolveSms`),
 * from the SMS sender on its card. Sent as WhatsApp and email are from the lead
 * (leadMessages.ts): only under the sender's lead scope (`leads:EDIT`, 404
 * outside it), never to a lead that withdrew consent, opted out of SMS or is
 * on the do-not-call list, and logged as an SMS Communication on the lead, on
 * its timeline, before the provider is asked, then marked sent or failed with
 * the provider's message id or its reason. No number goes back to the sender.
 */
type SmsContact = {
  fullName: string;
  phone: string | null;
  phoneNormalized: string | null;
  smsOptOut: boolean;
  doNotCall: boolean;
  consentStatus: string;
  phones: { normalized: string }[];
};

const CONTACT = {
  fullName: true,
  phone: true,
  phoneNormalized: true,
  smsOptOut: true,
  doNotCall: true,
  consentStatus: true,
  phones: { orderBy: { createdAt: 'asc' }, select: { normalized: true } },
} as const;

const MESSAGE = { id: true, channel: true, status: true, errorMessage: true, sentAt: true } as const;

const refuse = (code: string, message: string) => Invalid([{ field: 'lead', code, message }]);

/** The number a text to the lead goes to, E.164: its main number, else its first other one; or why none. */
export function smsRecipientOf(lead: SmsContact): string {
  if (lead.consentStatus === 'WITHDRAWN') {
    throw refuse('opted_out', `${lead.fullName} has withdrawn consent to be contacted.`);
  }
  if (lead.smsOptOut) throw refuse('opted_out', `${lead.fullName} has opted out of SMS.`);
  if (lead.doNotCall) throw refuse('do_not_contact', `${lead.fullName} is on the do-not-call list.`);
  const to = (lead.phone && (lead.phoneNormalized ?? normalizePhone(lead.phone))) || lead.phones[0]?.normalized;
  if (!to) throw refuse('no_phone', `${lead.fullName} has no phone number.`);
  return to;
}

/** Why Send SMS on the lead page cannot go, as the send would refuse it, or null. */
export function smsBlock(lead: SmsContact, setup: SmsSetup): string | null {
  try {
    smsRecipientOf(lead);
  } catch (err) {
    return (err as AppError).errors[0]!.message;
  }
  return setup.ready ? null : setup.reason;
}

/** A provider's complaint often quotes the number it refused: the sender may read it masked. */
const withoutNumbers = (text: string) => text.replace(/\+?\d[\d\s().-]{4,}\d/g, 'the number').slice(0, 500);

export async function sendLeadSms(ctx: Ctx, leadId: string, text: string) {
  const { tenantId } = ctx;
  // 404 outside the sender's scope, before anything about the lead is read.
  await assertLeadInScope(ctx, leadId, prisma, 'EDIT');
  const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, select: CONTACT });
  const to = smsRecipientOf(lead);
  const sms = await resolveSms(tenantId).catch((err) => {
    if (err instanceof TelephonyConfigError) throw Forbidden(err.message);
    throw err;
  });

  // The message and its audit row first, in one transaction: nothing reaches a customer unrecorded.
  const message = await withTx(tenantId, async (tx) => {
    const row = await tx.communication.create({
      data: {
        tenantId,
        channel: 'SMS',
        direction: 'OUTBOUND',
        status: 'QUEUED',
        leadId,
        fromAddress: sms.from,
        toAddress: to,
        body: text,
        providerKey: sms.vendor,
        queuedAt: new Date(),
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
      select: { id: true },
    });
    await audit(
      ctx,
      {
        event: 'MESSAGE_SENT',
        objectType: 'lead',
        recordId: leadId,
        metadata: { channel: 'SMS', communicationId: row.id },
      },
      tx,
    );
    return row;
  });

  // Then the provider. Its answer, a refusal included, is written on the message.
  const outcome = await sms.send(to, text).then(
    (result) =>
      result.status === 'failed'
        ? {
            status: 'FAILED' as const,
            providerMessageId: result.externalMessageId || null,
            errorCode: result.errorCode ?? null,
            errorMessage: result.errorMessage ? withoutNumbers(result.errorMessage) : null,
          }
        : { status: 'SENT' as const, providerMessageId: result.externalMessageId || null },
    (err: Error) => ({
      status: 'FAILED' as const,
      errorCode: err instanceof TelephonyApiError ? String(err.status) : null,
      errorMessage: withoutNumbers((err instanceof TelephonyApiError && err.detail) || err.message || 'Not sent.'),
    }),
  );
  return prisma.communication.update({
    where: { tenantId, id: message.id },
    data: { ...outcome, sentAt: outcome.status === 'SENT' ? new Date() : null },
    select: MESSAGE,
  });
}
