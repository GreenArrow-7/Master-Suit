import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';

export const metadata = { title: 'Request a visit' };

/**
 * Requesting a visit, not booking one.
 *
 * `status` is absent from the form because it is absent from the API: everything
 * starts REQUESTED and a leader decides. A form that let an agent create an
 * approved visit would make the register a diary.
 */
export default async function NewSiteVisitPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['visits', 'CREATE'] });

  // Booking a visit needs `visits:CREATE`; listing leads to pick from needs
  // `leads:VIEW`. They are separate grants, and `visibilityWhere` throws
  // Forbidden on a NONE scope — so unguarded, a role holding the first without
  // the second was refused the page instead of offered a shorter form.
  const canReadLeads = can(ctx, 'leads', 'VIEW');

  const [leads, projects, listings] = await Promise.all([
    canReadLeads
      ? visibilityWhere(ctx, 'leads', 'VIEW').then((scope) =>
          prisma.lead.findMany({
            where: { ...scope, deletedAt: null },
            select: { id: true, fullName: true, phone: true },
            orderBy: { updatedAt: 'desc' },
            take: 200,
          }),
        )
      : Promise.resolve([]),
    prisma.project.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, isPitchable: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 300,
    }),
    prisma.listing.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, status: { in: ['ACTIVE', 'UNDER_OFFER'] } },
      select: { id: true, reference: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  ]);

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          Request a visit
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          A leader approves it before you go. Check in at the property on the day — the location is measured against the
          property, not taken on trust.
        </p>
      </header>

      <WorkspaceRecordForm
        endpoint="/api/v1/site-visits"
        submitLabel="Request"
        fields={[
          {
            name: 'kind',
            label: 'Kind',
            type: 'select',
            required: true,
            options: [
              { value: 'PROPERTY_VISIT', label: 'Property visit' },
              { value: 'CLIENT_MEETING', label: 'Client meeting' },
            ],
          },
          {
            name: 'leadId',
            label: 'Client',
            type: 'select',
            required: true,
            options: leads.map((l) => ({ value: l.id, label: l.phone ? `${l.fullName} · ${l.phone}` : l.fullName })),
          },
          {
            name: 'projectId',
            label: 'Project',
            type: 'select',
            options: projects.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            name: 'listingId',
            label: 'Listing',
            type: 'select',
            options: listings.map((l) => ({ value: l.id, label: `${l.reference} · ${l.title}` })),
          },
          { name: 'scheduledAt', label: 'When', type: 'datetime-local', required: true },
          { name: 'durationMin', label: 'Minutes', type: 'number' },
          {
            name: 'address',
            label: 'Address',
            placeholder: 'For a meeting somewhere that is not on the books',
          },
          { name: 'notes', label: 'Notes' },
        ]}
      />
    </>
  );
}
