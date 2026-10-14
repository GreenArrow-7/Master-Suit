import { prisma } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { connectionCredentials } from '@/lib/integrations/connection';
import { getWhatsAppProvider, type WhatsAppProvider } from '@/lib/integrations/whatsapp';
import { SENDABLE } from '@/services/meta/templates';

/**
 * The pieces of a templated send that the inbox's reply and the lead's own
 * send (M4-28) share, so the two cannot disagree on which template may go, what
 * the customer reads, or what "not connected" means.
 */

/**
 * A template as it may be sent now, re-read rather than trusted from the request.
 *
 * A client that could name a template and its body would be able to send
 * unreviewed content through an approved name, which is the whole thing
 * template review exists to prevent. Approval state is checked at send time
 * too: a template approved when the page loaded can be paused by Meta minutes
 * later. An email template is the workspace's own (Administration → Email
 * templates): it needs only to be active.
 */
export async function sendableTemplate(tenantId: string, channel: 'WHATSAPP' | 'EMAIL', key: string) {
  const template = await prisma.messageTemplate.findFirst({
    where: { tenantId, key, channel, deletedAt: null },
    select: {
      id: true,
      key: true,
      name: true,
      subject: true,
      body: true,
      language: true,
      approvalState: true,
      isActive: true,
    },
  });
  if (!template) throw NotFound('Template');
  const approved = channel !== 'WHATSAPP' || template.approvalState === SENDABLE;
  if (!template.isActive || !approved) {
    throw Conflict(`That template is ${(template.approvalState ?? 'unavailable').toLowerCase()} and cannot be sent.`);
  }
  return template;
}

/**
 * `{{1}}`, `{{2}}` replaced by the values, in order: what the customer actually
 * receives, stored so the thread shows it rather than a row of placeholders. A
 * placeholder with no value stays as written.
 */
export function fillTemplate(text: string, values: readonly string[]) {
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, token) => {
    const index = Number(token);
    return Number.isInteger(index) && index >= 1 ? (values[index - 1] ?? match) : match;
  });
}

/**
 * The workspace's WhatsApp sender, or 403 while it has none connected. Never
 * the mock in its place: a mock answers with plausible message ids, which would
 * read as sent while nothing left.
 */
export async function whatsAppSender(tenantId: string) {
  const credentials = await connectionCredentials(tenantId, 'meta');
  if (!credentials?.accessToken || !credentials.phoneNumberId) {
    throw Forbidden('WhatsApp is not connected for this workspace.');
  }
  return { provider: getWhatsAppProvider(credentials), from: String(credentials.phoneNumberId) };
}

/** One approved template to one WhatsApp number, its values as the body's parameters. */
export function sendWhatsAppTemplate(
  provider: WhatsAppProvider,
  to: string,
  template: { name: string; language: string },
  values: readonly string[],
) {
  return provider.sendTemplate({
    to,
    template: {
      name: template.name,
      language: template.language,
      components: values.length
        ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
        : undefined,
    },
  });
}
