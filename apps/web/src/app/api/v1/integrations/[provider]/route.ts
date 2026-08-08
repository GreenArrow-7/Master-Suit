import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { connectionCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { CREDENTIAL_ALSO_SETTINGS, providerSpec } from '@/lib/integrations/registry';
import { verifyConnection } from '@/lib/integrations/verify';

const params = z.object({ provider: z.string().min(2).max(40) });

const body = z
  .object({
    /**
     * Omit a field to keep what is stored. Sending `""` clears it. This is what
     * lets an admin change the caller number without re-typing an auth token
     * they cannot read back.
     */
    credentials: z.record(z.string().max(4000)).default({}),
    settings: z.record(z.union([z.string().max(500), z.boolean()])).default({}),
    /** Save without contacting the vendor. The status then reads UNVERIFIED. */
    skipVerification: z.boolean().default(false),
  })
  .strict();

/**
 * Connect or reconfigure a provider.
 *
 * Credentials are wrapped before they reach the database and are never returned
 * by any route. The vendor is asked whether they work before the connection is
 * marked CONNECTED — a badge that means "somebody typed something" is worse than
 * no badge, because it sends the first failure to the wrong team.
 */
export const PUT = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    params,
    body,
    auditEvent: 'INTEGRATION_MODIFIED',
    // Verification talks to a third party, so this is not a free endpoint.
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) => {
    const spec = providerSpec(params.provider);
    if (!spec) throw NotFound('Provider');

    const allowedCredentials = new Set(spec.credentials.map((f) => f.key));
    const allowedSettings = new Set(spec.settings.map((f) => f.key));
    const unknown = [
      ...Object.keys(body.credentials).filter((k) => !allowedCredentials.has(k)),
      ...Object.keys(body.settings).filter((k) => !allowedSettings.has(k)),
    ];
    if (unknown.length) {
      throw Invalid(
        unknown.map((field) => ({ field, code: 'unknown', message: `${spec.label} has no field named ${field}.` })),
      );
    }

    // Merge over what is stored, so a partial edit does not wipe a token the
    // admin was never shown.
    const existing = (await connectionCredentials(ctx.tenantId, params.provider)) ?? {};
    const credentials: Record<string, string> = { ...existing };
    for (const [key, value] of Object.entries(body.credentials)) {
      if (value === '') delete credentials[key];
      else credentials[key] = value;
    }
    // A couple of providers read a non-secret selector out of the credential
    // map; keep the two copies in step rather than making callers know.
    for (const key of CREDENTIAL_ALSO_SETTINGS[params.provider] ?? []) {
      const setting = body.settings[key];
      if (typeof setting === 'string' && setting) credentials[key] = setting;
    }

    const missing = spec.credentials.filter((f) => f.secret && !credentials[f.key]);
    if (missing.length) {
      throw Invalid(
        missing.map((f) => ({ field: f.key, code: 'required', message: `${f.label} is required to connect.` })),
      );
    }

    const previous = await prisma.integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider: params.provider } },
      select: { metadata: true },
    });
    const metadata = { ...((previous?.metadata ?? {}) as Record<string, unknown>), ...body.settings };

    const verdict = body.skipVerification
      ? ({ ok: null, detail: 'Saved without verification.' } as const)
      : await verifyConnection(params.provider, credentials);

    const connection = await prisma.integrationConnection.upsert({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider: params.provider } },
      create: {
        tenantId: ctx.tenantId,
        provider: params.provider,
        credentials: wrapCredentials(credentials),
        metadata,
        // `null` means unverifiable, not failed: Knowlarity has no read-only
        // endpoint, so refusing to connect it would make the vendor unusable.
        status: verdict.ok === false ? 'ERROR' : 'CONNECTED',
        errorMessage: verdict.ok === false ? verdict.detail : null,
        lastSyncAt: verdict.ok === true ? new Date() : null,
        createdById: ctx.actor.id,
      },
      update: {
        credentials: wrapCredentials(credentials),
        metadata,
        status: verdict.ok === false ? 'ERROR' : 'CONNECTED',
        errorMessage: verdict.ok === false ? verdict.detail : null,
        lastSyncAt: verdict.ok === true ? new Date() : undefined,
      },
      select: { id: true, provider: true, status: true, webhookKey: true, metadata: true, lastSyncAt: true },
    });

    return { ...connection, verification: verdict };
  },
);

/** Re-test a stored connection without changing it. */
export const POST = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    params,
    auditEvent: 'INTEGRATION_MODIFIED',
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, params }) => {
    if (!providerSpec(params.provider)) throw NotFound('Provider');
    const credentials = await prisma.integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider: params.provider } },
      select: { id: true },
    });
    if (!credentials) throw NotFound('Connection');

    const stored = (await connectionCredentials(ctx.tenantId, params.provider)) ?? {};
    const verdict = await verifyConnection(params.provider, stored);

    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider: params.provider } },
      data: {
        status: verdict.ok === false ? 'ERROR' : 'CONNECTED',
        errorMessage: verdict.ok === false ? verdict.detail : null,
        lastSyncAt: verdict.ok === true ? new Date() : undefined,
      },
    });

    return { provider: params.provider, verification: verdict };
  },
);

/**
 * Disconnect.
 *
 * The row is deleted rather than flagged, because a disconnected provider has no
 * business still holding a usable API token. Deleting it also retires the
 * `webhookKey`, so callbacks already in flight for it stop authenticating —
 * which is the point of disconnecting.
 */
export const DELETE = route(
  { module: 'integrations', action: 'MANAGE_CONFIGURATION', params, auditEvent: 'INTEGRATION_MODIFIED' },
  async ({ ctx, params }) => {
    const deleted = await prisma.integrationConnection.deleteMany({
      where: { tenantId: ctx.tenantId, provider: params.provider },
    });
    if (deleted.count === 0) throw NotFound('Connection');

    // A workspace must not be left pointing its default at a provider that is
    // gone; resolveTelephony would then refuse every call with a confusing message.
    await prisma.organizationSetting.updateMany({
      where: { tenantId: ctx.tenantId, telephonyProvider: params.provider },
      data: { telephonyProvider: null },
    });

    return { provider: params.provider, status: 'NOT_CONFIGURED' };
  },
);
