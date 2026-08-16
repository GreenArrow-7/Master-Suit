/**
 * Everything the Meta configuration page shows, and the lead-form sync behind it.
 *
 * The page is a server component, so it reads this directly rather than through
 * a GET endpoint it would only ever call from the server anyway. Mutations go
 * through the API kernel like everything else.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { connectionCredentials } from '@/lib/integrations/connection';

const GRAPH_VERSION = 'v26.0';

export type MetaMode = 'LIVE' | 'SIMULATED' | 'NOT_CONFIGURED';

/**
 * Demo assets, used only when the connection exists but its credentials would
 * construct the mock provider.
 *
 * They exist so the configuration screens can be demonstrated and exercised
 * without a Meta account — every one is labelled SIMULATED in the UI, and they
 * flow through the same MetaLeadFormRouting rows and the same sync endpoint as
 * live assets, so the thing being demonstrated is the real product.
 */
export const DEMO_ASSETS = {
  businessName: 'Manath Homes Demo Business',
  pageName: 'Manath Homes',
  pageId: 'demo-page-1',
  instagramHandle: '@manathhomes',
  instagramId: 'demo-ig-1',
  forms: [
    { id: 'demo-form-dubai', name: 'Dubai Property Enquiry', status: 'ACTIVE' },
    { id: 'demo-form-marina', name: 'Marina Investor Lead Form', status: 'ACTIVE' },
    { id: 'demo-form-consult', name: 'Property Consultation Request', status: 'PAUSED' },
  ],
};

export function modeOf(connection: { status: string } | null, credentials: Record<string, string> | null): MetaMode {
  if (!connection) return 'NOT_CONFIGURED';
  // Live only when the credentials a real Graph call needs are actually present.
  return credentials?.accessToken && credentials?.phoneNumberId ? 'LIVE' : 'SIMULATED';
}

