import { notFound } from 'next/navigation';
import { prisma, withTx } from '@/lib/db';
import { agencyOf } from '@/lib/proposals/publicProposal';
import { assertAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
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
 * switched-off link is a 404, which discloses nothing. It wears the workspace's
 * logo and brand colour (Administration → Company, M18-09), as `/p` and `/s` do.
 */
export default async function CapturePage({ params }: { params: Promise<{ workspaceSlug: string; key: string }> }) {
  const { workspaceSlug, key } = await params;

  const tenant = await prisma.tenant.findFirst({
    where: { slug: workspaceSlug, status: 'ACTIVE', deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!tenant) notFound();
  // A workspace whose lead modules have lapsed collects no leads: its form is gone, as the API says.
  await assertAnyModuleEntitlement(tenant.id, LEAD_MODULES).catch(() => notFound());
  const link = await prisma.captureLink.findFirst({
    where: { tenantId: tenant.id, key, isActive: true },
    select: { id: true, headline: true },
  });
  if (!link) notFound();
  // Opened, beside completed: the gap between them is what a stand learns from.
  await prisma.captureLink
    .update({ where: { tenantId: tenant.id, id: link.id }, data: { openCount: { increment: 1 } } })
    .catch(() => {});
  const agency = await withTx(tenant.id, (tx) => agencyOf(tx, tenant.id));

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--lf-space-5)',
        background: 'var(--lf-surface-2)',
        ['--agency' as string]: agency.primaryColor,
      }}
    >
      <div
        className="lf-card"
        style={{ width: 'min(460px, 100%)', padding: 'var(--lf-space-6)', borderTop: '4px solid var(--agency)' }}
      >
        <div style={{ marginBottom: 'var(--lf-space-3)' }}>
          {agency.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant's own logo URL, not a bundled asset
            <img
              src={agency.logoUrl}
              alt={tenant.displayName}
              style={{ height: 36, width: 'auto', maxWidth: '100%' }}
            />
          ) : (
            // The ink colour, not the brand's: a dark brand on the dark theme would not read.
            <strong>{tenant.displayName}</strong>
          )}
        </div>
        <h1 className="lf-h1" style={{ marginBottom: 'var(--lf-space-4)' }}>
          {link.headline ?? 'Leave your details and we will call you'}
        </h1>
        <LeadForm workspace={workspaceSlug} formKey={key} fields={FIELDS} endpoint="/api/v1/public/capture" />
      </div>
    </main>
  );
}
