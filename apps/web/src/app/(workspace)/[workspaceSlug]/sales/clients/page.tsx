import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { completeness } from '@/services/clients/profile';
import { referrerScoreboard } from '@/services/clients/referrals';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Clients' };

const TONE: Record<string, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  REQUESTED: 'slate',
  SUBMITTED: 'brass',
  APPROVED: 'brass',
  PUBLISHED: 'viridian',
  DECLINED: 'vermillion',
  PENDING: 'slate',
  QUALIFIED: 'brass',
  CONVERTED: 'viridian',
  REJECTED: 'vermillion',
};

/**
 * Who your clients are, what they said, and who they sent.
 *
 * One page with three tabs rather than three pages, because they are three
 * views of the same relationship and an agent opening "clients" is asking about
 * the person, not the table.
 */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['clientprofiles', 'VIEW'] });
  const view = params.view === 'testimonials' || params.view === 'referrals' ? params.view : 'profiles';

  const [profiles, testimonials, referrals, scoreboard] = await Promise.all([
    prisma.clientProfile.findMany({
      where: { ...(await visibilityWhere(ctx, 'clientprofiles', 'VIEW')), deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    can(ctx, 'testimonials', 'VIEW')
      ? prisma.testimonial.findMany({
          where: { ...(await visibilityWhere(ctx, 'testimonials', 'VIEW')), deletedAt: null },
          orderBy: { requestedAt: 'desc' },
          take: 100,
        })
      : [],
    can(ctx, 'referrals', 'VIEW')
      ? prisma.referral.findMany({
          where: {
            tenantId: ctx.tenantId,
            deletedAt: null,
            code: { is: await visibilityWhere(ctx, 'referrals', 'VIEW') },
          },
          include: { code: { select: { code: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : [],
    can(ctx, 'referrals', 'VIEW') ? referrerScoreboard(ctx.tenantId, 5) : [],
  ]);

  const awaitingReview = testimonials.filter((t) => t.status === 'SUBMITTED').length;

  return (
    <>
      <ListHeader
        title="Clients"
        description={
          <>
            {profiles.length} profile{profiles.length === 1 ? '' : 's'}
            {awaitingReview > 0 && (
              <>
                {' · '}
                <SalesLink href="/clients?view=testimonials" style={{ color: 'var(--lf-brass)' }}>
                  {awaitingReview} testimonial{awaitingReview === 1 ? '' : 's'} to review
                </SalesLink>
              </>
            )}
          </>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        {(
          [
            ['Profiles', 'profiles'],
            ['Testimonials', 'testimonials'],
            ['Referrals', 'referrals'],
          ] as const
        ).map(([label, key]) => (
          <SalesLink
            key={key}
            className="lf-tab"
            href={key === 'profiles' ? '/clients' : `/clients?view=${key}`}
            aria-selected={view === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {view === 'profiles' &&
        (profiles.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="No profiles yet"
              description="A profile is filled in over several conversations, so it saves a step at a time. Start one from a lead."
            />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Profession</th>
                  <th>Intent</th>
                  <th style={{ textAlign: 'right' }}>Capacity</th>
                  <th>Languages</th>
                  <th style={{ textAlign: 'right' }}>Complete</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const state = completeness(p as unknown as Record<string, unknown>);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>
                        {p.leadId ? <SalesLink href={`/leads/${p.leadId}`}>Lead</SalesLink> : 'Contact'}
                      </td>
                      <td>{p.profession ?? '—'}</td>
                      <td>
                        <Badge value={p.purchaseIntent} tone={p.purchaseIntent === 'UNDECIDED' ? 'slate' : 'brass'} />
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {p.investmentCapacity
                          ? `${p.currency} ${Number(p.investmentCapacity.toString()).toLocaleString('en-GB')}`
                          : '—'}
                      </td>
                      <td>{p.languages.length > 0 ? p.languages.join(', ') : '—'}</td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {/* Derived from what is answered, so it cannot claim a
                            profile is finished when a step is blank. */}
                        {state.percent}%{state.nextStep && <span className="lf-hint"> next: {state.nextStep}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {view === 'testimonials' &&
        (testimonials.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="Nothing asked for yet"
              description="Ask a client for a testimonial and they get a link to write it themselves. Nobody here can write it for them."
            />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Asked</th>
                  <th style={{ textAlign: 'right' }}>Rating</th>
                  <th>What they said</th>
                  <th>Publishable</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {testimonials.map((t) => (
                  <tr key={t.id}>
                    <td>{t.requestedAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {t.rating ? `${t.rating}/5` : '—'}
                    </td>
                    <td style={{ maxWidth: 420 }}>{t.body ?? <span className="lf-hint">not written yet</span>}</td>
                    <td>
                      {/* Their tick, from the public form. Never set here. */}
                      {t.body ? (
                        <Badge
                          value={t.consentToPublish ? 'CONSENTED' : 'PRIVATE'}
                          tone={t.consentToPublish ? 'viridian' : 'slate'}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Badge value={t.status} tone={TONE[t.status] ?? 'slate'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === 'referrals' && (
        <>
          {scoreboard.length > 0 && (
            <div className="lf-card" style={{ marginBottom: 'var(--lf-space-4)' }}>
              <strong>Who actually sends business</strong>
              <ul style={{ margin: 'var(--lf-space-2) 0 0', paddingLeft: '1.2em' }}>
                {scoreboard.map((r) => (
                  <li key={`${r.referrerLeadId}:${r.referrerContactId}`}>
                    {r.counts.CONVERTED} converted of {r.total} introduced
                  </li>
                ))}
              </ul>
            </div>
          )}

          {referrals.length === 0 ? (
            <div className="lf-card">
              <EmptyState
                title="No referrals yet"
                description="Issue a client a code. When somebody arrives with it, the introduction is credited to them."
              />
            </div>
          ) : (
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Arrived</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 500, fontFamily: 'var(--lf-font-mono, monospace)' }}>{r.code.code}</td>
                      <td>{r.createdAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
                      <td>
                        <Badge value={r.status} tone={TONE[r.status] ?? 'slate'} />
                      </td>
                      <td>{r.notes ?? r.rejectReason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
