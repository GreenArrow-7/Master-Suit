'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import type { AiControlData } from './data';

/**
 * The AI Control Center's presentation.
 *
 * Four things an operator can change without a deploy: what a model costs, what
 * a company or feature may spend, which safety rules apply, and which models a
 * feature tries in what order. Each section states what is in force now before
 * it offers the form to change it — the figure and the control in one place,
 * because a budget screen that shows a limit without the spend beside it is the
 * reason nobody notices a ceiling until it refuses something.
 *
 * Pure presentation plus form submission: it reads no database and makes no
 * authorization decision. Every write goes to `/api/v1/platform/ai`, which does.
 */
const nf = new Intl.NumberFormat('en-GB');
const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

type Tab = 'tokenomics' | 'budgets' | 'guardrails' | 'routing';

export default function AiControlView(data: AiControlData) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('tokenomics');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>, method: 'POST' | 'DELETE' = 'POST') {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/v1/platform/ai', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
      if (!res.ok) throw new Error(json.detail ?? json.title ?? `Request failed (${res.status})`);
      setSaved('Saved.');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabs: [Tab, string][] = [
    ['tokenomics', 'Tokenomics'],
    ['budgets', 'Budgets'],
    ['guardrails', 'Guardrails'],
    ['routing', 'Model routing'],
  ];

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Commercial"
        title="AI Control Center"
        description={`Prices, budgets, guardrails and model routing. Figures cover the last ${data.summary.days} days.`}
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'AI Control Center' }]}
      />

      <section className="lf-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
          <Stat label="Requests" value={nf.format(data.summary.requests)} hint={`last ${data.summary.days} days`} />
          <Stat label="Tokens" value={nf.format(data.summary.tokens)} hint="sent and received" />
          <Stat label="Cost" value={money(data.summary.amount, data.summary.currency)} hint="at the prices in force" />
          <Stat label="Fell back" value={nf.format(data.summary.fallbacks)} hint="answered on a later model" />
          <Stat label="Failed" value={nf.format(data.summary.failures)} hint="no answer from any model" />
          <Stat label="Refused" value={nf.format(data.summary.blocked)} hint="by a guardrail or a budget" />
          {data.summary.unpriced > 0 && (
            <Stat label="Unpriced" value={nf.format(data.summary.unpriced)} hint="no price set for that model" />
          )}
        </div>
      </section>

      {/* `lf-btn` rather than the workspace shell's tab strip: that strip is
          styled inside the workspace surface and arrives here unstyled, which
          ran the four labels together into one word. */}
      <nav className="lf-actionrow" aria-label="AI Control Center sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'lf-btn' : 'lf-btn lf-btn--ghost'}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="lf-alert" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="lf-muted">{saved}</p>}

      {tab === 'tokenomics' && <Tokenomics data={data} send={send} busy={busy} />}
      {tab === 'budgets' && <Budgets data={data} send={send} busy={busy} />}
      {tab === 'guardrails' && <Guardrails data={data} send={send} busy={busy} />}
      {tab === 'routing' && <Routing data={data} send={send} busy={busy} />}
    </div>
  );
}

type SectionProps = {
  data: AiControlData;
  send: (payload: Record<string, unknown>, method?: 'POST' | 'DELETE') => Promise<void>;
  busy: boolean;
};

function Tokenomics({ data, send, busy }: SectionProps) {
  return (
    <>
      <Card
        title="Where the money goes"
        help="Spend per feature at the prices in force when each request was made. Changing a price today never rewrites yesterday’s cost."
      >
        <WorkspaceTable
          headers={['Feature', 'Requests', 'Tokens', 'Cost', 'Fell back', 'Failed']}
          rows={data.bySpend.map((r) => [
            r.label,
            nf.format(r.requests),
            nf.format(r.tokens),
            money(r.amount),
            nf.format(r.fallbacks),
            nf.format(r.failures),
          ])}
        />
      </Card>

      <Card
        title="Model prices"
        help="What each provider charges per million tokens, with the date the price took effect. A model with no price is recorded at zero cost and counted as unpriced rather than guessed at."
      >
        <WorkspaceTable
          headers={['Provider', 'Model', 'Input / M', 'Output / M', 'In force from', '']}
          rows={data.prices.map((p) => [
            p.provider,
            p.current ? `${p.model} (current)` : p.model,
            money(p.inputPerM, p.currency),
            money(p.outputPerM, p.currency),
            new Date(p.effectiveFrom).toLocaleDateString('en-GB'),
            <button
              key={p.id}
              type="button"
              className="lf-btn lf-btn--ghost"
              disabled={busy}
              onClick={() => send({ resource: 'price', id: p.id }, 'DELETE')}
            >
              Remove
            </button>,
          ])}
        />
        <form
          className="lf-actionrow"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void send({
              resource: 'price',
              provider: f.get('provider'),
              model: String(f.get('model') ?? '').trim(),
              inputPerM: Number(f.get('inputPerM')),
              outputPerM: Number(f.get('outputPerM')),
              currency: 'USD',
              effectiveFrom: new Date(String(f.get('effectiveFrom'))).toISOString(),
            });
          }}
        >
          <Field label="Provider">
            <select className="lf-input" name="provider" defaultValue="google">
              {data.providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <input className="lf-input" name="model" required placeholder="gemini-2.5-flash" />
          </Field>
          <Field label="Input per million">
            <input className="lf-input" name="inputPerM" type="number" step="0.000001" min="0" required />
          </Field>
          <Field label="Output per million">
            <input className="lf-input" name="outputPerM" type="number" step="0.000001" min="0" required />
          </Field>
          <Field label="In force from">
            <input
              className="lf-input"
              name="effectiveFrom"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <button type="submit" className="lf-btn" disabled={busy}>
            Save price
          </button>
        </form>
      </Card>

      {data.recentBlocks.length > 0 && (
        <Card title="Refused and failed" help="The most recent requests that did not produce an answer.">
          <WorkspaceTable
            headers={['When', 'Feature', 'What happened', 'Reason']}
            rows={data.recentBlocks.map((b) => [
              new Date(b.occurredAt).toLocaleString('en-GB'),
              b.feature,
              b.kind.replace(/_/g, ' ').toLowerCase(),
              b.reason ?? '—',
            ])}
          />
        </Card>
      )}
    </>
  );
}

