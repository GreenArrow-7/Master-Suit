import { z } from 'zod';
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
    ai: { provider: 'gemini', configured: Boolean(process.env.GEMINI_API_KEY) },
  };
});

/**
 * The phrase is required, and it is a phrase rather than a boolean on purpose.
 * `?confirm=true` is what a stray retry, a prefetch or a copied curl line sends
 * by accident; this one has to be typed. Nothing here is recoverable — the rows
 * hold the only copy of each key the workspace has, and the vendor will not
 * hand them back.
 */
const CONFIRM_PHRASE = 'remove-all-credentials';

const deleteQuery = z.object({
  confirm: z.literal(CONFIRM_PHRASE),
  /**
   * Comma-separated provider keys to limit the purge to. Omitted means every
   * connected provider in this workspace.
   */
  providers: z.string().max(500).optional(),
});

/**
 * Remove stored credentials for every linked service at once — or for a named
 * subset.
 *
 * Per-provider disconnect already deletes rather than flags, so this adds no
 * new power; what it adds is doing it in one action instead of one dialog per
 * provider, which is what somebody rotating a compromised set of keys actually
 * needs. Deleting the row also retires each `webhookKey`, so callbacks already
 * in flight stop authenticating.
 */
export const DELETE = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    query: deleteQuery,
    auditEvent: 'INTEGRATION_MODIFIED',
    /**
     * The same budget as the other MANAGE_CONFIGURATION routes, deliberately.
     * The limiter keys on `route:<module>:<action>:<actor>`, so PUT, POST and
     * both DELETEs share one counter — a tighter max here would not protect
     * this endpoint, it would lower the ceiling on saving a key. The control
     * that stops an accidental purge is the phrase, which has to be typed.
     */
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, query }) => {
    const named = query.providers
      ?.split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (named?.length) {
      const unknown = named.filter((p) => !PROVIDERS.some((spec) => spec.key === p));
      if (unknown.length) {
        throw Invalid(
          unknown.map((provider) => ({
            field: 'providers',
            code: 'unknown',
            message: `There is no provider named ${provider}.`,
          })),
        );
      }
    }

    const where = { tenantId: ctx.tenantId, ...(named?.length ? { provider: { in: named } } : {}) };

    // Read first, so the response can name what went. "3 removed" leaves an
    // administrator guessing which three, on the one action they cannot undo.
    const removed = (await prisma.integrationConnection.findMany({ where, select: { provider: true } })).map(
      (c) => c.provider,
    );

    await prisma.integrationConnection.deleteMany({ where });

    // Same reason as the per-provider delete: a default pointing at a provider
    // that is gone makes resolveTelephony refuse every call with a message
    // about a vendor nobody can see any more.
    if (removed.length) {
      await prisma.organizationSetting.updateMany({
        where: { tenantId: ctx.tenantId, telephonyProvider: { in: removed } },
        data: { telephonyProvider: null },
      });
    }

    return { removed, count: removed.length };
  },
);

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
