import { requirePageAccess, pageLoad } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { coachingCallList, coachingAnalytics, coachingCounts } from '@/services/shared/coachingInsights';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Coaching' };

const LIMIT = 50;

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

/** A talk ratio is only healthy in a band; both ends are a coaching signal. */
function talkTone(ratio: number): Tone {
  if (ratio > 0.7 || ratio < 0.25) return 'vermillion';
  if (ratio > 0.6 || ratio < 0.35) return 'brass';
  return 'viridian';
}

export default async function CoachingPage({
  params: paramsPromise,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ workspaceSlug }, searchParams] = await Promise.all([paramsPromise, searchParamsPromise]);
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'VIEW'] });

  /**
   * Analysed-only is the default. The screen is called Coaching and promises
   * analysed calls; a workspace's completed-call log is mostly calls nobody
   * uploaded a recording for, and listing those first buried the handful of
   * coachable ones under fifty rows of em-dashes.
   */
  const analysedOnly = searchParams.show !== 'all';

  const filters = {
    callerId: searchParams.rep || undefined,
    stageId: searchParams.stage || undefined,
    from: searchParams.from ? new Date(searchParams.from) : undefined,
    to: searchParams.to ? new Date(`${searchParams.to}T23:59:59`) : undefined,
    analysedOnly,
  };

  const isManager = SCOPE_RANK[scopeFor(ctx, 'calls', 'VIEW')] >= SCOPE_RANK.TEAM;

  const [calls, analytics, counts, reps, stages] = await pageLoad(
    Promise.all([
      coachingCallList(ctx, filters, LIMIT),
      coachingAnalytics(ctx, filters),
      coachingCounts(ctx, filters),
      isManager
        ? prisma.user.findMany({
            where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
            select: { id: true, fullName: true },
            orderBy: { fullName: 'asc' },
            take: 200,
          })
        : Promise.resolve([]),
      prisma.leadStage.findMany({
        where: { tenantId: ctx.tenantId },
        select: { id: true, name: true },
        orderBy: { position: 'asc' },
      }),
    ]),
  );

  const base = `/${workspaceSlug}/sales/coaching`;
  const filtered = Boolean(searchParams.rep || searchParams.stage || searchParams.from || searchParams.to);
  /**
   * Flipping analysed/all keeps every other filter. A bare `?query` href is
   * resolved against the current path by SalesLink, so this needs no base.
   */
  const toggleHref = (() => {
    const q = new URLSearchParams();
    for (const key of ['rep', 'stage', 'from', 'to'] as const) {
      if (searchParams[key]) q.set(key, searchParams[key]!);
    }
    if (analysedOnly) q.set('show', 'all');
    return `?${q.toString()}`;
  })();

  return (
    <>
      <PageHeader
        title="Coaching"
        description={
          isManager
            ? 'Analysed calls across your team: scores, talk-to-listen, objections handled and follow-up discipline.'
            : 'Your analysed calls: scores, talk-to-listen, objections handled and follow-up discipline.'
        }
      />

      {/* Filters — a plain GET form, so the URL is the state and is shareable. */}
      <form
        method="get"
        action={base}
        style={{
          display: 'flex',
          gap: 'var(--lf-space-3)',
          flexWrap: 'wrap',
          margin: 'var(--lf-space-4) 0',
          alignItems: 'flex-end',
        }}
      >
        {isManager && (
          <label className="lf-field">
            <span className="lf-eyebrow">Rep</span>
            <select name="rep" defaultValue={searchParams.rep ?? ''} className="lf-input">
              <option value="">Everyone visible to me</option>
              {reps.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="lf-field">
          <span className="lf-eyebrow">Pipeline stage</span>
          <select name="stage" defaultValue={searchParams.stage ?? ''} className="lf-input">
            <option value="">All stages</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-eyebrow">From</span>
          <input type="date" name="from" defaultValue={searchParams.from ?? ''} className="lf-input" />
        </label>
        <label className="lf-field">
          <span className="lf-eyebrow">To</span>
          <input type="date" name="to" defaultValue={searchParams.to ?? ''} className="lf-input" />
        </label>
        {/* Carried through the submit so filtering does not silently reset the view. */}
        {!analysedOnly && <input type="hidden" name="show" value="all" />}
        <button type="submit" className="lf-btn lf-btn--secondary">
          Filter
        </button>
        {filtered && (
          <SalesLink href="/coaching" className="lf-btn lf-btn--ghost">
            Clear
          </SalesLink>
        )}
      </form>

      {/*
        Analytics. `alignItems: start` matters: without it the three panels
        stretch to the tallest and the two sparse ones render as a card with a
        heading and 200px of nothing under it.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 'var(--lf-space-4)',
          alignItems: 'start',
          marginBottom: 'var(--lf-space-4)',
        }}
      >
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Talk-to-listen by rep
          </div>
          {analytics.talkToListenByRep.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              No speaker-attributed transcripts yet. Upload a recording, or paste a transcript with <code>Agent:</code>{' '}
              / <code>Client:</code> prefixes.
            </p>
          ) : (
            <>
              {analytics.talkToListenByRep.map((row) => (
                <div key={row.callerId} style={{ fontSize: 'var(--lf-text-sm)', padding: '6px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.rep}</span>
                    <span className="lf-num" style={{ whiteSpace: 'nowrap', color: 'var(--lf-ink-2)' }}>
                      {pct(row.avgTalkRatio)} · {row.calls} {row.calls === 1 ? 'call' : 'calls'}
                    </span>
                  </div>
                  <div
                    style={{ height: 8, background: 'var(--lf-surface-2)', borderRadius: 4, position: 'relative' }}
                    title={`Range across calls: ${pct(row.minTalkRatio)}–${pct(row.maxTalkRatio)}`}
                  >
                    {/* The 40–60% band a coach looks for, drawn rather than enforced. */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '40%',
                        width: '20%',
                        height: '100%',
                        background: 'color-mix(in srgb, var(--lf-viridian) 22%, transparent)',
                        borderRadius: 4,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `calc(${Math.min(99, Math.max(1, row.avgTalkRatio * 100))}% - 4px)`,
                        width: 8,
                        height: '100%',
                        borderRadius: 4,
                        background:
                          talkTone(row.avgTalkRatio) === 'viridian'
                            ? 'var(--lf-viridian)'
                            : talkTone(row.avgTalkRatio) === 'brass'
                              ? 'var(--lf-brass)'
                              : 'var(--lf-vermillion)',
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className="lf-hint" style={{ marginTop: 'var(--lf-space-3)', marginBottom: 0 }}>
                Shaded band is 40–60% — the rep talking about half the time.
              </p>
            </>
          )}
        </section>

        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Objections → next step
          </div>
          {analytics.objectionConversion.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              No playbook matches yet. Add trigger phrases in the{' '}
              <SalesLink href="/playbook">objection playbook</SalesLink> — analysed calls are checked against them.
            </p>
          ) : (
            /* lf-grid sets white-space: nowrap, so without this wrapper the last
               column is clipped by the card edge instead of scrolling. */
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Objection</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Addressed</th>
                    <th style={{ textAlign: 'right' }}>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.objectionConversion.map((row) => (
                    <tr key={row.objectionId}>
                      <td data-label="Objection">{row.name}</td>
                      <td data-label="Calls" className="lf-num" style={{ textAlign: 'right' }}>
                        {row.calls}
                      </td>
                      <td data-label="Addressed" className="lf-num" style={{ textAlign: 'right' }}>
                        {pct(row.addressedRate)}
                      </td>
                      <td data-label="Next step" className="lf-num" style={{ textAlign: 'right' }}>
                        {pct(row.nextStepRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Follow-up speed
          </div>
          <div className="lf-stat-strip lf-stat-strip--light">
            <div>
              <span className="lf-figure lf-num" style={{ fontSize: '1.4rem' }}>
                {analytics.followUpTiming.followedUp}/{analytics.followUpTiming.calls}
              </span>
              <span className="lf-eyebrow">Followed up</span>
            </div>
            <div>
              <span className="lf-figure lf-num" style={{ fontSize: '1.4rem' }}>
                {analytics.followUpTiming.medianMinutes != null ? `${analytics.followUpTiming.medianMinutes}m` : '—'}
              </span>
              <span className="lf-eyebrow">Median</span>
            </div>
            <div>
              <span className="lf-figure lf-num" style={{ fontSize: '1.4rem' }}>
                {analytics.followUpTiming.p90Minutes != null ? `${analytics.followUpTiming.p90Minutes}m` : '—'}
              </span>
              <span className="lf-eyebrow">P90</span>
            </div>
          </div>

          <div className="lf-eyebrow" style={{ margin: 'var(--lf-space-4) 0 var(--lf-space-2)' }}>
            Forward motion by stage
          </div>
          {analytics.conversionByStage.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              No calls linked to a lead in this window.
            </p>
          ) : (
            analytics.conversionByStage.map((row) => (
              <div
                key={row.stageId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--lf-space-3)',
                  fontSize: 'var(--lf-text-sm)',
                  padding: '3px 0',
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.stage}
                </span>
                <span className="lf-num" style={{ whiteSpace: 'nowrap', color: 'var(--lf-ink-2)' }}>
                  {pct(row.forwardRate)} of {row.calls}
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      {analytics.window.capped && (
        <p className="lf-hint" style={{ marginBottom: 'var(--lf-space-3)' }}>
          Figures cover the most recent {analytics.window.calls} calls in this filter — narrow the dates for an exact
          window.
        </p>
      )}

      {/* List header: what is being shown, and the one-click way to see the rest. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--lf-space-3)',
          flexWrap: 'wrap',
          marginBottom: 'var(--lf-space-2)',
        }}
      >
        <h2 className="lf-h2" style={{ margin: 0 }}>
          {analysedOnly ? 'Analysed calls' : 'All completed calls'}{' '}
          <span className="lf-num" style={{ color: 'var(--lf-ink-3)', fontWeight: 400 }}>
            {calls.length}
            {calls.length === LIMIT ? '+' : ''}
          </span>
        </h2>
        {analysedOnly ? (
          counts.awaitingAnalysis > 0 && (
            <SalesLink href={toggleHref} className="lf-btn lf-btn--ghost lf-btn--sm">
              Show {counts.awaitingAnalysis} awaiting analysis
            </SalesLink>
          )
        ) : (
          <SalesLink href={toggleHref} className="lf-btn lf-btn--ghost lf-btn--sm">
            Analysed only ({counts.analysed})
          </SalesLink>
        )}
      </div>

      {calls.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title={analysedOnly ? 'No analysed calls yet' : 'No completed calls'}
            description={
              analysedOnly
                ? 'A call appears here once its recording or transcript has been analysed. Open a completed call and upload one.'
                : 'Calls appear here once they are marked completed.'
            }
          />
        </div>
      ) : (
        /* lf-grid-wrap is overflow:hidden and lf-grid cells are nowrap, so an
           eight-column table needs somewhere to go between the mobile card
           breakpoint (860px) and its natural width. */
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Call</th>
                <th>Rep</th>
                <th>When</th>
                <th style={{ textAlign: 'right' }}>Score</th>
                <th style={{ textAlign: 'right' }}>Talk</th>
                <th>Objections</th>
                <th>Follow-up</th>
                <th style={{ textAlign: 'right' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const scoreTone: Tone =
                  call.score == null
                    ? 'slate'
                    : call.score >= 70
                      ? 'viridian'
                      : call.score >= 40
                        ? 'brass'
                        : 'vermillion';
                return (
                  <tr key={call.id}>
                    <td data-label="Call">
                      <SalesLink
                        href={`/calls/${call.id}`}
                        style={{ textDecoration: 'none', color: 'inherit', fontWeight: 500 }}
                      >
                        {call.recipientNumber ?? call.id.slice(0, 8)}
                      </SalesLink>
                    </td>
                    <td data-label="Rep">{call.caller?.fullName ?? '—'}</td>
                    <td data-label="When" style={{ color: 'var(--lf-ink-2)' }}>
                      {call.at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </td>
                    {/*
                      Score is the audit score and nothing else. This cell used
                      to fall back to the *analysis* status, so a call with a
                      finished analysis and no scorecard rendered the word
                      "completed" under a column headed Score — which reads as a
                      result rather than a state. The state lives below the
                      number now, quietly, where it cannot be mistaken for one.
                    */}
                    <td data-label="Score" style={{ textAlign: 'right' }}>
                      {call.score != null ? (
                        <Badge tone={scoreTone}>{call.score}%</Badge>
                      ) : call.analysisStatus === 'FAILED' ? (
                        <Badge tone="vermillion">failed</Badge>
                      ) : call.analysisStatus === 'PROCESSING' || call.analysisStatus === 'PENDING' ? (
                        <span className="lf-hint">analysing…</span>
                      ) : (
                        <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                      )}
                    </td>
                    <td data-label="Talk" className="lf-num" style={{ textAlign: 'right' }}>
                      {call.talkRatio != null ? (
                        <span
                          style={{
                            color:
                              talkTone(call.talkRatio) === 'viridian'
                                ? 'var(--lf-ink)'
                                : talkTone(call.talkRatio) === 'brass'
                                  ? 'var(--lf-brass)'
                                  : 'var(--lf-vermillion)',
                          }}
                          title="Share of the conversation spoken by the rep"
                        >
                          {Math.round(call.talkRatio * 100)}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                      )}
                    </td>
                    <td data-label="Objections">
                      {call.objections === 0 ? (
                        <span style={{ color: 'var(--lf-ink-3)' }}>none</span>
                      ) : (
                        <Badge tone={call.objectionsAddressed === call.objections ? 'viridian' : 'vermillion'}>
                          {call.objectionsAddressed}/{call.objections} handled
                        </Badge>
                      )}
                    </td>
                    <td data-label="Follow-up">
                      {call.followUpSentAt ? <Badge tone="viridian">sent</Badge> : <Badge tone="slate">not sent</Badge>}
                    </td>
                    <td data-label="Notes" className="lf-num" style={{ textAlign: 'right' }}>
                      {call.coachingNotes || <span style={{ color: 'var(--lf-ink-3)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
