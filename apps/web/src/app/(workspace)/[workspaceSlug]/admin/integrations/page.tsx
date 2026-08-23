import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { can } from '@/lib/security/rbac';
import { callbackSecrets, UNSIGNED_VENDORS } from '@/lib/integrations/telephony';
import { defaultVendor } from '@/lib/integrations/telephony/resolve';
import { PROVIDERS } from '@/lib/integrations/registry';
import { buildId } from '@/lib/build';
import IntegrationBoard, { type ProviderCard } from '@/components/workspace/IntegrationBoard';
import ChannelOverview from '@/components/workspace/ChannelOverview';
import { channelCards } from '@/services/integrations/channelState';

export const metadata = { title: 'Integrations' };

/**
 * Replaces a read-only table over `Integration` — a catalogue model nothing in
 * the application has ever written a row to, so the page was permanently empty
 * while the connections that actually gate Meet, WhatsApp, transcription and
 * every outbound call lived in `IntegrationConnection` with no UI at all.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
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
  const base = env.APP_URL.replace(/\/$/, '');

  const providers: ProviderCard[] = PROVIDERS.map((spec) => {
    const conn = byProvider.get(spec.key);
    const token =
      conn && UNSIGNED_VENDORS.includes(spec.key as never) ? `?token=${callbackSecrets(conn.webhookKey).urlToken}` : '';

    return {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      description: spec.description,
      capabilities: spec.capabilities,
      unsignedCallbacks: spec.unsignedCallbacks ?? false,
      credentialFields: spec.credentials.map(({ key, label, secret, hint }) => ({ key, label, secret, hint })),
      settingFields: spec.settings.map(({ key, label, hint }) => ({ key, label, hint })),
      status: conn?.status ?? 'NOT_CONFIGURED',
      settings: (conn?.metadata ?? {}) as Record<string, unknown>,
      lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
      errorMessage: conn?.errorMessage ?? null,
      webhookUrl: spec.webhook && conn ? `${base}/api/v1/webhooks/telephony/${conn.webhookKey}${token}` : null,
    };
  });

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          Integrations
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Credentials are encrypted before they are stored and are never shown again.
        </p>
      </header>

      <ChannelOverview cards={channels} />

      {/* The vendor board stays beneath the channel view: it answers a different
          and more technical question — which credential goes where — and moving
          it would strand the telephony, calendar and transcription providers
          that have no channel card. */}
      <h2 className="lf-channels__title" style={{ marginTop: 'var(--lf-space-5)' }}>
        Providers
      </h2>

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
