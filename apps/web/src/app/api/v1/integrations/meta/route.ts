import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { syncMetaLeadForms } from '@/services/meta/config';

/**
 * Meta administration, gated on managing integrations rather than on viewing
 * communications (§23): choosing where a Facebook form's leads land is a
 * configuration decision, not a selling one, and a sales rep must not reach it
 * even by calling the endpoint directly.
 *
 * Every write is tenant-scoped through `ctx.tenantId`; nothing here accepts a
 * tenant from the caller, and RLS refuses a mismatch underneath regardless.
 */
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({
    action: z.literal('routing'),
    /** Meta's form id — the row is addressed by it, never by a client-supplied row id. */
    providerFormId: z.string().min(1).max(120),
    enabled: z.boolean(),
    source: z.enum(['AD_LEAD_FORM', 'CHAT', 'MARKETPLACE', 'API', 'WEBHOOK', 'AUTOMATION']),
    stageId: z.string().max(60).nullable(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    assignedUserId: z.string().max(60).nullable(),
    assignedTeamId: z.string().max(60).nullable(),
    notifyOwner: z.boolean(),
  }),
  z.object({ action: z.literal('disconnect') }),
]);

export const POST = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    body,
    auditEvent: 'INTEGRATION_MODIFIED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'sync') return syncMetaLeadForms(ctx.tenantId);

    if (body.action === 'disconnect') {
      /**
       * Marks the connection disconnected; it does not delete anything.
       *
       * §29: existing CRM leads, activities and conversations stay. Routing rows
       * stay too, so reconnecting restores the configuration rather than asking
       * the administrator to rebuild it.
       */
      const { count } = await prisma.integrationConnection.updateMany({
        where: { tenantId: ctx.tenantId, provider: 'meta' },
        data: { status: 'DISCONNECTED', errorMessage: null },
      });
      if (!count) throw NotFound('Connection');
      return { disconnected: true };
    }

    /**
     * The routing rule. Addressed by `(tenantId, providerFormId)`, so a caller
     * cannot reach another workspace's row by guessing an id — the tenant half
     * of the key comes from the session, never the request.
     */
    const existing = await prisma.metaLeadFormRouting.findUnique({
      where: { tenantId_providerFormId: { tenantId: ctx.tenantId, providerFormId: body.providerFormId } },
      select: { id: true },
    });
    if (!existing) throw NotFound('Lead form');

    // Referenced rows are re-checked against the tenant. A stage or user id from
    // another workspace must not be storable, even though RLS would also refuse
    // to read it back.
    const [stage, user, team] = await Promise.all([
      body.stageId
        ? prisma.leadStage.findFirst({ where: { tenantId: ctx.tenantId, id: body.stageId }, select: { id: true } })
        : null,
      body.assignedUserId
        ? prisma.user.findFirst({
            where: { tenantId: ctx.tenantId, id: body.assignedUserId, status: 'ACTIVE', deletedAt: null },
            select: { id: true },
          })
        : null,
      body.assignedTeamId
        ? prisma.team.findFirst({ where: { tenantId: ctx.tenantId, id: body.assignedTeamId }, select: { id: true } })
        : null,
    ]);
    if (body.stageId && !stage) throw NotFound('Stage');
    if (body.assignedUserId && !user) throw NotFound('User');
    if (body.assignedTeamId && !team) throw NotFound('Team');

    const saved = await prisma.metaLeadFormRouting.update({
      // Tenant-scoped key again, never a bare id.
      where: { tenantId_providerFormId: { tenantId: ctx.tenantId, providerFormId: body.providerFormId } },
      data: {
        enabled: body.enabled,
        source: body.source,
        stageId: stage?.id ?? null,
        priority: body.priority,
        // A rule names a person or a team, never both: two destinations is an
        // ambiguity the ingestion path would have to guess at.
        assignedUserId: user?.id ?? null,
        assignedTeamId: user?.id ? null : (team?.id ?? null),
        notifyOwner: body.notifyOwner,
      },
      select: { id: true, enabled: true, formName: true },
    });
    return { routing: saved };
  },
);
