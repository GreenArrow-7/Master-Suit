import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import {
  activeSessionFor,
  dialerPolicy,
  dialerRefusal,
  notDialledReason,
  teamSessions,
  usesDialer,
} from '@/services/dialer/session';
import { queueStats } from '@/services/dialer/queue';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import DialerConsole from './DialerConsole';

export const metadata = { title: 'Dialer' };

/**
 * The calling screen.
 *
 * Server-rendered from the session row, which is the whole acceptance
 * criterion: refreshing this page re-reads a column and the agent is on the
 * same person with the same counts. There is no client state to lose because
 * there is none to hold.
 *
 * The page does *not* start a session. Rendering a URL must not claim a contact
 * — starting a shift is something an agent chooses, so it takes a button.
 */
export default async function DialerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['dialer', 'VIEW'] });

  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, name: true, status: true, channel: true },
  });
  if (!campaign) notFound();

  const isLeader = can(ctx, 'dialer', 'MANAGE_USERS');

  const [session, stats, policy, team, refusal] = await Promise.all([
    activeSessionFor(ctx.tenantId, ctx.actor.id, campaign.id),
    queueStats(ctx.tenantId, campaign.id),
    dialerPolicy(ctx.tenantId),
    isLeader ? teamSessions(ctx.tenantId, campaign.id) : [],
    // This page already selected `campaign.status` and never read it. Now it
    // does: a campaign that is not being called gets the reason instead of a
    // Start button that the API would refuse.
    dialerRefusal(ctx.tenantId, campaign.id),
  ]);

  // Two different noes, and the order matters: a campaign the dialer never
  // works is a permanent one, so it is answered before the temporary question
  // of whether this campaign may be called right now. The link to here is
  // hidden in that case; somebody arriving by URL or bookmark still gets told.
  const blocked = (await usesDialer(ctx.tenantId, campaign)) ? refusal : notDialledReason(campaign.channel);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <header>
        <p className="lf-eyebrow">
          <SalesLink href={`/campaigns/${campaign.id}`}>{campaign.name}</SalesLink>
        </p>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 2 }}>
          Dialer
        </h1>
        <p className="lf-hint" style={{ marginTop: 6 }}>
          {stats.pending + stats.callback} to call · {stats.completed} done · {stats.exhausted} retired. A number is
          left alone for {Math.round(policy.cooldownSeconds / 60)} minutes after it is dialled, and retired after{' '}
          {policy.maxAttempts} attempts.
        </p>
      </header>

      {blocked ? (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Not calling this list
          </h2>
          <p className="lf-hint" style={{ margin: '6px 0 0' }}>
            {blocked}
          </p>
          <p style={{ margin: '12px 0 0' }}>
            <SalesLink className="lf-btn lf-btn--sm lf-btn--secondary" href={`/campaigns/${campaign.id}`}>
              Open the campaign
            </SalesLink>
          </p>
        </section>
      ) : (
        <DialerConsole
          campaignId={campaign.id}
          initial={
            session
              ? {
                  sessionId: session.session.id,
                  dialed: session.session.dialed,
                  connected: session.session.connected,
                  skipped: session.session.skipped,
                  callbacks: session.session.callbacks,
                  remaining: session.remaining,
                  currentCallId: session.currentCallId,
                  contact: session.contact,
                  blockedBy: session.blockedBy,
                }
              : null
          }
        />
      )}

      {isLeader && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            On the floor
          </h2>
          {team.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              Nobody is dialling this campaign right now.
            </p>
          ) : (
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>On now</th>
                    <th style={{ textAlign: 'right' }}>Dialled</th>
                    <th style={{ textAlign: 'right' }}>Connected</th>
                    <th style={{ textAlign: 'right' }}>Skipped</th>
                    <th style={{ textAlign: 'right' }}>Callbacks</th>
                    <th>Idle</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.agent}</td>
                      <td>{s.onNow ? `${s.onNow.displayName ?? 'Unnamed'} · ${s.onNow.phone}` : '—'}</td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {s.dialed}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {s.connected}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {s.skipped}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {s.callbacks}
                      </td>
                      <td>
                        {/* Fifteen minutes is when the sweep reaps the session
                            and frees whoever it was holding. */}
                        {s.idleMinutes >= 10 ? (
                          <Badge value={`${s.idleMinutes}m`} tone="brass" />
                        ) : (
                          <span className="lf-num">{s.idleMinutes}m</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
