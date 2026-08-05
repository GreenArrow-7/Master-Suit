'use client';

interface AnalysisData {
  status: string;
  summary: string | null;
  clientNeeds: string[];
  objections: string[];
  commitments: string[];
  buyingSignals: string[];
  risks: string[];
  nextSteps: string[];
  topicsDiscussed: string[];
  topicsMissed: string[];
  sentiment: string | null;
  sentimentScore: number | null;
  suggestedStatus: string | null;
  complianceFlags: string[];
  uncertainItems: string[];
  humanCorrected: boolean;
  errorMessage: string | null;
}

function Section({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 'var(--lf-text-2xs)', fontWeight: 600, color: tone ?? 'var(--lf-ink-3)', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-4)', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
        {items.map((item, i) => <li key={i} style={{ marginBottom: 2 }}>{item}</li>)}
      </ul>
    </div>
  );
}

export default function AnalysisPanel({ analysis }: { analysis: AnalysisData | null }) {
  if (!analysis) {
    return (
      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>AI Analysis</div>
        <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          No analysis yet. Upload a transcript and trigger analysis from the Actions panel.
        </p>
      </section>
    );
  }

  if (analysis.status === 'PROCESSING') {
    return (
      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>AI Analysis</div>
        <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-brass)' }}>Analysis in progress…</p>
      </section>
    );
  }

  if (analysis.status === 'FAILED') {
    return (
      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>AI Analysis</div>
        <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-vermillion)' }}>Analysis failed: {analysis.errorMessage ?? 'Unknown error'}</p>
      </section>
    );
  }

  const sentimentColor = analysis.sentimentScore != null
    ? analysis.sentimentScore > 0.6 ? 'var(--lf-viridian)' : analysis.sentimentScore > 0.3 ? 'var(--lf-brass)' : 'var(--lf-vermillion)'
    : 'var(--lf-ink-3)';

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--lf-space-3)' }}>
        <div className="lf-eyebrow">AI Analysis</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {analysis.humanCorrected && <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-viridian)', fontWeight: 500 }}>Human-corrected</span>}
          {analysis.sentiment && (
            <span style={{ fontSize: 'var(--lf-text-sm)', color: sentimentColor, fontWeight: 600 }}>
              {analysis.sentiment} {analysis.sentimentScore != null ? `(${Math.round(analysis.sentimentScore * 100)}%)` : ''}
            </span>
          )}
        </div>
      </div>

      {/* AI disclaimer */}
      <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', fontStyle: 'italic', marginBottom: 12, padding: '6px 8px', background: 'var(--lf-surface-2, #f5f5f5)', borderRadius: 4 }}>
        AI-generated suggestions — review and correct as needed. Uncertain items are flagged below.
      </div>

      {analysis.summary && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 'var(--lf-text-2xs)', fontWeight: 600, color: 'var(--lf-ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Summary</div>
          <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', margin: 0, whiteSpace: 'pre-wrap' }}>{analysis.summary}</p>
        </div>
      )}

      {analysis.suggestedStatus && (
        <div style={{ marginBottom: 12, fontSize: 'var(--lf-text-sm)' }}>
          <span style={{ fontWeight: 500, color: 'var(--lf-ink-3)' }}>Suggested lead status: </span>
          <span style={{ fontWeight: 600, color: 'var(--lf-viridian)' }}>{analysis.suggestedStatus}</span>
          <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginLeft: 4 }}>(suggestion only)</span>
        </div>
      )}

      <Section title="Client Needs" items={analysis.clientNeeds} />
      <Section title="Buying Signals" items={analysis.buyingSignals} tone="var(--lf-viridian)" />
      <Section title="Objections" items={analysis.objections} tone="var(--lf-vermillion)" />
      <Section title="Commitments" items={analysis.commitments} />
      <Section title="Next Steps" items={analysis.nextSteps} tone="var(--lf-viridian)" />
      <Section title="Risks" items={analysis.risks} tone="var(--lf-vermillion)" />
      <Section title="Topics Discussed" items={analysis.topicsDiscussed} />
      <Section title="Topics Missed" items={analysis.topicsMissed} tone="var(--lf-vermillion)" />
      <Section title="Compliance Flags" items={analysis.complianceFlags} tone="var(--lf-vermillion)" />

      {analysis.uncertainItems.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--lf-surface-2, #fffbe6)', borderRadius: 4, border: '1px solid var(--lf-brass, #d4a017)' }}>
          <div style={{ fontSize: 'var(--lf-text-2xs)', fontWeight: 600, color: 'var(--lf-brass)', marginBottom: 4 }}>UNCERTAIN — Needs Verification</div>
          <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-4)', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
            {analysis.uncertainItems.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
