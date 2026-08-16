import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { can } from '@/lib/security/rbac';
import { callbackSecrets, UNSIGNED_VENDORS } from '@/lib/integrations/telephony';
import { defaultVendor } from '@/lib/integrations/telephony/resolve';
import { PROVIDERS } from '@/lib/integrations/registry';
import IntegrationBoard, { type ProviderCard } from '@/components/workspace/IntegrationBoard';
import { geminiKeyForTenant } from '@/lib/ai/gemini';

export const metadata = { title: 'Integrations' };

/**
 * Replaces a read-only table over `Integration` — a catalogue model nothing in
 * the application has ever written a row to, so the page was permanently empty
 * while the connections that actually gate Meet, WhatsApp, transcription and
 * every outbound call lived in `IntegrationConnection` with no UI at all.
 */
export default async function IntegrationsPage() {
  const ctx = await requirePageAccess({ permission: ['integrations', 'VIEW'] });

  const [connections, chosen, aiConfigured] = await Promise.all([
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
    // The deployment key or the one this workspace connected — the card used to
    // read only the env var and told every hosted tenant "not configured".
    geminiKeyForTenant(ctx.tenantId).then(Boolean),
  ]);

  const byProvider = new Map(connections.map((c) => [c.provider, c]));
  const base = env.APP_URL.replace(/\/$/, '');

  const providers: ProviderCard[] = PROVIDERS.map((spec) => {
    const conn = byProvider.get(spec.key);
    const token =
      conn && UNSIGNED_VENDORS.includes(spec.key as never)
        ? `?token=${callbackSecrets(conn.webhookKey).urlToken}`
        : '';

    return {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      description: spec.description,
      capabilities: spec.capabilities,
      unsignedCallbacks: spec.unsignedCallbacks ?? false,
      credentialFields: spec.credentials.map(({ key, label, secret, hint }) => ({ key, label, secret, hint })),
      settingFields: spec.settings.map(({ key, label, hint }) => ({ key, label, hint })),
      // A deployment-wide GEMINI_API_KEY is a real connection with no row.
      status: conn?.status ?? (spec.key === 'gemini' && aiConfigured ? 'CONNECTED' : 'NOT_CONFIGURED'),
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

      <IntegrationBoard
        providers={providers}
        defaultTelephonyProvider={chosen}
        canEdit={can(ctx, 'integrations', 'MANAGE_CONFIGURATION')}
      />
    </>
  );
}
