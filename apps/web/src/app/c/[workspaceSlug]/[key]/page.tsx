import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import LeadForm from '../../../f/[workspaceSlug]/[formKey]/LeadForm';

export const metadata = { title: 'Get in touch' };

const FIELDS = [
  { key: 'name', label: 'Your name', type: 'TEXT', isRequired: true, placeholder: null },
  { key: 'phone', label: 'Mobile number', type: 'PHONE', isRequired: true, placeholder: null },
  { key: 'email', label: 'Email', type: 'EMAIL', isRequired: false, placeholder: null },
  { key: 'message', label: 'What are you looking for?', type: 'LONG_TEXT', isRequired: false, placeholder: null },
];

/**
 * A QR capture link's page: the short form behind a code on a stand, a flyer or
 * a sign board. Outside every route group, like `/f`: no session, no sidebar. A
 * switched-off link is a 404, which discloses nothing.
 */
export default async function CapturePage({ params }: { params: Promise<{ workspaceSlug: string; key: string }> }) {
  const { workspaceSlug, key } = await params;

  const tenant = await prisma.tenant.findFirst({
    where: { slug: workspaceSlug, status: 'ACTIVE', deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!tenant) notFound();
  const link = await prisma.captureLink.findFirst({
    where: { tenantId: tenant.id, key, isActive: true },
    select: { id: true, headline: true },
  });
  if (!link) notFound();
  // Opened, beside completed: the gap between them is what a stand learns from.
  await prisma.captureLink
    .update({ where: { tenantId: tenant.id, id: link.id }, data: { openCount: { increment: 1 } } })
    .catch(() => {});

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
          {link.headline ?? 'Leave your details and we will call you'}
        </h1>
        <LeadForm workspace={workspaceSlug} formKey={key} fields={FIELDS} endpoint="/api/v1/public/capture" />
      </div>
    </main>
  );
}
