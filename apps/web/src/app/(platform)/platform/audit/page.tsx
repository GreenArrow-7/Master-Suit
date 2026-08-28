import Link from 'next/link';
import { prisma } from '@/lib/db';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';

export const metadata = { title: 'Platform audit' };

/**
 * The protected side of the audit split.
 *
 * The customer's own log (admin/audit) shows *that* an automated platform
 * service read their workspace. This shows the rest of it: which credential,
 * which upstream job declared itself as the initiator, the correlation id, the
 * status the request ended with. That detail is platform-internal — it is about
 * this company's machines, not about the customer's records — and it is only
 * useful to whoever is answering "what has this service been doing".
 *
 * Reachable only through the (platform) layout, which is behind
 * requirePlatformOwner.
 */

/** Unverified: a header the calling system set. Never treat it as attribution. */
type ServiceMeta = { credentialId?: string; declaredInitiator?: string | null; action?: string; path?: string };

export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event } = await searchParams;
  const rows = await prisma.platformAuditEvent.findMany({
    take: 250,
    orderBy: { occurredAt: 'desc' },
    where: event === 'service' ? { event: 'SERVICE_READ' } : {},
    // Narrowed from `include: { actor: true }`, which pulled every column on
    // PlatformUser — password hash, TOTP secret, recovery codes — into a page
    // that renders one of them.
    select: {
      id: true,
      event: true,
      objectType: true,
      objectId: true,
      metadata: true,
      requestId: true,
      ipAddress: true,
      occurredAt: true,
      tenant: { select: { displayName: true } },
      actor: { select: { email: true, fullName: true, platformRole: true } },
    },
  });

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1>Platform audit</h1>
      <nav style={{ display: 'flex', gap: 10 }}>
        <Link className="lf-button lf-button--ghost" href="/platform/audit">
          All events
        </Link>
        <Link className="lf-button lf-button--ghost" href="/platform/audit?event=service">
          Service reads
        </Link>
      </nav>
      <WorkspaceTable
        headers={['Event', 'Workspace', 'Actor', 'Object', 'Detail', 'Request', 'Time']}
        searchPlaceholder="Search by workspace, actor, credential or request id…"
        rows={rows.map((r) => {
          const meta = (r.metadata ?? {}) as ServiceMeta;
          const service = r.event === 'SERVICE_READ';
          return [
            r.event,
            r.tenant?.displayName ?? 'Global',
            // A service identity is a machine; naming the role alongside it
            // stops it reading as a colleague in this list too.
            service ? `${r.actor?.email ?? 'service'} (AI_SERVICE)` : (r.actor?.email ?? 'System'),
            `${r.objectType ?? '—'} ${r.objectId ?? ''}`,
            service
              ? [
                  meta.action,
                  meta.path,
                  meta.credentialId ? `cred ${meta.credentialId.slice(0, 10)}` : null,
                  meta.declaredInitiator ? `declared: ${meta.declaredInitiator}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '—',
            r.requestId ?? '—',
            r.occurredAt.toLocaleString('en-AE'),
          ];
        })}
      />
    </div>
  );
}
