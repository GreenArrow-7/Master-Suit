import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { can } from '@/lib/security/rbac';
import { callbackSecrets, UNSIGNED_VENDORS } from '@/lib/integrations/telephony';
import { defaultVendor } from '@/lib/integrations/telephony/resolve';
import { PROVIDERS } from '@/lib/integrations/registry';
import { CALENDARS, isCalendarProvider } from '@/services/integrations/calendarSync';
import { isAppUserAgent } from '@/lib/mobile/iosApp';
import { headers } from 'next/headers';
import { buildId } from '@/lib/build';
import IntegrationBoard, { type ProviderCard } from '@/components/workspace/IntegrationBoard';
import ChannelOverview from '@/components/workspace/ChannelOverview';
import { channelCards } from '@/services/integrations/channelState';
import { withSwitches } from '@/services/leads/intake';

export const metadata = { title: 'Integrations' };

/**
 * Replaces a read-only table over `Integration` — a catalogue model nothing in
 * the application has ever written a row to, so the page was permanently empty
 * while the connections that actually gate Meet, WhatsApp, transcription and
 * every outbound call lived in `IntegrationConnection` with no UI at all.
 */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { workspaceSlug } = await params;
  // Back from a calendar's consent screen (api/v1/integrations/{google,microsoft}/callback).
  const back = await searchParams;
  const ctx = await requirePageAccess({ permission: ['integrations', 'VIEW'] });

  const [connections, chosen, channels] = await Promise.all([
    prisma.integrationConnection.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        provider: true,
        status: true,
        webhookKey: true,
        metadata: true,
        lastSyncAt: true,
        errorMessage: true,
      },
    }),
    defaultVendor(ctx.tenantId),
    channelCards(ctx.tenantId, workspaceSlug),
  ]);

  const byProvider = new Map(connections.map((c) => [c.provider, c]));
  const inApp = isAppUserAgent((await headers()).get('user-agent'));
  const base = env.APP_URL.replace(/\/$/, '');

  const providers: ProviderCard[] = await Promise.all(
    PROVIDERS.map(async (spec) => {
      const conn = byProvider.get(spec.key);
      const token =
        conn && UNSIGNED_VENDORS.includes(spec.key as never)
          ? `?token=${callbackSecrets(conn.webhookKey).urlToken}`
          : '';
      // A switch shows what it does now: as saved, or its default.
      const { settingFields, settings } = await withSwitches(ctx.tenantId, spec.settings, conn?.metadata);

      return {
        key: spec.key,
        label: spec.label,
        category: spec.category,
        description: spec.description,
        capabilities: spec.capabilities,
        unsignedCallbacks: spec.unsignedCallbacks ?? false,
        credentialFields: spec.credentials.map(({ key, label, secret, hint }) => ({ key, label, secret, hint })),
        settingFields: settingFields.map(({ key, label, hint, toggle }) => ({ key, label, hint, toggle: !!toggle })),
        status: conn?.status ?? 'NOT_CONFIGURED',
        settings,
        lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
        errorMessage: conn?.errorMessage ?? null,
        webhookUrl: spec.webhook && conn ? `${base}/api/v1/webhooks/${spec.webhook}/${conn.webhookKey}${token}` : null,
        manageHref: spec.category === 'LEADS' && conn ? `/${workspaceSlug}/admin/lead-sources/${spec.key}` : null,
        oauth: isCalendarProvider(spec.key) ? { configured: CALENDARS[spec.key].configured(), inApp } : null,
      };
    }),
  );

  return (
    <>
      <ListHeader
        title="Integrations"
        description="Connect your business tools and channels."
        help={<p>Credentials are encrypted before they are stored and are never shown again.</p>}
      />

      <ChannelOverview cards={channels} />

      {/* The vendor board stays beneath the channel view: it answers a different
          and more technical question — which credential goes where — and moving
          it would strand the telephony, calendar and transcription providers
          that have no channel card. */}
      <h2 className="lf-channels__title" style={{ marginTop: 'var(--lf-space-5)' }}>
        Providers
      </h2>

      {back.connected && isCalendarProvider(back.connected) && (
        <p
          className={back.error ? 'lf-hint lf-hint--error' : 'lf-hint'}
          role={back.error ? 'alert' : 'status'}
          style={{ marginBottom: 'var(--lf-space-3)' }}
        >
          {back.error ??
            `${CALENDARS[back.connected].label} connected. Meetings, site visits and meeting follow-ups now go onto its calendar as they are booked or changed.`}
        </p>
      )}

      <IntegrationBoard
        providers={providers}
        defaultTelephonyProvider={chosen}
        aiConfigured={Boolean(process.env.GEMINI_API_KEY)}
        canEdit={can(ctx, 'integrations', 'MANAGE_CONFIGURATION')}
        build={buildId()}
      />
    </>
  );
}
