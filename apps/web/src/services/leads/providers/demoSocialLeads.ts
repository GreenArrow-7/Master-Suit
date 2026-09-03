import { randomBytes } from 'node:crypto';
import type { RecordSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { ingestProviderLead, type IngestResult } from '@/services/leads/ingestProviderLead';

/**
 * A simulated inbound lead source, for workspaces with no real provider.
 *
 * ── Why this is not a "create a demo lead" button ───────────────────────────
 *
 * The obvious implementation is `POST /demo → prisma.lead.create(...)`. It would
 * put a row on the screen and prove nothing: not deduplication, not routing, not
 * attribution, not distribution, not the automation trigger — none of the things
 * that actually decide whether a real Facebook lead reaches a salesperson.
 *
 * So this is a provider *adapter*, exactly like the Meta one. It generates an
 * event in a provider's shape and hands it to
 * services/leads/ingestProviderLead.ts — the same function the Meta webhook
 * calls after its Graph exchange. A demo lead is deduplicated against existing
 * customers, routed by any form rule, assigned by the distribution engine and
 * announced to automation, because it goes through the code that does those
 * things rather than around it.
 *
 * The consequence worth stating: when Meta credentials are finally connected,
 * nothing downstream is new or untested. The only untested part left is the
 * Graph call itself.
 *
 * ── Why it is labelled, and gated ──────────────────────────────────────────
 *
 * The leads it makes are real rows in the real table — that is the point — so
 * they say where they came from. `source` uses the honest CRM term for the
 * channel, `sourceDetail` is prefixed `demo:`, and the attribution carries
 * `simulated: true`. Nothing here pretends a provider is connected.
 *
 * And it refuses any workspace not explicitly marked `isDemo`. Without that,
 * this is an authenticated lead-injection endpoint aimed at production data.
 */
export const DEMO_LEAD_SOURCES = ['FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'WHATSAPP'] as const;
export type DemoLeadSource = (typeof DEMO_LEAD_SOURCES)[number];

/**
 * How each simulated channel maps onto the CRM's own vocabulary.
 *
 * `RecordSource` already distinguishes these, and the reports read it — so a
 * demo Facebook lead is an `AD_LEAD_FORM` like a real one, not a catch-all.
 */
const CHANNEL: Record<DemoLeadSource, { source: RecordSource; label: string; form: string | null }> = {
  FACEBOOK: { source: 'AD_LEAD_FORM', label: 'Facebook Lead Ads', form: 'demo-facebook-form' },
  INSTAGRAM: { source: 'AD_LEAD_FORM', label: 'Instagram', form: 'demo-instagram-form' },
  WEBSITE: { source: 'PUBLIC_FORM', label: 'Website enquiry form', form: 'demo-website-form' },
  WHATSAPP: { source: 'CHAT', label: 'WhatsApp', form: null },
};

const FIRST = ['Aisha', 'Omar', 'Layla', 'Hassan', 'Noor', 'Yusuf', 'Mariam', 'Khalid', 'Zara', 'Tariq'];
const LAST = ['Al Mansoori', 'Haddad', 'Rahman', 'Siddiqui', 'Farouk', 'Nasser', 'Iqbal', 'Darwish'];
const INTEREST = ['2-bed in Marina', 'Villa in Arabian Ranches', 'Off-plan Downtown', 'Studio in JVC'];

const pick = <T>(values: readonly T[]) => values[Math.floor(Math.random() * values.length)]!;

export interface DemoLeadRequest {
  source: DemoLeadSource;
  /**
   * The provider's id for this lead.
   *
   * Supplied when a caller wants to *replay* an event — sending the same one
   * twice must produce one lead, which is the behaviour worth demonstrating.
   * Generated when absent, so the ordinary "give me a lead" button produces a
   * new person each time.
   */
  externalLeadId?: string;
}

/** The demo integration's state, for the Social Leads screen. */
export async function demoLeadStatus(tenantId: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { isDemo: true },
  });
  if (!tenant) throw NotFound('Workspace');

  const generated = await prisma.webhookEvent.count({
    where: { tenantId, provider: { startsWith: 'demo:' } },
  });

  return {
    /** Never "Connected": this is simulated, and the screen must say so. */
    state: tenant.isDemo ? ('DEMO_MODE' as const) : ('UNAVAILABLE' as const),
    enabled: tenant.isDemo,
    sources: DEMO_LEAD_SOURCES.map((source) => ({
      key: source,
      label: CHANNEL[source].label,
      recordSource: CHANNEL[source].source,
    })),
    generated,
  };
}

/**
 * Generates one simulated lead and puts it through the real ingestion pipeline.
 *
 * Returns whatever the pipeline returned, including the skip reasons — a caller
 * replaying an event should see `duplicate-event`, not a cheerful success.
 */
export async function generateDemoLead(tenantId: string, request: DemoLeadRequest): Promise<IngestResult> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { isDemo: true },
  });
  if (!tenant) throw NotFound('Workspace');
  /**
   * The gate. A production workspace cannot generate leads into its own CRM,
   * however the request was authenticated — §26: demo endpoints must never
   * become lead-injection endpoints.
   */
  if (!tenant.isDemo) {
    throw Forbidden('Demo lead generation is only available in a demo workspace.');
  }

  const channel = CHANNEL[request.source];
  const externalLeadId =
    request.externalLeadId ?? `demo-${request.source.toLowerCase()}-${randomBytes(8).toString('hex')}`;
  const first = pick(FIRST);
  const last = pick(LAST);
  const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');

  return ingestProviderLead({
    tenantId,
    // Namespaced like every other provider, so the idempotency key cannot
    // collide with a real one and the rows are identifiable afterwards.
    provider: `demo:${request.source}`,
    externalLeadId,
    occurredAt: new Date(),
    identity: {
      fullName: `${first} ${last}`,
      email: `${handle}.${externalLeadId.slice(-6)}@demo.invalid`,
      // +971 5x, a real UAE mobile shape so normalisation is genuinely exercised.
      phone: `+9715${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    },
    formId: channel.form,
    source: channel.source,
    sourceDetail: `demo:${request.source.toLowerCase()}`,
    attribution: {
      simulated: true,
      demoSource: request.source,
      demoChannel: channel.label,
      demoFormId: channel.form,
      interest: pick(INTEREST),
      externalLeadId,
      receivedAt: new Date().toISOString(),
    },
    attributionKey: 'demoLead',
  });
}