export async function metaConfig(tenantId: string) {
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: 'meta' } },
    select: { id: true, status: true, errorMessage: true, expiresAt: true, lastSyncAt: true, metadata: true },
  });
  const credentials = await connectionCredentials(tenantId, 'meta');
  const mode = modeOf(connection, credentials);
  const metadata = (connection?.metadata ?? {}) as Record<string, string>;
  const simulated = mode === 'SIMULATED';

  const [routings, lastEvent, lastProcessed, failedCount, recentEvents, stages, users, teams] = await Promise.all([
    prisma.metaLeadFormRouting.findMany({
      where: { tenantId },
      orderBy: { formName: 'asc' },
      select: {
        id: true,
        providerFormId: true,
        providerPageId: true,
        formName: true,
        enabled: true,
        source: true,
        stageId: true,
        priority: true,
        assignedUserId: true,
        assignedTeamId: true,
        lastLeadAt: true,
        lastSyncAt: true,
        stage: { select: { name: true } },
        assignedUser: { select: { fullName: true } },
        assignedTeam: { select: { name: true } },
      },
    }),
    prisma.webhookEvent.findFirst({
      where: { tenantId, provider: { startsWith: 'meta:' } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.webhookEvent.findFirst({
      where: { tenantId, provider: { startsWith: 'meta:' }, processed: true },
      orderBy: { processedAt: 'desc' },
      select: { processedAt: true },
    }),
    prisma.webhookEvent.count({
      where: { tenantId, provider: { startsWith: 'meta:' }, processed: false, attempts: { gt: 0 } },
    }),
    prisma.webhookEvent.findMany({
      where: { tenantId, provider: { startsWith: 'meta:' } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      // Deliberately not `payload`: §27 — event metadata is operational, the
      // payload carries customer data and provider detail nobody needs here.
      select: { id: true, eventType: true, createdAt: true, processed: true, attempts: true, errorMessage: true },
    }),
    prisma.leadStage.findMany({ where: { tenantId }, orderBy: { position: 'asc' }, select: { id: true, name: true } }),
    // Only users who can actually receive a lead: an assignment to a suspended
    // account is a lead nobody works.
    prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', deletedAt: null },
      orderBy: { fullName: 'asc' },
      take: 200,
      select: { id: true, fullName: true },
    }),
    prisma.team.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const tokenExpired = Boolean(connection?.expiresAt && connection.expiresAt.getTime() < Date.now());

  return {
    mode,
    simulated,
    connected: connection?.status === 'CONNECTED',
    status: tokenExpired ? 'EXPIRED' : (connection?.status ?? 'NOT_CONFIGURED'),
    errorMessage: connection?.errorMessage ?? null,
    tokenExpired,
    lastSyncAt: connection?.lastSyncAt ?? null,
    assets: {
      businessName: simulated ? DEMO_ASSETS.businessName : (metadata.businessName ?? null),
      pageName: simulated ? DEMO_ASSETS.pageName : (metadata.pageName ?? null),
      pageId: simulated ? DEMO_ASSETS.pageId : (metadata.pageId ?? null),
      instagramHandle: simulated ? DEMO_ASSETS.instagramHandle : (metadata.instagramHandle ?? null),
      instagramId: simulated ? DEMO_ASSETS.instagramId : (metadata.instagramId ?? null),
    },
    /**
     * Capabilities, reported rather than asserted. Instagram and messaging are
     * only claimed when the connection actually carries them — §9 forbids
     * presenting a capability the connected account does not have.
     */
    capabilities: [
      { label: 'Facebook lead forms', available: Boolean(connection), note: 'Receives new Lead Ad submissions.' },
      {
        label: 'Lead retrieval',
        available: Boolean(simulated || credentials?.accessToken),
        note: 'Reads the answers a customer submitted.',
      },
      {
        label: 'Instagram',
        available: Boolean(simulated || metadata.instagramId),
        note: 'Professional account linked to the Page.',
      },
      {
        label: 'Messaging',
        available: Boolean(credentials?.phoneNumberId),
        note: 'Two-way conversations on WhatsApp.',
      },
      {
        label: 'Webhook subscription',
        available: Boolean(connection),
        note: 'Meta notifies this workspace of new events.',
      },
    ],
    forms: routings,
    webhook: {
      lastEventAt: lastEvent?.createdAt ?? null,
      lastProcessedAt: lastProcessed?.processedAt ?? null,
      failed: failedCount,
      health: !connection ? 'UNKNOWN' : failedCount > 0 || tokenExpired ? 'ATTENTION' : 'HEALTHY',
    },
    recentEvents,
    options: { stages, users, teams },
    advanced: {
      provider: 'Meta Graph API',
      apiVersion: GRAPH_VERSION,
      connectionId: connection?.id ?? null,
      pageId: simulated ? DEMO_ASSETS.pageId : (metadata.pageId ?? null),
      instagramId: simulated ? DEMO_ASSETS.instagramId : (metadata.instagramId ?? null),
    },
  };
}

/**
 * Pulls the Page's lead forms and records one routing row per form.
 *
 * Existing rows keep their configuration — a resync must never silently reset a
 * rule an administrator has set. Only the name and `lastSyncAt` are refreshed.
 */
export async function syncMetaLeadForms(tenantId: string) {
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: 'meta' } },
    select: { id: true, metadata: true },
  });
  if (!connection) throw new Error('Facebook & Instagram is not connected for this workspace.');

  const credentials = await connectionCredentials(tenantId, 'meta');
  const mode = modeOf({ status: 'CONNECTED' }, credentials);
  const metadata = (connection.metadata ?? {}) as Record<string, string>;

  let forms: { id: string; name: string; status: string }[];
  let pageId: string;

  if (mode === 'LIVE') {
    pageId = metadata.pageId ?? '';
    if (!pageId) throw new Error('No Facebook Page is selected for this connection.');
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,status&limit=200`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${credentials!.accessToken}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Meta refused the lead form request: HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as { data?: { id?: string; name?: string; status?: string }[] };
    forms = (data.data ?? [])
      .filter((f) => f.id && f.name)
      .map((f) => ({ id: String(f.id), name: String(f.name), status: String(f.status ?? 'ACTIVE') }));
  } else {
    // Demo fixtures, through the same code path and the same rows as live ones.
    pageId = DEMO_ASSETS.pageId;
    forms = DEMO_ASSETS.forms;
  }

  const now = new Date();
  for (const form of forms) {
    await prisma.metaLeadFormRouting.upsert({
      where: { tenantId_providerFormId: { tenantId, providerFormId: form.id } },
      create: { tenantId, providerFormId: form.id, providerPageId: pageId, formName: form.name, lastSyncAt: now },
      // Name and sync time only. Everything else is the administrator's.
      update: { formName: form.name, providerPageId: pageId, lastSyncAt: now },
    });
  }

  // Addressed by the tenant-scoped composite key, not a bare id: the guard in
  // lib/db.ts refuses an update with no tenantId filter, which is exactly the
  // protection that caught this.
  await prisma.integrationConnection.update({
    where: { tenantId_provider: { tenantId, provider: 'meta' } },
    data: { lastSyncAt: now },
  });
  logger.info({ tenantId, count: forms.length, mode }, 'meta lead forms synced');
  return { synced: forms.length, mode };
}
