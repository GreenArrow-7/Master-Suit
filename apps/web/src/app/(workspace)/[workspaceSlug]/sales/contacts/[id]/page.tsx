import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['contacts', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true });
  const contact = await prisma.contact.findFirst({
    where: { ...scope, id },
    include: {
      account: { select: { id: true, name: true } },
      owner: { select: { fullName: true, email: true } },
    },
  });
  if (!contact) notFound();

  const rules = await loadFieldRules(ctx, 'CONTACT');
  const safe = applyFieldSecurity(ctx, 'CONTACT', rules, contact) as typeof contact;

  return (
    <>
      <SalesLink href="/contacts" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Contacts
      </SalesLink>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--lf-space-4)',
          margin: 'var(--lf-space-3) 0 var(--lf-space-4)',
        }}
      >
        <span className="lf-avatar" style={{ width: 44, height: 44, fontSize: 'var(--lf-text-base)' }}>
          {contact.fullName
            .split(' ')
            .slice(0, 2)
            .map((p) => p[0])
            .join('')}
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            {contact.fullName}
          </h1>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginTop: 4, flexWrap: 'wrap' }}
          >
            <span className="lf-num" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              {contact.reference}
            </span>
            {contact.account && <SalesLink href={`/accounts/${contact.account.id}`}>{contact.account.name}</SalesLink>}
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
              {contact.owner?.fullName ?? <em style={{ color: 'var(--lf-wine-700)' }}>Unassigned</em>}
            </span>
          </div>
        </div>
      </header>

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', maxWidth: 420 }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
          Details
        </div>
        <dl style={{ display: 'grid', gap: 'var(--lf-space-3)', margin: 0 }}>
          {(
            [
              ['Job title', contact.jobTitle ?? '—'],
              ['Department', contact.department ?? '—'],
              ['Email', safe.email ?? '—'],
              ['Phone', safe.phone ?? '—'],
              ['Consent', contact.consentStatus.toLowerCase()],
              [
                'Created',
                contact.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="lf-label">{label}</dt>
              <dd style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', wordBreak: 'break-word' }}>
                {label === 'Consent' ? <Badge value={value} /> : value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
