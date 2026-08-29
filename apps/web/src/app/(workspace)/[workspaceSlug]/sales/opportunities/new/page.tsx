import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import OpportunityForm from './OpportunityForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add opportunity' };

export default async function NewOpportunityPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['opportunities', 'CREATE'] });
  if (!can(ctx, 'opportunities', 'CREATE')) redirect('/opportunities');

  // Permission to create an opportunity is not permission to browse accounts,
  // and `visibilityWhere` throws Forbidden on a NONE scope. Unguarded, that
  // refused the whole page to a role holding `opportunities:CREATE` without
  // `accounts:VIEW` — a missing picker presented as a missing page.
  const accounts = can(ctx, 'accounts', 'VIEW')
    ? await prisma.account.findMany({
        where: await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true }),
        orderBy: { name: 'asc' },
        take: 200,
        select: { id: true, name: true },
      })
    : [];

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/opportunities" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Opportunities
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Add opportunity
      </h1>
      <OpportunityForm accounts={accounts} />
    </div>
  );
}
