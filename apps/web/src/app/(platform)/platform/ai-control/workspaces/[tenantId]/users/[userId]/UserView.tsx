'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import Badge from '@/components/ui/Badge';
import type { UserDetail } from '@/services/ai/console';
import { STATUS_LABEL, STATUS_TONE, SOURCE_LABEL, UsageBar, nf, money, ago } from '../../../../ui';

/**
 * One person's AI consumption and the allowance that governs it.
 *
 * The inheritance chain is shown rather than summarised: an operator raising a
 * number needs to see what it is replacing and what it will fall back to when
 * they remove it, or "reset" is a button nobody dares press.
 */
export default function UserView(data: UserDetail) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/v1/platform/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resource: 'user-budget', tenantId: data.tenantId, userId: data.userId, ...payload }),
      });
      const json = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
      if (!res.ok) throw new Error(json.detail ?? json.title ?? `Request failed (${res.status})`);
      setSaved('Saved. The new allowance applies to the next AI request.');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = data.state;
  const inherited = s.chain.filter((c) => c.source !== 'user');

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="AI usage and token settings"
        title={data.name}
        description={[data.workspaceName, data.roleName, data.planName ? `${data.planName} plan` : null]
          .filter(Boolean)
          .join(' · ')}
        breadcrumbs={[
          { label: 'Platform', href: '/platform' },
          { label: 'AI Control Center', href: '/platform/ai-control' },
          { label: 'Workspaces', href: '/platform/ai-control/workspaces' },
          { label: data.workspaceName, href: `/platform/ai-control/workspaces/${data.tenantId}` },
          { label: data.name },
        ]}
      />

      {error && (
        <p className="lf-alert" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="lf-muted">{saved}</p>}

      <section className="lf-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
          <Stat
            label={s.period === 'DAILY' ? 'Daily limit' : 'Monthly limit'}
            value={s.tokenLimit === null ? 'no limit' : nf(s.tokenLimit)}
            hint={SOURCE_LABEL[s.source] ?? s.source}
          />
          <Stat label="Used" value={nf(s.usedTokens)} hint={`${nf(s.requests)} requests`} />
          <Stat label="Remaining" value={s.remaining === null ? '—' : nf(s.remaining)} hint="before the limit" />
          <Stat label="Input / output" value={`${nf(s.inputTokens)} / ${nf(s.outputTokens)}`} hint="tokens" />
          <Stat label="Estimated cost" value={money(data.amount)} hint="at the prices in force" />
          <Stat label="Fell back" value={nf(data.fallbacks)} hint="answered on a later model" />
          <div>
            <div className="lf-muted" style={{ fontSize: 12 }}>
              Status
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
              <UsageBar percent={s.percent} />
            </div>
          </div>
        </div>
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 4 }}>
          Token allowance
        </h2>
        <p className="lf-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          {s.overridden
            ? 'This account has an allowance of its own. Remove it and the workspace or plan default takes over again.'
            : `Inherited: this account has no allowance of its own, so it follows the ${SOURCE_LABEL[s.source] ?? s.source}.`}
        </p>

        <WorkspaceTable
          headers={['Level', 'Limit', 'In force']}
          rows={[
            ...s.chain.map((c, i) => [
              SOURCE_LABEL[c.source] ?? c.source,
              c.tokenLimit === null ? '—' : nf(c.tokenLimit),
              i === 0 ? 'effective' : 'inherited, shadowed',
            ]),
            ...(s.chain.length === 0 ? [['nobody has set one', '—', 'no limit applies']] : []),
          ]}
        />
        {inherited.length > 0 && s.overridden && (
          <p className="lf-muted" style={{ marginTop: 8 }}>
            Removing the override returns this account to {nf(inherited[0]!.tokenLimit ?? 0)} tokens from the{' '}
            {SOURCE_LABEL[inherited[0]!.source] ?? inherited[0]!.source}.
          </p>
        )}

        <form
          className="lf-actionrow"
          style={{ alignItems: 'flex-end', paddingTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const raw = String(f.get('tokenLimit') ?? '').trim();
            const cost = String(f.get('costLimit') ?? '').trim();
            void send({
              tokenLimit: raw === '' ? null : Number(raw),
              costLimit: cost === '' ? null : Number(cost),
              period: f.get('period'),
              action: f.get('action'),
              hardLimit: f.get('hardLimit') === 'on',
              effectiveFrom: String(f.get('from') ?? '') || null,
              effectiveTo: String(f.get('to') ?? '') || null,
              reason: String(f.get('reason') ?? '').trim() || null,
            });
          }}
        >
          <Field label="Token limit">
            <input
              className="lf-input"
              name="tokenLimit"
              type="number"
              min="0"
              step="50000"
              defaultValue={s.overridden ? (s.tokenLimit ?? '') : ''}
              placeholder="e.g. 750000"
            />
          </Field>
          <Field label="Cost limit (USD, optional)">
            <input className="lf-input" name="costLimit" type="number" min="0" step="0.01" />
          </Field>
          <Field label="Period">
            <select className="lf-input" name="period" defaultValue={s.period}>
              <option value="MONTHLY">monthly</option>
              <option value="DAILY">daily</option>
            </select>
          </Field>
          <Field label="When reached">
            <select className="lf-input" name="action" defaultValue={s.budget?.action ?? 'BLOCK'}>
              <option value="BLOCK">block further AI</option>
              <option value="CHEAPER_MODEL">drop to a cheaper model</option>
              <option value="ALERT_ONLY">alert only</option>
            </select>
          </Field>
          <Field label="Hard limit">
            <input name="hardLimit" type="checkbox" defaultChecked={s.budget?.hardLimit ?? false} />
          </Field>
          <Field label="From (optional)">
            <input className="lf-input" name="from" type="date" />
          </Field>
          <Field label="Until (optional)">
            <input className="lf-input" name="to" type="date" />
          </Field>
          <Field label="Reason (for the audit log)">
            <input className="lf-input" name="reason" placeholder="why this changed" />
          </Field>
          <button type="submit" className="lf-btn" disabled={busy}>
            Save limit
          </button>
        </form>

        <div className="lf-actionrow" style={{ paddingTop: 12 }}>
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            disabled={busy || !s.overridden}
            onClick={() => void send({ reset: true, reason: 'override removed from the console' })}
          >
            Reset override
          </button>
          {s.disabled ? (
            <button
              type="button"
              className="lf-btn"
              disabled={busy}
              onClick={() => void send({ reset: true, reason: 'AI re-enabled from the console' })}
            >
              Re-enable AI
            </button>
          ) : (
            <button
              type="button"
              className="lf-btn lf-btn--ghost"
              disabled={busy}
              onClick={() =>
                void send({ tokenLimit: 0, action: 'BLOCK', hardLimit: true, reason: 'AI disabled from the console' })
              }
            >
              Temporarily disable AI
            </button>
          )}
        </div>
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 4 }}>
          Why this account is consuming tokens
        </h2>
        <p className="lf-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          This month, by feature and by model.
        </p>
        <WorkspaceTable
          headers={['Feature', 'Tokens', 'Requests', 'Cost']}
          rows={data.byFeature.map((f) => [f.label, nf(f.tokens), nf(f.requests), money(f.amount)])}
        />
        <h2 className="lf-h2" style={{ margin: '18px 0 12px' }}>
          Models
        </h2>
        <WorkspaceTable
          headers={['Provider', 'Model', 'Requests', 'Tokens', 'Fell back']}
          rows={data.byModel.map((m) => [m.provider, m.model, nf(m.requests), nf(m.tokens), nf(m.fallbacks)])}
        />
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 12 }}>
          Month by month
        </h2>
        {data.months.length === 0 ? (
          <p className="lf-muted" style={{ margin: 0 }}>
            No AI activity recorded for this account.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 90, marginBottom: 12 }}>
              {data.months.map((m) => {
                const top = Math.max(...data.months.map((x) => x.tokens), 1);
                return (
                  <span key={m.month} style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: Math.max(2, Math.round((m.tokens / top) * 70)),
                        background: 'var(--lf-viridian)',
                        borderRadius: 3,
                      }}
                    />
                    <span className="lf-muted" style={{ fontSize: 10 }}>
                      {m.month.slice(5)}
                    </span>
                  </span>
                );
              })}
            </div>
            <WorkspaceTable
              headers={['Month', 'Tokens', 'Requests', 'Cost']}
              rows={data.months.map((m) => [m.month, nf(m.tokens), nf(m.requests), money(m.amount)])}
            />
          </>
        )}
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 12 }}>
          Most recent AI requests
        </h2>
        <WorkspaceTable
          headers={['When', 'Feature', 'Model', 'Tokens', 'Outcome', 'Reason']}
          rows={data.recent.map((r) => [
            ago(r.occurredAt),
            r.feature,
            r.model ?? '—',
            nf(r.tokens),
            r.outcome.replace(/_/g, ' ').toLowerCase(),
            r.reason ?? '—',
          ])}
        />
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="lf-field" style={{ minWidth: 150 }}>
      <span className="lf-label">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="lf-muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <div className="lf-muted" style={{ fontSize: 12 }}>
        {hint}
      </div>
    </div>
  );
}
