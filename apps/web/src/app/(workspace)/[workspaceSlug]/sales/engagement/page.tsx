import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { feed } from '@/services/engagement/feed';
import { leaderboard } from '@/services/engagement/contests';
import { results } from '@/services/engagement/nominations';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';
import FeedComposer, { Reactions } from './FeedComposer';

export const metadata = { title: 'Engagement' };

const TABS = [
  ['Feed', ''],
  ['Contests', 'contests'],
  ['Awards', 'awards'],
] as const;

/**
 * The internal side of the workspace: what people are saying, who is winning,
 * and who is up for an award.
 *
 * The awards tab reads whichever event has nominations on it rather than asking
 * the reader to pick one — an offsite is a rare enough thing that hunting for
 * it through a list would be the whole interaction.
 */
export default async function EngagementPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['posts', 'VIEW'] });
  const view = TABS.some(([, k]) => k === params.view) ? (params.view ?? '') : '';

  const canPost = can(ctx, 'posts', 'CREATE');
  const canModerate = can(ctx, 'posts', 'DELETE');
  const canSeeContests = can(ctx, 'contests', 'VIEW');

  const posts = view === '' ? await feed(ctx, { limit: 50 }) : [];

  const contests =
    view === 'contests' && canSeeContests
      ? await prisma.contest.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null },
          orderBy: [{ status: 'asc' }, { endAt: 'desc' }],
          take: 20,
        })
      : [];
  const boards = await Promise.all(contests.map((c) => leaderboard(ctx.tenantId, c.id)));

  // The most recent event anybody has been nominated for.
  const awardEvent =
    view === 'awards' && canSeeContests
      ? await prisma.nomination.findFirst({
          where: { tenantId: ctx.tenantId, deletedAt: null },
          select: { eventId: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;
  const categories = awardEvent ? await results(ctx, awardEvent.eventId) : [];
  const event = awardEvent
    ? await prisma.event.findFirst({
        where: { id: awardEvent.eventId, tenantId: ctx.tenantId },
        select: { title: true },
      })
    : null;

  return (
    <>
      <ListHeader
        title="Engagement"
        description={view === '' ? `${posts.length} post${posts.length === 1 ? '' : 's'}` : undefined}
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/engagement?view=${key}` : '/engagement'}
            aria-selected={view === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {view === '' && (
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          {canPost && <FeedComposer canPin={canModerate} />}

          {posts.length === 0 ? (
            <div className="lf-card">
              <EmptyState title="Nothing here yet" description="Be the first to say something." />
            </div>
          ) : (
            posts.map((p) => (
              <article className="lf-card" key={p.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--lf-space-3)' }}>
                  <div>
                    <strong>{p.author?.fullName ?? 'Somebody'}</strong>{' '}
                    <Badge value={p.kind} tone={p.kind === 'ANNOUNCEMENT' ? 'brass' : 'slate'} />
                    {p.isPinned && <Badge value="PINNED" tone="viridian" />}
                  </div>
                  <span className="lf-hint">
                    {p.createdAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>

                {p.hiddenAt && (
                  // Only the author and moderators reach this branch. Saying why
                  // is the difference between moderation and the software
                  // apparently eating a post.
                  <p className="lf-hint" style={{ color: 'var(--lf-vermillion)' }}>
                    Hidden — {p.hiddenReason}
                  </p>
                )}

                <p style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--lf-space-2)' }}>{p.body}</p>

                {p.videoUrl && (
                  <p>
                    <a href={p.videoUrl} target="_blank" rel="noreferrer noopener">
                      Watch the clip
                    </a>
                  </p>
                )}

                <Reactions postId={p.id} counts={p.reactionCounts} mine={p.myReaction} />
              </article>
            ))
          )}
        </div>
      )}

      {view === 'contests' &&
        (!canSeeContests || contests.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="No contests"
              description="A contest names a window and a metric, then ranks people using the same numbers the leader dashboard does."
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
            {contests.map((c, i) => (
              <div className="lf-card" key={c.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--lf-space-3)' }}>
                  <div>
                    <strong>{c.name}</strong>{' '}
                    <Badge value={c.status} tone={c.status === 'OPEN' ? 'viridian' : 'slate'} />
                    <div className="lf-hint">
                      {c.metric} · {c.startAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })} to{' '}
                      {c.endAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                      {c.prize && ` · ${c.prize}`}
                    </div>
                  </div>
                  {/* A closed contest shows what it showed the day it closed. */}
                  <span className="lf-hint">{boards[i].frozen ? 'final' : 'live'}</span>
                </div>

                {boards[i].standings.length === 0 ? (
                  <p className="lf-hint">Nobody has scored yet.</p>
                ) : (
                  <ol style={{ margin: 'var(--lf-space-2) 0 0', paddingLeft: '1.3em' }}>
                    {boards[i].standings.slice(0, 10).map((s) => (
                      <li key={s.userId}>
                        {s.name ?? s.userId} — {Number(s.value).toLocaleString('en-GB')}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        ))}

      {view === 'awards' &&
        (categories.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="No nominations"
              description="Nominate a colleague against an event and the whole workspace can vote, one vote per category."
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
            {event && <p className="lf-hint">Nominations for {event.title}</p>}
            {categories.map((group) => (
              <div className="lf-card" key={group.category}>
                <strong>{group.category}</strong>
                {group.tied && (
                  // Declaring one of them the winner because they sorted first
                  // is how an award goes to the wrong person.
                  <Badge value="TIED" tone="brass" />
                )}
                <table className="lf-grid" style={{ marginTop: 'var(--lf-space-2)' }}>
                  <tbody>
                    {group.nominations.map((n) => (
                      <tr key={n.nominationId}>
                        <td style={{ fontWeight: n.nomineeId === group.leaderId ? 600 : 400 }}>
                          {n.name ?? n.nomineeId}
                          {n.status === 'WON' && <Badge value="WON" tone="viridian" />}
                        </td>
                        <td>{n.reason ?? ''}</td>
                        <td style={{ textAlign: 'right' }} className="lf-num">
                          {n.votes} {n.mine && <span className="lf-hint">· yours</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
    </>
  );
}
