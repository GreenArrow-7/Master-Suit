import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import Badge from '@/components/ui/Badge';
import type { WorkspaceRow } from '@/services/ai/console';
import { STATUS_LABEL, STATUS_TONE, UsageBar, nf, money, ago } from '../ui';

/**
 * Every company's AI consumption on one screen, heaviest first.
 *
 * The columns are the questions an operator actually arrives with: is anyone
 * near their ceiling, what is it costing, who is the heaviest person, and which
 * feature is doing it. The name opens the company.
 */
export default function WorkspacesView({ rows, since }: { rows: WorkspaceRow[]; since: string }) {
  const month = new Date(since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="AI Control Center"
        title="AI usage by workspace"
        description={`Counted from every AI request made since the start of ${month}, UTC.`}
        breadcrumbs={[
          { label: 'Platform', href: '/platform' },
          { label: 'AI Control Center', href: '/platform/ai-control' },
          { label: 'Workspaces' },
        ]}
      />

      {rows.length === 0 ? (
        <section className="lf-card" style={{ padding: 18 }}>
          <p className="lf-muted" style={{ margin: 0 }}>
            No workspace has made an AI request this month, and none has a budget set.
          </p>
        </section>
      ) : (
        <section className="lf-card" style={{ padding: 18 }}>
          <WorkspaceTable
            headers={[
              'Workspace',
              'Plan',
              'Allowance',
              'Used',
              'Remaining',
              'Usage',
              'Status',
              'In / out',
              'Cost',
              'AI users',
              'Heaviest user',
              'Most-used feature',
              'Model',
              'Fell back',
              'Last activity',
            ]}
            rows={rows.map((r) => [
              <Link key={r.tenantId} href={`/platform/ai-control/workspaces/${r.tenantId}`}>
                {r.name}
              </Link>,
              r.planName ?? '—',
              r.tokenLimit === null ? 'not set' : nf(r.tokenLimit),
              nf(r.usedTokens),
              r.remaining === null ? '—' : nf(r.remaining),
              <UsageBar key={`u-${r.tenantId}`} percent={r.percent} />,
              <Badge key={`s-${r.tenantId}`} tone={STATUS_TONE[r.status]}>
                {STATUS_LABEL[r.status]}
              </Badge>,
              `${nf(r.inputTokens)} / ${nf(r.outputTokens)}`,
              money(r.amount),
              nf(r.activeUsers),
              r.topUser ? `${r.topUser.name} · ${nf(r.topUser.tokens)}` : '—',
              r.topFeature ? `${r.topFeature.label} · ${nf(r.topFeature.tokens)}` : '—',
              r.topModel ? `${r.topModel.model}` : '—',
              nf(r.fallbacks),
              ago(r.lastActivityAt),
            ])}
          />
        </section>
      )}
    </div>
  );
}
