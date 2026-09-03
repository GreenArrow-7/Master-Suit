import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  DEMO_LEAD_SOURCES,
  demoLeadStatus,
  generateDemoLead,
  type DemoLeadSource,
} from '@/services/leads/providers/demoSocialLeads';

/**
 * The demo social-lead connector.
 *
 * GET reports whether this workspace may simulate inbound leads and which
 * channels it offers; POST generates one and runs it through the real ingestion
 * pipeline (services/leads/ingestProviderLead.ts) — the same one the Meta
 * webhook uses once it has exchanged a `leadgen_id` for answers.
 *
 * Two gates, deliberately both:
 *
 *   1. `integrations:MANAGE_CONFIGURATION` — connecting and driving an
 *      integration is an administrative act, not something every member can do.
 *   2. `Tenant.isDemo`, enforced in the service rather than here, so it holds
 *      for any future caller and not merely for this route.
 *
 * The second is the one that matters: without it this is an authenticated
 * lead-injection endpoint pointed at a real customer's CRM.
 */
const generateBody = z
  .object({
    source: z.enum(DEMO_LEAD_SOURCES),
    /**
     * Replay the same provider event. Sending one twice must produce one lead,
     * and that is worth being able to demonstrate rather than merely assert.
     */
    externalLeadId: z.string().min(1).max(120).optional(),
  })
  .strict();

export const GET = route({ module: 'integrations', productModule: 'SALES', action: 'VIEW' }, async ({ ctx }) =>
  demoLeadStatus(ctx.tenantId),
);

export const POST = route(
  {
    module: 'integrations',
    productModule: 'SALES',
    action: 'MANAGE_CONFIGURATION',
    body: generateBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const result = await generateDemoLead(ctx.tenantId, {
      source: body.source as DemoLeadSource,
      externalLeadId: body.externalLeadId,
    });

    // The skip reasons are reported, not swallowed: a caller replaying an event
    // should be told it was a duplicate rather than shown a cheerful success.
    return 'leadId' in result
      ? { ok: true, leadId: result.leadId, created: result.created, simulated: true }
      : { ok: false, skipped: result.skipped, simulated: true };
  },
);
