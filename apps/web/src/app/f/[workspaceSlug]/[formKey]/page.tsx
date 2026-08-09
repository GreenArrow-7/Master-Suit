import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import LeadForm from './LeadForm';

export const metadata = { title: 'Get in touch' };

/**
 * The public face of a lead-capture form — the link a campaign, ad or QR code
 * points at. Outside every route group on purpose: no session, no sidebar.
 * Only PUBLISHED public forms of an active workspace resolve; everything else
 * is a 404, which discloses nothing.
 */
export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; formKey: string }>;
}) {
  const { workspaceSlug, formKey } = await params;

  const tenant = await prisma.tenant.findFirst({
    where: { slug: workspaceSlug, status: 'ACTIVE', deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!tenant) notFound();

  const form = await prisma.form.findFirst({
    where: { tenantId: tenant.id, key: formKey, state: 'PUBLISHED', isPublic: true, deletedAt: null },
    include: { fields: { orderBy: { position: 'asc' } } },
  });
  if (!form) notFound();

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--lf-space-5)',
        background: 'var(--lf-surface-2)',
      }}
    >
      <div className="lf-card" style={{ width: 'min(460px, 100%)', padding: 'var(--lf-space-6)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
          {tenant.displayName}
        </div>
        <h1 className="lf-h1" style={{ marginBottom: 'var(--lf-space-4)' }}>
          {form.name}
        </h1>
        <LeadForm
          workspace={workspaceSlug}
          formKey={form.key}
          fields={form.fields.map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            isRequired: field.isRequired,
            placeholder: field.placeholder,
          }))}
        />
      </div>
    </main>
  );
}
