import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import EmptyState from '@/components/ui/EmptyState';
import QrCode from '@/components/ui/QrCode';
import CaptureLinkForm, { LinkSwitch } from './CaptureLinkForm';

export const metadata = { title: 'QR capture' };

/**
 * QR capture links (Lead Eagle plan, gap 4): a short public form behind a QR
 * code on a stand, a flyer or a sign board. Whoever fills it in becomes a lead
 * credited to the link's agent and campaign, through the same intake the
 * portals use.
 */
export default async function CaptureLinksPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });
  const [links, agents] = await Promise.all([
    prisma.captureLink.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { owner: { select: { fullName: true } } },
    }),
    prisma.user.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);
  const base = env.APP_URL.replace(/\/$/, '');
  const canEdit = can(ctx, 'leads', 'EDIT');

  return (
    <>
      <ListHeader
        title="QR capture"
        description="A short form behind a QR code. Whoever fills it in becomes a lead, credited to the agent you choose."
      />
      {can(ctx, 'leads', 'CREATE') && <CaptureLinkForm agents={agents} />}
      {links.length === 0 ? (
        <EmptyState title="No QR codes yet" description="Make one for a stand, a flyer or a sign board." />
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--lf-space-3)',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
            marginTop: 'var(--lf-space-4)',
          }}
        >
          {links.map((link) => {
            const url = `${base}/c/${workspaceSlug}/${link.key}`;
            return (
              <section
                key={link.id}
                className="lf-card"
                aria-label={link.label}
                style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 8, opacity: link.isActive ? 1 : 0.6 }}
              >
                <strong>{link.label}</strong>
                <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
                  {link.owner?.fullName ?? 'Assigned by distribution'}
                  {link.campaign ? ` · ${link.campaign}` : ''}
                </div>
                <QrCode value={url} size={180} label={`QR code for ${link.label}`} />
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 'var(--lf-text-xs)', overflowWrap: 'anywhere' }}
                >
                  {url}
                </a>
                <div style={{ fontSize: 'var(--lf-text-sm)' }}>
                  {link.openCount} opened · {link.submitCount} sent
                </div>
                {canEdit && <LinkSwitch id={link.id} active={link.isActive} />}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
