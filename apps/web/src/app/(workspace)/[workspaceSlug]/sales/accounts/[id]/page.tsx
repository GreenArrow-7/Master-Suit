import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import EntityDelete from '@/components/sales/EntityDelete';

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['accounts', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
  const account = await prisma.account.findFirst({
    where: { ...scope, id },
    include: {
      owner: { select: { fullName: true, email: true } },
      contacts: {
        where: { deletedAt: null },
        take: 10,
        select: { id: true, fullName: true, jobTitle: true, email: true },
      },
      opportunities: {
        where: { deletedAt: null },
        take: 10,
        select: { id: true, name: true, status: true, amount: true, currency: true },
      },
    },
  });
  if (!account) notFound();

  const rules = await loadFieldRules(ctx, 'ACCOUNT');
  const safe = applyFieldSecurity(ctx, 'ACCOUNT', rules, account) as typeof account;

  return (
    <>
      <SalesLink href="/accounts" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Accounts
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
          {account.name
            .split(' ')
            .slice(0, 2)
            .map((p) => p[0])
            .join('')}
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            {account.name}
          </h1>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginTop: 4, flexWrap: 'wrap' }}
          >
            <span className="lf-num" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              {account.reference}
            </span>
            <Badge value={account.status} />
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
              {account.owner?.fullName ?? <em style={{ color: 'var(--lf-wine-700)' }}>Unassigned</em>}
            </span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--lf-space-2)' }}>
          {can(ctx, 'accounts', 'EDIT') && (
            <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={`/accounts/${account.id}/edit`}>
              Edit
            </SalesLink>
          )}
          {can(ctx, 'accounts', 'DELETE') && (
            <EntityDelete endpoint={`/api/v1/accounts/${account.id}`} backHref="/accounts" label="account" />
          )}
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)',
          gap: 'var(--lf-space-4)',
          alignItems: 'start',
        }}
      >
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
            Details
          </div>
          <dl style={{ display: 'grid', gap: 'var(--lf-space-3)', margin: 0 }}>
            {(
              [
                ['Industry', account.industry ?? '—'],
                ['Type', account.accountType ?? '—'],
                ['Phone', safe.mainPhone ?? '—'],
                ['Email', safe.mainEmail ?? '—'],
                ['Website', account.website ?? '—'],
                ['Tier', account.customerTier ?? '—'],
                [
                  'Created',
                  account.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="lf-label">{label}</dt>
                <dd style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', wordBreak: 'break-word' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
              Contacts
            </div>
            {account.contacts.length === 0 ? (
              <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', margin: 0 }}>
                No contacts linked yet.
              </p>
            ) : (
              account.contacts.map((c) => (
                <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--lf-line)' }}>
                  <SalesLink href={`/contacts/${c.id}`} style={{ fontWeight: 500 }}>
                    {c.fullName}
                  </SalesLink>
                  <span style={{ marginLeft: 8, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
                    {c.jobTitle}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
              Opportunities
            </div>
            {account.opportunities.length === 0 ? (
              <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', margin: 0 }}>
                No opportunities linked yet.
              </p>
            ) : (
              account.opportunities.map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid var(--lf-line)',
                  }}
                >
                  <SalesLink href={`/opportunities/${o.id}`} style={{ fontWeight: 500 }}>
                    {o.name}
                  </SalesLink>
                  <Badge value={o.status} />
                  <span
                    style={{ marginLeft: 'auto', fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-sm)' }}
                  >
                    {o.currency} {Number(o.amount).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </>
  );
}
