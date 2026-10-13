import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { leadScope } from '@/lib/security/record-scope';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import { listLeadSources } from '@/services/leads/leadSources';
import { decayRule } from '@/services/leads/scoring';
import SourceEditor from './SourceEditor';
import ScoreDecay from './ScoreDecay';

export const metadata = { title: 'Lead sources' };

/**
 * Where leads come from, as this workspace names it (M4-03): each source and
 * its sub-sources, offered on the lead form and grouped in the source reports.
 * An entry is deactivated, never deleted. Each one's lead count is of the leads
 * the viewer may see, and there is none for a viewer without `leads:VIEW`.
 * Lead scoring is set here too (M4-11): each entry's starting points, and the
 * workspace's decay.
 */
export default async function LeadSourcesPage() {
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['settings', 'VIEW'] });
  const seesLeads = can(ctx, 'leads', 'VIEW');
  const [entries, counted, decay] = await Promise.all([
    listLeadSources(prisma, ctx.tenantId),
    seesLeads
      ? prisma.lead.groupBy({
          by: ['sourceId'],
          where: {
            ...(await leadScope(ctx, 'VIEW', { includeUnassigned: true })),
            deletedAt: null,
            sourceId: { not: null },
          },
          _count: { _all: true },
        })
      : [],
    decayRule(prisma, ctx.tenantId),
  ]);
  const leads = new Map(counted.map((row) => [row.sourceId, row._count._all]));

  return (
    <>
      <ListHeader
        title="Lead sources"
        description="Where leads come from: each source and its sub-sources, offered on the lead form and used by the source reports."
        help={
          <p>
            An entry that is no longer offered stays on the leads that carry it and in the reports. An enquiry from a
            connected portal lands on the entry for that portal.
          </p>
        }
      />
      <SourceEditor
        canEdit={can(ctx, 'settings', 'MANAGE_CONFIGURATION')}
        entries={entries.map((entry) => ({ ...entry, leads: seesLeads ? (leads.get(entry.id) ?? 0) : null }))}
      />
      <ScoreDecay canEdit={can(ctx, 'settings', 'MANAGE_CONFIGURATION')} decay={decay} />
    </>
  );
}
