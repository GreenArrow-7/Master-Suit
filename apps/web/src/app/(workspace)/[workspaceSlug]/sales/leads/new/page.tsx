import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import LeadForm from './LeadForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add lead' };

export default async function NewLeadPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'CREATE'] });
  if (!can(ctx, 'leads', 'CREATE')) redirect('/leads');

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/leads" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Leads
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Add lead
      </h1>
      <LeadForm />
    </div>
  );
}