function Budgets({ data, send, busy }: SectionProps) {
  return (
    <Card
      title="Token and cost budgets"
      help="The narrowest ceiling that names a request wins — a company budget overrides the plan it is on, a person’s overrides both. Alert-only budgets warn and never refuse."
    >
      <WorkspaceTable
        headers={['Applies to', 'Feature', 'Period', 'Limit', 'Used', 'At limit', 'Action', '']}
        rows={data.budgets.map((b) => [
          b.scopeLabel,
          b.feature ?? 'all',
          b.period.toLowerCase(),
          [
            b.tokenLimit === null ? null : `${nf.format(b.tokenLimit)} tokens`,
            b.costLimit === null ? null : money(b.costLimit, b.currency),
          ]
            .filter(Boolean)
            .join(' · '),
          `${nf.format(b.usedTokens)} · ${money(b.usedAmount, b.currency)}`,
          b.percent === null ? '—' : `${b.percent}%${b.exceeded ? ' — reached' : ''}`,
          b.hardLimit ? 'block (hard)' : b.action.replace(/_/g, ' ').toLowerCase(),
          <button
            key={b.id}
            type="button"
            className="lf-btn lf-btn--ghost"
            disabled={busy}
            onClick={() => send({ resource: 'budget', id: b.id }, 'DELETE')}
          >
            Remove
          </button>,
        ])}
      />
      <form
        className="lf-actionrow"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const tokens = String(f.get('tokenLimit') ?? '').trim();
          const cost = String(f.get('costLimit') ?? '').trim();
          void send({
            resource: 'budget',
            scope: f.get('scope'),
            scopeId: String(f.get('scopeId') ?? '').trim() || null,
            feature: String(f.get('feature') ?? '') || null,
            tokenLimit: tokens ? Number(tokens) : null,
            costLimit: cost ? Number(cost) : null,
            period: f.get('period'),
            action: f.get('action'),
            hardLimit: f.get('hardLimit') === 'on',
          });
        }}
      >
        <Field label="Applies to">
          <select className="lf-input" name="scope" defaultValue="PLATFORM">
            {['PLATFORM', 'PROVIDER', 'PLAN', 'TENANT', 'FEATURE', 'USER'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Which one (id or key)">
          <input className="lf-input" name="scopeId" placeholder="leave empty for the whole platform" />
        </Field>
        <Field label="Feature (optional)">
          <select className="lf-input" name="feature" defaultValue="">
            <option value="">all features</option>
            {data.features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Token limit">
          <input className="lf-input" name="tokenLimit" type="number" min="0" step="1000" />
        </Field>
        <Field label="Cost limit (USD)">
          <input className="lf-input" name="costLimit" type="number" min="0" step="0.01" />
        </Field>
        <Field label="Period">
          <select className="lf-input" name="period" defaultValue="MONTHLY">
            <option value="MONTHLY">monthly</option>
            <option value="DAILY">daily</option>
          </select>
        </Field>
        <Field label="When reached">
          <select className="lf-input" name="action" defaultValue="ALERT_ONLY">
            <option value="ALERT_ONLY">alert only</option>
            <option value="CHEAPER_MODEL">drop to a cheaper model</option>
            <option value="DISABLE_OPTIONAL">disable optional features</option>
            <option value="REQUIRE_APPROVAL">require approval</option>
            <option value="BLOCK">block</option>
          </select>
        </Field>
        <Field label="Hard limit">
          <input name="hardLimit" type="checkbox" />
        </Field>
        <button type="submit" className="lf-btn" disabled={busy}>
          Save budget
        </button>
      </form>
    </Card>
  );
}

function Guardrails({ data, send, busy }: SectionProps) {
  return (
    <Card
      title="Guardrails"
      help="Applied at the one seam every model request crosses. A mandatory rule may be made stricter and never switched off."
    >
      <div className="lf-stack">
        {data.guardrails.map((g) => (
          <form
            key={g.key}
            className="lf-actionrow"
            style={{ alignItems: 'flex-end', paddingBlock: 10, borderTop: '1px solid var(--lf-line)' }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const config: Record<string, number> = {};
              for (const name of Object.keys(g.config)) config[name] = Number(f.get(name));
              void send({
                resource: 'guardrail',
                key: g.key,
                scope: 'PLATFORM',
                // A disabled checkbox sends nothing, so reading the form for a
                // mandatory rule said "switch it off" — which the route rightly
                // refuses with a 422, leaving the operator unable to change the
                // one number beside it.
                enabled: g.locked ? true : f.get('enabled') === 'on',
                config,
              });
            }}
          >
            <div style={{ flex: '1 1 320px' }}>
              <strong>{g.label}</strong>
              <p className="lf-muted" style={{ margin: '4px 0 0' }}>
                {g.help}
              </p>
              <p className="lf-muted" style={{ margin: '4px 0 0' }}>
                In force from the {g.source}
                {g.locked ? ' · mandatory' : ''}
              </p>
            </div>
            <Field label="On">
              <input type="checkbox" name="enabled" defaultChecked={g.enabled} disabled={g.locked} />
            </Field>
            {Object.entries(g.config).map(([name, value]) => (
              <Field key={name} label={name === 'chars' ? 'Characters' : 'Requests per minute'}>
                <input name={name} type="number" min="1" defaultValue={value} />
              </Field>
            ))}
            <button type="submit" className="lf-btn" disabled={busy}>
              Save
            </button>
          </form>
        ))}
      </div>
    </Card>
  );
}

