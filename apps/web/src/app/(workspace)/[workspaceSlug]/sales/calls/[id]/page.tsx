import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';
import CallActions from './CallActions';
import AnalysisPanel from './AnalysisPanel';

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

  const [call, analysis, audits, followUps] = await Promise.all([
    prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        caller: { select: { id: true, fullName: true } },
        consent: true,
        recording: { select: { id: true, mimeType: true, durationSecs: true, sizeBytes: true, createdAt: true } },
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
  ]);

  if (!call) notFound();

  const hasConsent = call.consent?.consentGiven && !call.consent.withdrawnAt;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <div>
          <h1 className="lf-h1">Call: {call.recipientNumber ?? 'Unknown'}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {call.direction.toLowerCase()} · {call.caller?.fullName ?? 'Unknown caller'}
            {call.startedAt &&
              ` · ${call.startedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <Badge tone={call.outcome ? OUTCOME_TONE[call.outcome] : 'slate'}>
          {call.outcome?.toLowerCase().replace(/_/g, ' ') ?? call.status.toLowerCase()}
        </Badge>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 'var(--lf-space-4)',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-eyebrow">Duration</div>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700, marginTop: 4 }}>
            {fmtDuration(call.durationSecs)}
          </div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-eyebrow">Status</div>
          <div style={{ fontSize: 'var(--lf-text-xl)', fontWeight: 700, marginTop: 4 }}>
            {call.status.toLowerCase()}
          </div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-eyebrow">Consent</div>
          <div style={{ marginTop: 4 }}>
            <Badge tone={hasConsent ? 'viridian' : 'vermillion'}>{hasConsent ? 'given' : 'none'}</Badge>
          </div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-eyebrow">Transcript</div>
          <div style={{ marginTop: 4 }}>
            <Badge tone={call.transcript ? 'viridian' : 'slate'}>
              {call.transcript ? `${call.transcript.wordCount} words` : 'none'}
            </Badge>
          </div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-eyebrow">AI Analysis</div>
          <div style={{ marginTop: 4 }}>
            <Badge
              tone={
                analysis?.status === 'COMPLETED' ? 'viridian' : analysis?.status === 'FAILED' ? 'vermillion' : 'slate'
              }
            >
              {analysis?.status?.toLowerCase() ?? 'none'}
            </Badge>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--lf-space-4)' }}>
        {/* Left column */}
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', alignContent: 'start' }}>
          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Notes
            </div>
            <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', whiteSpace: 'pre-wrap' }}>
              {call.notes || 'No notes recorded.'}
            </p>
          </section>

          <CallActions
            callId={params.id}
            hasConsent={!!hasConsent}
            callStatus={call.status}
            hasTranscript={!!call.transcript}
            hasAnalysis={!!analysis}
          />

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
        </div>

        {/* Right column: AI Analysis + Audits */}
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', alignContent: 'start' }}>
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
                      {pct !== null && (
                        <span
                          className="lf-num"
                          style={{
                            fontSize: 'var(--lf-text-lg)',
                            fontWeight: 700,
                            color:
                              pct >= 70 ? 'var(--lf-viridian)' : pct >= 40 ? 'var(--lf-brass)' : 'var(--lf-vermillion)',
                          }}
                        >
                          {pct}%
                        </span>
                      )}
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
        </div>
      </div>
    </>
  );
}
