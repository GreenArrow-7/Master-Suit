import { forbidden, notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { applyFieldSecurity, loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { assertMayMerge, MERGE_FIELDS, type MergeField } from '@/services/leads/merge';
import SalesLink from '@/components/workspace/SalesLink';
import MergeForm from './MergeForm';

export const metadata = { title: 'Merge leads' };

const LABELS: Record<MergeField, string> = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  company: 'Company',
  jobTitle: 'Job title',
  city: 'City',
  country: 'Country',
  nationality: 'Nationality',
  campaignName: 'Campaign',
  notes: 'Notes',
};

/**
 * The compare screen (M4-31): this lead and the one in `?with=` side by side,
 * a choice of value wherever they differ, then the merge. Reached from the
 * duplicate notice on the lead page and from Merge with two leads selected in
 * the grid. Both must be in the viewer's EDIT scope, as the merge requires.
 */
export default async function MergeLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ with?: string }>;
}) {
  const [{ id }, { with: otherId }] = await Promise.all([params, searchParams]);
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'EDIT'] });
  if (!otherId || otherId === id) notFound();
  const refused = (err: unknown): never => {
    if (err instanceof AppError && err.status === 404) notFound();
    if (err instanceof AppError && err.status === 403) forbidden();
    throw err;
  };
  const load = (leadId: string) => assertLeadInScope(ctx, leadId, prisma, 'EDIT').catch(refused);
  const [kept, other] = await Promise.all([load(id), load(otherId)]);
  // The merge's own rule (owners, unassigned leads), so the screen never offers one it refuses.
  await assertMayMerge(ctx, prisma, kept, other).catch(refused);

  const [rules, held] = await Promise.all([
    loadFieldRules(ctx, 'LEAD'),
    prisma.lead.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, id: other.id },
      select: {
        _count: { select: { activities: true, tasks: true, followUpTasks: true, documents: true, phones: true } },
      },
    }),
  ]);
  const shown = (lead: typeof kept) =>
    applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS) as Record<string, unknown>;
  const [a, b] = [shown(kept), shown(other)];
  const text = (value: unknown) => (value == null ? '' : String(value));
  const fields = MERGE_FIELDS.map((key) => ({
    key,
    label: LABELS[key],
    kept: text(a[key]),
    other: text(b[key]),
    // What the merge route takes: a value this role may write and sees whole.
    choosable: rules.get(key)?.canEdit !== false && seesField(ctx, 'LEAD', rules, key, LEAD_SENSITIVE_FIELDS),
  })).filter((field) => field.kept || field.other);
  const n = held._count;
  const moves = [
    [n.activities, 'activity', 'activities'],
    [n.tasks, 'task', 'tasks'],
    [n.followUpTasks, 'follow-up', 'follow-ups'],
    [n.documents, 'document', 'documents'],
    [n.phones, 'other number', 'other numbers'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

  return (
    <div style={{ maxWidth: 760 }}>
      <SalesLink href={`/leads/${kept.id}`} style={{ fontSize: 'var(--lf-text-sm)' }}>
        &larr; {kept.reference}
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-2)' }}>
        Merge {other.reference} into {kept.reference}
      </h1>
      <p style={{ margin: '0 0 var(--lf-space-4)', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
        {kept.reference} keeps its reference, stage and owner. Everything on {other.reference}
        {moves.length ? ` (${moves.join(', ')})` : ''} moves to it, with its timeline, calls and history, and{' '}
        {other.reference} then opens as merged into {kept.reference}.{' '}
        <SalesLink href={`/leads/${other.id}/merge?with=${kept.id}`}>Keep {other.reference} instead</SalesLink>
      </p>
      <MergeForm
        keptId={kept.id}
        otherId={other.id}
        keptRef={kept.reference}
        otherRef={other.reference}
        fields={fields}
      />
    </div>
  );
}