function Routing({ data, send, busy }: SectionProps) {
  return (
    <Card
      title="Model routing and fallback"
      help="The chain a feature tries, in order, and what moves it to the next model. A feature with no chain uses the deployment’s primary model and its configured fallback."
    >
      <div className="lf-stack">
        {data.routes.map((r) => (
          <form
            key={r.feature}
            className="lf-actionrow"
            style={{ alignItems: 'flex-end', paddingBlock: 10, borderTop: '1px solid var(--lf-line)' }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const steps = String(f.get('models') ?? '')
                .split(',')
                .map((m) => m.trim())
                .filter(Boolean)
                .map((model) => ({ provider: String(f.get('provider')), model }));
              void send({
                resource: 'route',
                feature: r.feature,
                strategy: f.get('strategy'),
                steps,
                fallbackTriggers: ['TIMEOUT', 'RATE_LIMIT', 'PROVIDER_5XX'],
                deterministicFallback: true,
                enabled: true,
              });
            }}
          >
            <div style={{ flex: '1 1 260px' }}>
              <strong>{r.label}</strong>
              <p className="lf-muted" style={{ margin: '4px 0 0' }}>
                {r.configured ? 'Configured here' : 'Using the deployment default'} ·{' '}
                {r.steps.map((s) => s.model).join(' → ')}
              </p>
            </div>
            <Field label="Provider">
              <select className="lf-input" name="provider" defaultValue={r.steps[0]?.provider ?? 'google'}>
                {data.providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Models, best first">
              <input
                className="lf-input"
                name="models"
                defaultValue={r.steps.map((s) => s.model).join(', ')}
                style={{ minWidth: 260 }}
              />
            </Field>
            <Field label="Strategy">
              <select className="lf-input" name="strategy" defaultValue={r.strategy}>
                <option value="QUALITY_FIRST">quality first</option>
                <option value="BALANCED">balanced</option>
                <option value="COST_OPTIMIZED">cost optimised</option>
              </select>
            </Field>
            <button type="submit" className="lf-btn" disabled={busy}>
              Save chain
            </button>
          </form>
        ))}
      </div>
    </Card>
  );
}

function Card({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className="lf-card" style={{ padding: 18 }}>
      <h2 className="lf-h2" style={{ marginBottom: 4 }}>
        {title}
      </h2>
      <p className="lf-muted" style={{ marginTop: 0, marginBottom: 12 }}>
        {help}
      </p>
      {children}
    </section>
  );
}

/**
 * One labelled control. The class names are the console's own — `lf-field`,
 * `lf-label`, `lf-input` — so a control added here inherits the focus ring, the
 * invalid state and the dark theme the rest of the platform already has, rather
 * than growing a second set beside them.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
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
