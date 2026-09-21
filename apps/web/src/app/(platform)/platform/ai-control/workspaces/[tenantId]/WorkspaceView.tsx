'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import Badge from '@/components/ui/Badge';
import type { WorkspaceDetail } from '@/services/ai/console';
import { STATUS_LABEL, STATUS_TONE, SOURCE_LABEL, UsageBar, nf, money, ago } from '../../ui';

/**
 * One company's AI consumption, and the controls over it.
 *
 * Three things in one place on purpose: what the company as a whole has spent,
 * the ceilings an operator can move, and every person inside it with their own
 * allowance beside their usage. Sending an operator to a separate settings page
 * to change a number they are looking at is how a ceiling ends up set from
 * memory.
 */
export default function WorkspaceView(data: WorkspaceDetail) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState('all');
  const [feature, setFeature] = useState('all');
  const [search, setSearch] = useState('');

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/v1/platform/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { detail?: string; title?: string; count?: number };
      if (!res.ok) throw new Error(json.detail ?? json.title ?? `Request failed (${res.status})`);
      setSaved(json.count ? `Saved for ${json.count} ${json.count === 1 ? 'person' : 'people'}.` : 'Saved.');
      setSelected([]);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const month = new Date(data.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const users = useMemo(
    () =>
      data.users.filter(
        (u) =>
          (status === 'all' || u.status === status) &&
          (feature === 'all' || u.topFeature === feature) &&
          (search.trim() === '' || u.name.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [data.users, status, feature, search],
  );
  const features = [...new Set(data.users.map((u) => u.topFeature).filter(Boolean))] as string[];
  const allShown = users.length > 0 && users.every((u) => selected.includes(u.userId));

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="AI Control Center"
        title={data.name}
        description={`AI consumption since the start of ${month}, UTC.${data.planName ? ` On the ${data.planName} plan.` : ''}`}
        breadcrumbs={[
          { label: 'Platform', href: '/platform' },
          { label: 'AI Control Center', href: '/platform/ai-control' },
          { label: 'Workspaces', href: '/platform/ai-control/workspaces' },
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
          <Stat label="Tokens used" value={nf(data.totals.tokens)} hint="sent and received" />
          <Stat
            label="Monthly allowance"
            value={data.ceiling.tokenLimit === null ? 'not set' : nf(data.ceiling.tokenLimit)}
            hint="the whole company together"
          />
          <Stat
            label="Remaining"
            value={
              data.ceiling.tokenLimit === null ? '—' : nf(Math.max(0, data.ceiling.tokenLimit - data.totals.tokens))
            }
            hint="before the ceiling"
          />
          <Stat label="Input / output" value={`${nf(data.totals.input)} / ${nf(data.totals.output)}`} hint="tokens" />
          <Stat label="Estimated cost" value={money(data.totals.amount)} hint="at the prices in force" />
          <Stat label="Requests" value={nf(data.totals.requests)} hint={`${nf(data.totals.fallbacks)} fell back`} />
          <Stat label="People using AI" value={nf(data.users.filter((u) => u.requests > 0).length)} hint="this month" />
        </div>
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 4 }}>
          Budgets for this workspace
        </h2>
        <p className="lf-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          The ceiling covers everybody together and no individual override lifts it. The per-person default is what each
          account inherits when nobody has set a number for them.
        </p>
        <form
          className="lf-actionrow"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const raw = String(f.get('ceiling') ?? '').trim();
            void send({
              resource: 'workspace-budget',
              tenantId: data.tenantId,
              kind: 'ceiling',
              tokenLimit: raw ? Number(raw) : null,
              action: f.get('action'),
              hardLimit: f.get('hardLimit') === 'on',
              reset: raw === '',
              reason: String(f.get('reason') ?? '').trim() || null,
            });
          }}
        >
          <Field label="Workspace ceiling (tokens/month)">
            <input
              className="lf-input"
              name="ceiling"
              type="number"
              min="0"
              step="100000"
              defaultValue={data.ceiling.tokenLimit ?? ''}
              placeholder="empty removes it"
            />
          </Field>
          <Field label="When reached">
            <select className="lf-input" name="action" defaultValue={data.ceiling.action}>
              <option value="ALERT_ONLY">alert only</option>
              <option value="CHEAPER_MODEL">drop to a cheaper model</option>
              <option value="BLOCK">block</option>
            </select>
          </Field>
          <Field label="Hard limit">
            <input name="hardLimit" type="checkbox" defaultChecked={data.ceiling.hardLimit} />
          </Field>
          <Field label="Reason (for the audit log)">
            <input className="lf-input" name="reason" placeholder="why this changed" />
          </Field>
          <button type="submit" className="lf-btn" disabled={busy}>
            Save ceiling
          </button>
        </form>

        <form
          className="lf-actionrow"
          style={{ alignItems: 'flex-end', paddingTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const raw = String(f.get('perUser') ?? '').trim();
            void send({
              resource: 'workspace-budget',
              tenantId: data.tenantId,
              kind: 'per-user',
              tokenLimit: raw ? Number(raw) : null,
              action: 'BLOCK',
              reset: raw === '',
              reason: String(f.get('reason2') ?? '').trim() || null,
            });
          }}
        >
          <Field label="Default per person (tokens/month)">
            <input
              className="lf-input"
              name="perUser"
              type="number"
              min="0"
              step="50000"
              defaultValue={data.perUserDefault.tokenLimit ?? ''}
              placeholder="empty falls back to the plan"
            />
          </Field>
          <Field label="Reason (for the audit log)">
            <input className="lf-input" name="reason2" placeholder="why this changed" />
          </Field>
          <button type="submit" className="lf-btn" disabled={busy}>
            Save default
          </button>
        </form>
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 4 }}>
          People
        </h2>
        <p className="lf-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Everyone who used AI this month or carries an allowance of their own. The name opens their settings.
        </p>

        <div className="lf-actionrow" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <Field label="Search">
            <input className="lf-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name" />
          </Field>
          <Field label="Status">
            <select className="lf-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">any</option>
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Top feature">
            <select className="lf-input" value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="all">any</option>
              {features.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            onClick={() => setSelected(allShown ? [] : users.map((u) => u.userId))}
            disabled={users.length === 0}
          >
            {allShown ? 'Clear selection' : 'Select all shown'}
          </button>
          <span className="lf-muted">
            {users.length} of {data.users.length}
          </span>
        </div>

        {selected.length > 0 && (
          <form
            className="lf-actionrow"
            style={{ alignItems: 'flex-end', marginBottom: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const raw = String(f.get('bulk') ?? '').trim();
              const reset = f.get('bulkReset') === 'on';
              void send({
                resource: 'bulk-user-budget',
                tenantId: data.tenantId,
                userIds: selected,
                tokenLimit: reset ? null : raw ? Number(raw) : null,
                reset,
                action: 'BLOCK',
                reason: String(f.get('bulkReason') ?? '').trim() || null,
              });
            }}
          >
            <strong style={{ alignSelf: 'center' }}>{selected.length} selected</strong>
            <Field label="Allowance (tokens/month)">
              <input className="lf-input" name="bulk" type="number" min="0" step="50000" />
            </Field>
            <Field label="Reset to the workspace default">
              <input name="bulkReset" type="checkbox" />
            </Field>
            <Field label="Reason">
              <input className="lf-input" name="bulkReason" placeholder="why this changed" />
            </Field>
            <button type="submit" className="lf-btn" disabled={busy}>
              Apply to selected
            </button>
            <button type="button" className="lf-btn lf-btn--ghost" onClick={() => setSelected([])}>
              Clear
            </button>
          </form>
        )}

        <WorkspaceTable
          headers={[
            'Select',
            'Person',
            'Role',
            'Allowance',
            'Used',
            'Remaining',
            'Usage',
            'Status',
            'In / out',
            'Cost',
            'Requests',
            'Top feature',
            'Last activity',
          ]}
          rows={users.map((u) => [
            <input
              key={`c-${u.userId}`}
              type="checkbox"
              aria-label={`Select ${u.name}`}
              checked={selected.includes(u.userId)}
              onChange={(e) =>
                setSelected((prev) => (e.target.checked ? [...prev, u.userId] : prev.filter((id) => id !== u.userId)))
              }
            />,
            <Link key={`l-${u.userId}`} href={`/platform/ai-control/workspaces/${data.tenantId}/users/${u.userId}`}>
              {u.name}
            </Link>,
            u.roleName ?? '—',
            u.allowance === null ? 'no limit' : `${nf(u.allowance)}${u.overridden ? ' (override)' : ''}`,
            nf(u.usedTokens),
            u.remaining === null ? '—' : nf(u.remaining),
            <UsageBar key={`b-${u.userId}`} percent={u.percent} />,
            <Badge key={`s-${u.userId}`} tone={STATUS_TONE[u.status]}>
              {STATUS_LABEL[u.status]}
            </Badge>,
            `${nf(u.inputTokens)} / ${nf(u.outputTokens)}`,
            money(u.amount),
            nf(u.requests),
            u.topFeature ?? '—',
            ago(u.lastActivityAt),
          ])}
        />
      </section>

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 12 }}>
          Where this company&rsquo;s tokens went
        </h2>
        <WorkspaceTable
          headers={['Feature', 'Tokens', 'Requests', 'Cost', 'Feature budget']}
          rows={data.byFeature.map((f) => {
            const budget = data.featureBudgets.find((b) => b.feature === f.feature);
            return [
              f.label,
              nf(f.tokens),
              nf(f.requests),
              money(f.amount),
              budget?.tokenLimit ? `${nf(budget.tokenLimit)} limit` : 'not set',
            ];
          })}
        />
        <h2 className="lf-h2" style={{ margin: '18px 0 12px' }}>
          Models used
        </h2>
        <WorkspaceTable
          headers={['Provider', 'Model', 'Requests', 'Tokens']}
          rows={data.byModel.map((m) => [m.provider, m.model, nf(m.requests), nf(m.tokens)])}
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

export { SOURCE_LABEL };
