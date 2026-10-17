import { redirect } from 'next/navigation';
import { withTx } from '@/lib/db';
import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { leadFormLayout } from '@/lib/leads/formLayout';
import { listLeadSources } from '@/services/leads/leadSources';
import { fieldForScreen, leadFields } from '@/services/leads/customFields';
import LeadForm from './LeadForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add lead' };

export default async function NewLeadPage() {
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'CREATE'] });
  if (!can(ctx, 'leads', 'CREATE')) redirect('/leads');
  // The catalogue's offered entries (Administration → Settings → Sources), the
  // workspace's custom fields and its form layout (Custom Fields), on one connection.
  const [sources, fields, setting] = await withTx(ctx.tenantId, (tx) =>
    Promise.all([
      listLeadSources(tx, ctx.tenantId),
      leadFields(tx, ctx.tenantId, { activeOnly: true }),
      tx.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { leadFormLayout: true } }),
    ]),
  );

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/leads" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Leads
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Add lead
      </h1>
      <LeadForm
        sources={sources.filter((source) => source.isActive)}
        layout={leadFormLayout(setting?.leadFormLayout).filter((field) => !field.hidden)}
        customFields={fields.map(fieldForScreen)}
      />
    </div>
  );
}
