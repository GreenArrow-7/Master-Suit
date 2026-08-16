import { z } from 'zod';
import { geminiKeyForTenant } from '@/lib/ai/gemini';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { Invalid } from '@/lib/errors';
import { callbackSecrets, TELEPHONY_VENDORS, UNSIGNED_VENDORS } from '@/lib/integrations/telephony';
import { defaultVendor } from '@/lib/integrations/telephony/resolve';
import { PROVIDERS } from '@/lib/integrations/registry';

/**
 * The integrations board: what could be connected, what is, and whether it works.
 *
 * Credentials are never in this response — not masked, not partially, not at
 * all. What comes back is the shape of each provider's form, its status, and for
 * vendors that call us, the exact URL to paste into their console.
 */
export const GET = route({ module: 'integrations', action: 'VIEW' }, async ({ ctx }) => {
  const [connections, setting, chosen] = await Promise.all([
    prisma.integrationConnection.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        provider: true,
        status: true,
        webhookKey: true,
        metadata: true,
        expiresAt: true,
        lastSyncAt: true,
        errorMessage: true,
        updatedAt: true,
      },
    }),
    prisma.organizationSetting.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { telephonyProvider: true },
    }),
    defaultVendor(ctx.tenantId),
  ]);

  const byProvider = new Map(connections.map((c) => [c.provider, c]));
  const base = env.APP_URL.replace(/\/$/, '');

  const providers = PROVIDERS.map((spec) => {
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
      lastSyncAt: conn?.lastSyncAt ?? null,
      errorMessage: conn?.errorMessage ?? null,
      updatedAt: conn?.updatedAt ?? null,
      expiresAt: conn?.expiresAt ?? null,
      /** Only meaningful once connected: the key is minted with the connection. */
      webhookUrl: spec.webhook && conn ? `${base}/api/v1/webhooks/telephony/${conn.webhookKey}${token}` : null,
    };
  });

  return {
    providers,
    telephony: {
      /** Which connected vendor places this workspace's calls. */
      defaultProvider: chosen,
      /** True when a human chose it; false when it was inferred from being the only one. */
      explicit: Boolean(setting?.telephonyProvider),
    },
    /**
     * Platform-level rather than per tenant: the model key belongs to the
     * deployment, so the board reports whether it is configured instead of
     * offering a form that would store one workspace's key for everyone.
     */
    ai: { provider: 'gemini', configured: Boolean(await geminiKeyForTenant(ctx.tenantId)) },
  };
});

const patchBody = z
  .object({
    /** Null clears the choice and falls back to "the only connected vendor". */
    defaultTelephonyProvider: z.enum(TELEPHONY_VENDORS).nullable(),
  })
  .strict();

/** Choose which connected vendor places this workspace's calls. */
export const PATCH = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    body: patchBody,
    auditEvent: 'INTEGRATION_MODIFIED',
  },
  async ({ ctx, body }) => {
    const vendor = body.defaultTelephonyProvider;

    if (vendor) {
      const connection = await prisma.integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId: ctx.tenantId, provider: vendor } },
        select: { status: true },
      });
      // Refused rather than stored: a default pointing at nothing turns every
      // later dial into an error message about a provider nobody remembers
      // choosing.
      if (!connection || connection.status !== 'CONNECTED') {
        throw Invalid([
          {
            field: 'defaultTelephonyProvider',
            code: 'not_connected',
            message: `Connect ${vendor} before making it the default calling provider.`,
          },
        ]);
      }
    }

    await prisma.organizationSetting.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, telephonyProvider: vendor },
      update: { telephonyProvider: vendor },
    });

    return { defaultTelephonyProvider: vendor };
  },
);
