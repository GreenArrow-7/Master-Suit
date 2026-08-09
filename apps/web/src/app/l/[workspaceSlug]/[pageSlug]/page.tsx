import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import LeadForm from '../../../f/[workspaceSlug]/[formKey]/LeadForm';

/**
 * A published landing page — the link a campaign shares. Outside every route
 * group: no session, no sidebar. Only PUBLISHED pages of an active workspace
 * resolve. The embedded form, when present, submits through the same public
 * form pipeline, so a landing-page lead is a lead like any other.
 */
export default async function PublicLandingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; pageSlug: string }>;
}) {
  const { workspaceSlug, pageSlug } = await params;

  const tenant = await prisma.tenant.findFirst({
    where: { slug: workspaceSlug, status: 'ACTIVE', deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!tenant) notFound();

  const page = await prisma.landingPage.findFirst({
    where: { tenantId: tenant.id, slug: pageSlug, state: 'PUBLISHED', deletedAt: null },
    select: { id: true, name: true, blocks: true, formId: true },
  });
  if (!page) notFound();

  const form = page.formId
    ? await prisma.form.findFirst({
        where: { tenantId: tenant.id, id: page.formId, state: 'PUBLISHED', isPublic: true, deletedAt: null },
        include: { fields: { orderBy: { position: 'asc' } } },
      })
    : null;

  // Fire-and-forget visit counter; a lost increment is not worth a failed view.
  prisma.landingPage
    .update({ where: { id: page.id, tenantId: tenant.id }, data: { visitCount: { increment: 1 } } })
    .catch(() => {});

  const blocks = (page.blocks as { type: string; text?: string }[]) ?? [];
  const headline = blocks.find((b) => b.type === 'headline')?.text ?? page.name;
  const body = blocks.find((b) => b.type === 'body')?.text;

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
      <div style={{ width: 'min(620px, 100%)', display: 'grid', gap: 'var(--lf-space-5)' }}>
        <header>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
            {tenant.displayName}
          </div>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-3xl, 2rem)', marginBottom: 'var(--lf-space-3)' }}>
            {headline}
          </h1>
          {body && (
            <p style={{ margin: 0, fontSize: 'var(--lf-text-base)', color: 'var(--lf-ink-2)', whiteSpace: 'pre-wrap' }}>
              {body}
            </p>
          )}
        </header>

        {form && (
          <div className="lf-card" style={{ padding: 'var(--lf-space-6)' }}>
            <h2 style={{ margin: '0 0 var(--lf-space-4)', fontSize: 'var(--lf-text-lg)' }}>{form.name}</h2>
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
        )}
      </div>
    </main>
  );
}
