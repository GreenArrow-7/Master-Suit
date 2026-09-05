import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import CallActions from './CallActions';
import AuditDelete from './AuditDelete';
import AnalysisPanel from './AnalysisPanel';
import FollowUpComposer from './FollowUpComposer';
import WhatsAppFollowUp from './WhatsAppFollowUp';
import CoachingNotes, { type CoachingNoteView } from './CoachingNotes';
import RequirementSuggestion, { type DetectedRequirementView } from './RequirementSuggestion';
import TemperaturePanel from './TemperaturePanel';
import { temperatureFromAnalysis } from '@/lib/ai/temperature';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';

export const metadata = { title: 'Call Detail' };

const OUTCOME_TONE: Record<string, Tone> = {
  CONNECTED: 'viridian',
  INTERESTED: 'viridian',
  QUALIFIED: 'viridian',
  CONVERTED: 'viridian',
  NO_ANSWER: 'slate',
  BUSY: 'brass',
  VOICEMAIL: 'brass',
  NOT_INTERESTED: 'vermillion',
  WRONG_NUMBER: 'vermillion',
  CALLBACK_REQUESTED: 'brass',
};

function fmtDuration(s: number | null) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default async function CallDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'VIEW'] });

  const [call, analysis, audits, followUps, objectionMatches, coachingNotes] = await Promise.all([
    prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        caller: { select: { id: true, fullName: true } },
        consent: true,
        recording: {
          select: {
            id: true,
            mimeType: true,
            durationSecs: true,
            sizeBytes: true,
            createdAt: true,
            storageBucket: true,
          },
        },
        transcript: { select: { id: true, wordCount: true, language: true, createdAt: true } },
      },
    }),
    prisma.aIAnalysis.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
    prisma.callAudit.findMany({
      where: { callId: params.id, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.followUpTask.findMany({
      where: { tenantId: ctx.tenantId, callId: params.id, deletedAt: null },
      orderBy: { dueAt: 'asc' },
      take: 10,
    }),
    prisma.objectionMatch.findMany({
      where: { tenantId: ctx.tenantId, callId: params.id },
      include: { objection: { select: { name: true, recommendedResponses: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
    prisma.coachingNote.findMany({
      where: { tenantId: ctx.tenantId, callId: params.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, fullName: true } } },
      take: 50,
    }),
  ]);

  if (!call) notFound();

  // The Call row stores leadId without a Prisma relation; one scoped lookup
  // names the customer, which is what a call detail is about.
  const lead = call.leadId
    ? await prisma.lead.findFirst({
        where: { id: call.leadId, tenantId: ctx.tenantId },
        select: { id: true, fullName: true, company: true, score: true },
      })
    : null;

  // Explainable post-call temperature, computed on the way out — writing it to
  // the lead is the agent's explicit act via the temperature route.
  const temperature = lead && analysis?.status === 'COMPLETED' ? temperatureFromAnalysis(analysis) : null;

  // The requirement the AI heard on this call, staged for review. Lives in the
  // analysis rawOutput, so old rows and providerless rows both work unchanged.
  const detectedRequirement =
    analysis?.status === 'COMPLETED'
      ? (((analysis.rawOutput as Record<string, unknown> | null)?.detectedRequirement ??
          null) as DetectedRequirementView | null)
      : null;
  const openRequirement =
    lead && detectedRequirement
      ? await prisma.clientRequirement.findFirst({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null, status: 'OPEN' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })
      : null;
  const canSuggestRequirement = openRequirement ? can(ctx, 'requirements', 'EDIT') : can(ctx, 'requirements', 'CREATE');

  const hasConsent = call.consent?.consentGiven && !call.consent.withdrawnAt;
  // Wildcard-granted to administrator roles only; QA reviews, admins erase.
  const canDeleteAudits = can(ctx, 'calls', 'DELETE');

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--lf-space-3)',
          flexWrap: 'wrap',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <div>
          <h1 className="lf-h1">
            {lead ? (
              <SalesLink href={`/leads/${lead.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {lead.fullName}
              </SalesLink>
            ) : (
              (call.recipientNumber ?? 'Unknown number')
            )}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {call.direction.toLowerCase()} call
            {call.recipientNumber && lead ? ` · ${call.recipientNumber}` : ''} ·{' '}
            {call.caller?.fullName ?? 'Unknown caller'}
            {call.startedAt &&
              ` · ${call.startedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
          {['SCHEDULED', 'RINGING', 'IN_PROGRESS'].includes(call.status) && (
            <SalesLink className="lf-btn lf-btn--sm" href={`/calls/${call.id}/live`}>
              Open live workspace
            </SalesLink>
          )}
          <Badge tone={call.outcome ? OUTCOME_TONE[call.outcome] : 'slate'}>
            {call.outcome?.toLowerCase().replace(/_/g, ' ') ?? call.status.toLowerCase()}
          </Badge>
        </div>
      </div>

      {/* Intelligence on the left, where the eye lands: the analysis, then
          what the playbook found, the audits, coaching, and the rep's own
          notes. Facts and actions on the right. This was an auto-fit grid of
          twelve equal cards in which the AI verdict sat in column two, level
          with the consent record. */}
      <div className="lf-detail">
        <div className="lf-detail__main" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          {lead && temperature && (
            <TemperaturePanel
              callId={params.id}
              result={temperature}
              leadScore={lead.score}
              canApply={can(ctx, 'leads', 'EDIT')}
            />
          )}
          {lead && detectedRequirement && canSuggestRequirement && (
            <RequirementSuggestion
              leadId={lead.id}
              existingRequirementId={openRequirement?.id ?? null}
              detected={detectedRequirement}
            />
          )}
          <AnalysisPanel
            analysis={
              analysis
                ? {
                    status: analysis.status,
                    summary: analysis.summary,
                    clientNeeds: analysis.clientNeeds as string[],
                    objections: analysis.objections as string[],
                    commitments: analysis.commitments as string[],
                    buyingSignals: analysis.buyingSignals as string[],
                    risks: analysis.risks as string[],
                    nextSteps: analysis.nextSteps as string[],
                    actionItems: analysis.actionItems as string[],
                    talkRatio: analysis.talkRatio,
                    topicsDiscussed: analysis.topicsDiscussed as string[],
                    topicsMissed: analysis.topicsMissed as string[],
                    sentiment: analysis.sentiment,
                    sentimentScore: analysis.sentimentScore,
                    suggestedStatus: analysis.suggestedStatus,
                    complianceFlags: analysis.complianceFlags as string[],
                    uncertainItems: analysis.uncertainItems as string[],
                    humanCorrected: analysis.humanCorrected,
                    errorMessage: analysis.errorMessage,
                  }
                : null
            }
          />

          {/* Playbook objections found in this call */}
          {objectionMatches.length > 0 && (
            <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
              <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
                Playbook Objections
              </div>
              {objectionMatches.map((m) => (
                <div
                  key={m.id}
                  style={{
                    borderBottom: '1px solid var(--lf-line)',
                    paddingBottom: 'var(--lf-space-3)',
                    marginBottom: 'var(--lf-space-3)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 600 }}>{m.objection.name}</span>
                    <Badge tone={m.addressed ? 'viridian' : 'vermillion'}>
                      {m.addressed ? 'addressed' : 'not addressed'}
                    </Badge>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 'var(--lf-text-sm)',
                      color: 'var(--lf-ink-2)',
                      fontStyle: 'italic',
                    }}
                  >
                    “{m.snippet}”
                  </p>
                  {!m.addressed && (m.objection.recommendedResponses as string[])[0] && (
                    <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
                      Playbook: {(m.objection.recommendedResponses as string[])[0]}
                    </p>
                  )}
                </div>
              ))}
              <p className="lf-hint" style={{ margin: 0 }}>
                “Addressed” is a phrase-overlap heuristic against the playbook’s recommended responses — listen before
                you coach on it.
              </p>
            </section>
          )}

          <CoachingNotes
            callId={params.id}
            notes={coachingNotes.map((n): CoachingNoteView => ({
              id: n.id,
              body: n.body,
              resolvedAt: n.resolvedAt?.toISOString() ?? null,
              createdAt: n.createdAt.toISOString(),
              author: n.author,
            }))}
            canCoach={SCOPE_RANK[scopeFor(ctx, 'calls', 'VIEW')] >= SCOPE_RANK.TEAM && call.callerId !== ctx.actor.id}
            viewerId={ctx.actor.id}
            repId={call.callerId}
          />

          {/* Call Audits */}
          {audits.length > 0 && (
            <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
              <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
                Call Audits
              </div>
              {audits.map((a) => {
                const pct = a.maxScore ? Math.round(((a.overallScore ?? 0) / a.maxScore) * 100) : null;
                const scores = (a.criteriaScores as any[] | null) ?? [];
                return (
                  <div
                    key={a.id}
                    style={{
                      borderBottom: '1px solid var(--lf-line)',
                      paddingBottom: 'var(--lf-space-3)',
                      marginBottom: 'var(--lf-space-3)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <Badge
                        tone={a.status === 'COMPLETED' ? 'viridian' : a.status === 'FAILED' ? 'vermillion' : 'brass'}
                      >
                        {a.status.toLowerCase()}
                      </Badge>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--lf-space-3)' }}>
                        {pct !== null && (
                          <span
                            className="lf-num"
                            style={{
                              fontSize: 'var(--lf-text-lg)',
                              fontWeight: 700,
                              color:
                                pct >= 70
                                  ? 'var(--lf-viridian)'
                                  : pct >= 40
                                    ? 'var(--lf-brass)'
                                    : 'var(--lf-vermillion)',
                            }}
                          >
                            {pct}%
                          </span>
                        )}
                        {canDeleteAudits && <AuditDelete callId={call.id} auditId={a.id} />}
                      </span>
                    </div>

                    {scores.length > 0 && (
                      <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                        {scores.map((s: any, i: number) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                            <span>
                              {s.met ? '✓' : '✗'} {s.label}
                            </span>
                            <span className="lf-num">
                              {s.score}/{s.maxScore}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {((a.suggestions as string[]) ?? []).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div
                          style={{
                            fontSize: 'var(--lf-text-2xs)',
                            fontWeight: 500,
                            color: 'var(--lf-ink-3)',
                            marginBottom: 4,
                          }}
                        >
                          Coaching
                        </div>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 'var(--lf-space-4)',
                            fontSize: 'var(--lf-text-sm)',
                            color: 'var(--lf-ink-2)',
                          }}
                        >
                          {((a.suggestions as string[]) ?? []).map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {a.humanReviewed && <Badge tone="viridian">reviewed</Badge>}
                  </div>
                );
              })}
            </section>
          )}
          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Notes
            </div>
            <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', whiteSpace: 'pre-wrap' }}>
              {call.notes || 'No notes recorded.'}
            </p>
          </section>
        </div>

        <aside className="lf-detail__side">
          {/* The five facts that were a strip of centred figures above two
              columns of cards. As a list beside the analysis they answer
              "is there anything to analyse" without taking a band of the page. */}
          <section className="lf-panel">
            <dl className="lf-kv">
              <div>
                <dt>Duration</dt>
                <dd className="lf-num">{fmtDuration(call.durationSecs)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd style={{ textTransform: 'capitalize' }}>{call.status.toLowerCase().replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>Consent</dt>
                <dd>
                  <Badge tone={hasConsent ? 'viridian' : 'vermillion'}>{hasConsent ? 'given' : 'none'}</Badge>
                </dd>
              </div>
              <div>
                <dt>Transcript</dt>
                <dd>
                  <Badge tone={call.transcript ? 'viridian' : 'slate'}>
                    {call.transcript ? `${call.transcript.wordCount} words` : 'none'}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>AI analysis</dt>
                <dd>
                  <Badge
                    tone={
                      analysis?.status === 'COMPLETED'
                        ? 'viridian'
                        : analysis?.status === 'FAILED'
                          ? 'vermillion'
                          : 'slate'
                    }
                  >
                    {analysis?.status?.toLowerCase() ?? 'none'}
                  </Badge>
                </dd>
              </div>
            </dl>
          </section>

          <CallActions
            callId={params.id}
            hasConsent={!!hasConsent}
            callStatus={call.status}
            hasTranscript={!!call.transcript}
            hasAnalysis={!!analysis}
            hasRecording={!!call.recording}
          />

          <FollowUpComposer callId={params.id} />

          <WhatsAppFollowUp callId={params.id} />

          {/* Consent details */}
          {call.consent && (
            <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
              <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
                Consent Details
              </div>
              <dl
                style={{
                  fontSize: 'var(--lf-text-sm)',
                  color: 'var(--lf-ink-2)',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '4px 12px',
                  margin: 0,
                }}
              >
                <dt style={{ fontWeight: 500 }}>Method</dt>
                <dd style={{ margin: 0 }}>{call.consent.method?.toLowerCase() ?? '—'}</dd>
                <dt style={{ fontWeight: 500 }}>Given at</dt>
                <dd style={{ margin: 0 }}>{call.consent.givenAt?.toLocaleString('en-GB') ?? '—'}</dd>
                {call.consent.withdrawnAt && (
                  <>
                    <dt style={{ fontWeight: 500, color: 'var(--lf-vermillion)' }}>Withdrawn</dt>
                    <dd style={{ margin: 0, color: 'var(--lf-vermillion)' }}>
                      {call.consent.withdrawnAt.toLocaleString('en-GB')}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {call.recording && (
            <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
              <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
                Recording
              </div>
              <dl
                style={{
                  fontSize: 'var(--lf-text-sm)',
                  color: 'var(--lf-ink-2)',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '4px 12px',
                  margin: 0,
                }}
              >
                <dt style={{ fontWeight: 500 }}>Format</dt>
                <dd style={{ margin: 0 }}>{call.recording.mimeType}</dd>
                <dt style={{ fontWeight: 500 }}>Duration</dt>
                <dd style={{ margin: 0 }}>{fmtDuration(call.recording.durationSecs)}</dd>
                {call.recording.sizeBytes && (
                  <>
                    <dt style={{ fontWeight: 500 }}>Size</dt>
                    <dd style={{ margin: 0 }}>{(call.recording.sizeBytes / 1024 / 1024).toFixed(1)} MB</dd>
                  </>
                )}
              </dl>

              {/*
                Playback, with a scrubber the browser draws.

                A native <audio> element is the whole feature: seek, speed and
                keyboard control for free, and better than a hand-rolled
                scrubber would be. `preload="none"` because a call recording is
                megabytes and most visits to this page never press play.

                `storageBucket === 'provider'` means the media is still on the
                telephony vendor's servers — the ingest worker has not pulled it
                into our bucket yet, and the download route refuses it until it
                has. Saying so beats a player that fails silently.
              */}
              {call.recording.storageBucket === 'provider' ? (
                <p className="lf-hint" style={{ marginTop: 'var(--lf-space-3)' }}>
                  Still transferring from the telephony provider. It will play once the media worker has it.
                </p>
              ) : (
                <audio
                  controls
                  preload="none"
                  src={`/api/v1/calls/${call.id}/recording/media`}
                  style={{ width: '100%', marginTop: 'var(--lf-space-3)' }}
                >
                  Your browser cannot play audio.
                </audio>
              )}
            </section>
          )}

          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Follow-ups
            </div>
            {followUps.length === 0 ? (
              <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>No follow-ups from this call.</p>
            ) : (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 'var(--lf-space-5)',
                  fontSize: 'var(--lf-text-sm)',
                  color: 'var(--lf-ink-2)',
                }}
              >
                {followUps.map((f) => (
                  <li key={f.id} style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{f.title}</span>
                    <span style={{ color: 'var(--lf-ink-3)', marginLeft: 8 }}>
                      due {f.dueAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </span>{' '}
                    <Badge tone={f.status === 'COMPLETED' ? 'viridian' : f.status === 'OPEN' ? 'brass' : 'slate'}>
                      {f.status.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
