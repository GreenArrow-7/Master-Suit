/**
 * The four customer channels, as an administrator experiences them.
 *
 * The existing integrations board is organised by *vendor* and asks for
 * credentials; this is organised by *channel* and answers "is it working". Both
 * read the same `IntegrationConnection` rows — this adds no storage of its own,
 * because every fact it needs is already recorded somewhere.
 *
 * Nothing here is static. A card that says "Connected" because a card was
 * hard-coded to say "Connected" is worse than no card, so every value below is
 * derived from a real row and the mode is derived from whether the credentials
 * would actually construct a live provider.
 */
import { prisma } from '@/lib/db';
import { connectionCredentials } from '@/lib/integrations/connection';

/**
 * §4/§8: an administrator must never mistake a mock for a live connection.
 *
 * SIMULATED is not a failure state — it is how the product is demonstrated
 * without production provider credentials — but it must be impossible to
 * confuse with LIVE.
 */
export type Mode = 'LIVE' | 'SIMULATED' | 'NOT_CONFIGURED';

export type Health = 'HEALTHY' | 'ATTENTION' | 'UNKNOWN';

export interface ChannelCard {
  key: 'meta' | 'whatsapp' | 'website' | 'notifications';
  title: string;
  blurb: string;
  mode: Mode;
  /** Provider/connection status, verbatim where one exists. */
  status: string;
  health: Health;
  /** Short label/value pairs shown on the card face. */
  facts: { label: string; value: string }[];
  /** Where [Manage] goes, relative to the workspace. */
  href: string;
  /** True once the channel is usable — drives the setup checklist (§61). */
  ready: boolean;
  /** Why it needs attention, in words an administrator can act on. */
  attention: string | null;
}

const ago = (date: Date | null | undefined): string => {
  if (!date) return '—';
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return date.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' });
};

export async function channelCards(tenantId: string, slug: string): Promise<ChannelCard[]> {
  const settings = `/${slug}/admin/integrations`;
  const metaPage = `${settings}/meta`;

  const [meta, metaCreds, lastMetaEvent, failedEvents, templates, forms, lastSubmission, notified] = await Promise.all([
    prisma.integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'meta' } },
      select: { status: true, lastSyncAt: true, errorMessage: true, expiresAt: true, metadata: true },
    }),
    // Decrypts, so it is the only honest way to know whether a *live* provider
    // would be constructed or the mock would be returned instead.
    connectionCredentials(tenantId, 'meta'),
    prisma.webhookEvent.findFirst({
      where: { tenantId, provider: { startsWith: 'meta:' } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, eventType: true },
    }),
    prisma.webhookEvent.count({ where: { tenantId, processed: false, attempts: { gt: 0 } } }),
    prisma.messageTemplate.count({
      where: { tenantId, channel: 'WHATSAPP', deletedAt: null, approvalState: 'APPROVED', isActive: true },
    }),
    prisma.form.count({ where: { tenantId, deletedAt: null, state: 'PUBLISHED', isPublic: true } }),
    prisma.formSubmission.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.notification.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const connected = meta?.status === 'CONNECTED';
  /**
   * Live only when the credentials that `getWhatsAppProvider` requires are all
   * present. Anything less returns MockWhatsAppProvider, and a card claiming
   * LIVE over a mock is the specific lie §4 forbids.
   */
  const metaLive = Boolean(connected && metaCreds?.accessToken && metaCreds?.phoneNumberId);
  const metaMode: Mode = !meta ? 'NOT_CONFIGURED' : metaLive ? 'LIVE' : 'SIMULATED';
  const tokenExpired = Boolean(meta?.expiresAt && meta.expiresAt.getTime() < Date.now());

  const metaAttention = !meta
    ? null
    : tokenExpired
      ? 'The Meta connection has expired. Reconnect to keep receiving leads.'
      : meta.errorMessage
        ? meta.errorMessage
        : !metaLive
          ? 'Running against the simulated provider. Add live credentials to go live.'
          : null;

  return [
    {
      key: 'meta',
      title: 'Facebook & Instagram',
      blurb: 'Lead forms and messages from your Page and Instagram account.',
      mode: metaMode,
      status: meta?.status ?? 'NOT_CONFIGURED',
      health: !meta ? 'UNKNOWN' : tokenExpired || meta.errorMessage ? 'ATTENTION' : 'HEALTHY',
      facts: [
        { label: 'Page', value: String((meta?.metadata as { pageName?: string })?.pageName ?? '—') },
        { label: 'Last event', value: ago(lastMetaEvent?.createdAt) },
        { label: 'Event type', value: lastMetaEvent?.eventType ?? '—' },
      ],
      href: metaPage,
      ready: metaMode !== 'NOT_CONFIGURED' && !tokenExpired,
      attention: metaAttention,
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp',
      blurb: 'Two-way conversations with customers on your business number.',
      mode: metaMode,
      status: meta?.status ?? 'NOT_CONFIGURED',
      health: !meta ? 'UNKNOWN' : failedEvents > 0 ? 'ATTENTION' : 'HEALTHY',
      facts: [
        { label: 'Number ID', value: metaCreds?.phoneNumberId ? 'Configured' : 'Not set' },
        { label: 'Approved templates', value: String(templates) },
        { label: 'Business account', value: metaCreds?.wabaId ? 'Configured' : 'Not set' },
      ],
      href: settings,
      // Templates are the only way to open a conversation, so a WhatsApp
      // connection with none approved is connected but not yet usable.
      ready: metaMode !== 'NOT_CONFIGURED' && templates > 0,
      attention:
        metaMode === 'NOT_CONFIGURED'
          ? null
          : !metaCreds?.wabaId
            ? 'Add the WhatsApp Business Account ID to sync templates.'
            : templates === 0
              ? 'No approved templates yet. Sync templates to message customers outside the 24-hour window.'
              : null,
    },
    {
      key: 'website',
      title: 'Website',
      blurb: 'Enquiries from your own site, with campaign attribution.',
      // The website channel is first-party: there is no external provider to
      // simulate, so it is live as soon as a public form exists.
      mode: forms > 0 ? 'LIVE' : 'NOT_CONFIGURED',
      status: forms > 0 ? 'ACTIVE' : 'NOT_CONFIGURED',
      health: forms > 0 ? 'HEALTHY' : 'UNKNOWN',
      facts: [
        { label: 'Published forms', value: String(forms) },
        { label: 'Last enquiry', value: ago(lastSubmission?.createdAt) },
        { label: 'Attribution', value: 'UTM + referrer' },
      ],
      href: `/${slug}/sales/forms`,
      ready: forms > 0,
      attention: forms === 0 ? 'Publish a form to start capturing website enquiries.' : null,
    },
    {
      key: 'notifications',
      title: 'Notifications',
      blurb: 'How your team hears about new leads, messages and follow-ups.',
      mode: 'LIVE',
      status: 'ACTIVE',
      health: 'HEALTHY',
      facts: [
        { label: 'In-app', value: 'Enabled' },
        // Stated honestly rather than optimistically: web push is not built.
        { label: 'Web push', value: 'Setup required' },
        { label: 'Last sent', value: ago(notified?.createdAt) },
      ],
      href: `/${slug}/notifications`,
      ready: false,
      attention: 'Web push is not configured yet, so alerts only arrive inside the app.',
    },
  ];
}
