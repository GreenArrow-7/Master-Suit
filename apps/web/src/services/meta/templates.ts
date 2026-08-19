/**
 * WhatsApp message templates (§31).
 *
 * Templates are the only way to message a customer outside the 24-hour service
 * window, so this is not a nicety bolted onto the inbox — it is the other half
 * of it. The composer disables free-form when the window has lapsed and tells
 * the agent to send a template; without this that instruction leads nowhere.
 *
 * Meta owns approval. Nothing here creates or edits a template: they are
 * authored and reviewed in WhatsApp Manager, and this mirrors their current
 * state so the product can refuse to offer one that is not approved rather than
 * discovering it at send time.
 *
 * Reuses the existing MessageTemplate model, which already carries
 * `providerTemplateId`, `approvalState`, `language` and `mergeFields`.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { connectionCredentials } from '@/lib/integrations/connection';

const GRAPH_VERSION = 'v26.0';

/**
 * Meta's status vocabulary, kept verbatim rather than collapsed to a boolean.
 *
 * "Why can I not use this template" has different answers — still in review,
 * rejected on content, paused for poor quality — and an administrator needs the
 * real one. Only APPROVED may be sent.
 */
export const SENDABLE = 'APPROVED';

interface GraphTemplate {
  id?: string;
  name?: string;
  status?: string;
  language?: string;
  category?: string;
  components?: { type?: string; text?: string }[];
}

/**
 * The variables a template expects, in order.
 *
 * Meta writes them as `{{1}}`, `{{2}}` in the body text; there is no separate
 * field listing them, so they are read out of the body. Named placeholders are
 * kept as written for display.
 */
export function placeholdersOf(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!);
}

export async function syncWhatsAppTemplates(tenantId: string) {
  const credentials = await connectionCredentials(tenantId, 'meta');
  if (!credentials?.accessToken) throw new Error('WhatsApp is not connected for this workspace.');
  if (!credentials.wabaId) {
    // The phone number id is not interchangeable with the business account id,
    // and using it here returns an unhelpful Graph error about permissions.
    throw new Error('No WhatsApp Business Account ID configured. Add it in Settings → Integrations.');
  }

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(credentials.wabaId)}` +
    `/message_templates?fields=id,name,status,language,category,components&limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Template sync failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const payload = (await res.json()) as { data?: GraphTemplate[] };
  const templates = payload.data ?? [];
  let written = 0;

  for (const template of templates) {
    if (!template.name) continue;
    const body = template.components?.find((c) => c.type === 'BODY')?.text ?? '';
    // Name and language together identify a template at Meta — the same name
    // exists once per language — so the local key has to carry both or the
    // second language overwrites the first.
    const key = `wa:${template.name}:${template.language ?? 'en'}`;

    await prisma.messageTemplate.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        name: template.name,
        channel: 'WHATSAPP',
        body,
        language: template.language ?? 'en',
        providerTemplateId: template.id ?? null,
        approvalState: template.status ?? 'UNKNOWN',
        mergeFields: placeholdersOf(body),
        // Meta's approval is the authority on whether this may be sent; the
        // local flag only records that we still see it upstream.
        isActive: true,
      },
      update: {
        name: template.name,
        body,
        language: template.language ?? 'en',
        providerTemplateId: template.id ?? null,
        approvalState: template.status ?? 'UNKNOWN',
        mergeFields: placeholdersOf(body),
        isActive: true,
        deletedAt: null,
      },
    });
    written += 1;
  }

  /**
   * Templates deleted at Meta are deactivated here rather than removed.
   *
   * A Communication row can reference one, and the audit question "what did we
   * send this customer" must stay answerable after the template is withdrawn.
   */
  const seen = templates.filter((t) => t.name).map((t) => `wa:${t.name}:${t.language ?? 'en'}`);
  const { count: retired } = await prisma.messageTemplate.updateMany({
    where: { tenantId, channel: 'WHATSAPP', key: { startsWith: 'wa:' }, NOT: { key: { in: seen } }, isActive: true },
    data: { isActive: false, approvalState: 'WITHDRAWN' },
  });

  logger.info({ tenantId, written, retired }, 'whatsapp templates synced');
  return { synced: written, retired };
}
