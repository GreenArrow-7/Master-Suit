import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import OpportunityForm from './OpportunityForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add opportunity' };

export default async function NewOpportunityPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  if (!can(ctx, 'opportunities', 'CREATE')) redirect('/opportunities');

  const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
  const accounts = await prisma.account.findMany({
    where: scope, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true },
  });

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/opportunities" style={{ fontSize: 'var(--lf-text-sm)' }}>← Opportunities</SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>Add opportunity</h1>
      <OpportunityForm accounts={accounts} />
    </div>
  );
}
