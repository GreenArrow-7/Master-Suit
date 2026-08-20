/**
 * In-process metrics, in Prometheus exposition format.
 *
 * ── Why anything at all ─────────────────────────────────────────────────────
 *
 * Nothing in this application exported a metric, emitted a span, or reported an
 * exception. `docs/DEPLOY-AZURE.md` said so plainly — "docker compose logs is
 * what you have" — and the logs were not shipped anywhere either, so they died
 * with the container.
 *
 * That made a specific class of failure invisible rather than merely unpleasant:
 * the worker exiting on start and every queue going unconsumed (it did, for
 * months); a `TenantGuardError` firing, which means a repository forgot a tenant
 * filter and the *third* layer is the only thing left; a queue backing up behind
 * a wedged job. Each of those is silent, and each is discovered by a customer.
 *
 * ── Why hand-rolled ─────────────────────────────────────────────────────────
 *
 * `prom-client` would do this. So would OpenTelemetry, and OTel is where this
 * should end up when there is a collector to send to. But the exposition format
 * is a hundred lines, this codebase already hand-rolls its TOTP and speaks
 * clamd's wire protocol directly, and a dependency that pulls in a metrics
 * runtime to serve six counters is not obviously the smaller thing. The shape
 * here is deliberately the shape OTel uses, so replacing it is a swap rather
 * than a rewrite.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * Per-process, in memory, reset on restart. With more than one web replica a
 * scraper must reach each of them — which is what a Prometheus service-discovery
 * target does, and what a single-VM deployment does not need to think about yet.
 * There is no persistence and no aggregation here on purpose: a metrics endpoint
 * that keeps state is a database with worse guarantees.
 */

type Labels = Record<string, string>;

/** `name{a="1",b="2"}` — the series key, and the line Prometheus reads. */
function series(name: string, labels: Labels): string {
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    // Escaping per the exposition format: backslash, double quote, newline.
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  return pairs.length ? `${name}{${pairs.join(',')}}` : name;
}

interface Metric {
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
}

const meta = new Map<string, Metric>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

/**
 * Histogram buckets, in seconds.
 *
 * Chosen for what this application actually does rather than from a default: a
 * server-rendered page under a tenant guard is tens of milliseconds, a list with
 * three includes is hundreds, and anything past two seconds is the thing worth
 * alerting on. The tail matters more than the middle here.
 */
const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

interface Histogram {
  counts: number[];
  sum: number;
  total: number;
}
const histograms = new Map<string, Histogram>();

/**
 * Bounded, because a label set built from anything a caller controls is an
 * unbounded-cardinality memory leak wearing a metrics hat. Route module/action
 * pairs are a closed set declared in code, so this is a backstop rather than an
 * expectation — but a backstop that stops the process eating memory is worth the
 * six lines.
 */
const MAX_SERIES = 2_000;

function register(name: string, help: string, type: Metric['type']) {
  if (!meta.has(name)) meta.set(name, { help, type });
}

export function increment(name: string, labels: Labels = {}, by = 1) {
  register(name, HELP[name] ?? name, 'counter');
  const key = series(name, labels);
  if (!counters.has(key) && counters.size >= MAX_SERIES) return;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function setGauge(name: string, value: number, labels: Labels = {}) {
  register(name, HELP[name] ?? name, 'gauge');
  const key = series(name, labels);
  if (!gauges.has(key) && gauges.size >= MAX_SERIES) return;
  gauges.set(key, value);
}

export function observe(name: string, seconds: number, labels: Labels = {}) {
  register(name, HELP[name] ?? name, 'histogram');
  const key = series(name, labels);
  let h = histograms.get(key);
  if (!h) {
    if (histograms.size >= MAX_SERIES) return;
    h = { counts: new Array(BUCKETS.length).fill(0), sum: 0, total: 0 };
    histograms.set(key, h);
  }
  h.sum += seconds;
  h.total += 1;
  for (let i = 0; i < BUCKETS.length; i += 1) {
    if (seconds <= BUCKETS[i]!) h.counts[i] += 1;
  }
}

/** One place for the text, so HELP lines cannot drift from what is measured. */
const HELP: Record<string, string> = {
  masterapp_requests_total: 'API requests handled, by module, action and status class.',
  masterapp_request_duration_seconds: 'API request duration in seconds, by module and action.',
  masterapp_errors_total: 'Requests that ended in an error response, by code and status.',
  masterapp_tenant_guard_trips_total:
    'Queries refused by the Prisma tenant guard. Any value above zero is a repository missing a tenant filter — alert on this.',
  masterapp_queue_depth: 'Jobs waiting in a BullMQ queue.',
  masterapp_queue_active: 'Jobs currently being processed in a BullMQ queue.',
  masterapp_queue_failed: 'Jobs in a queue’s failed set.',
  masterapp_queue_oldest_waiting_seconds:
    'Age of the oldest waiting job. Rising steadily means the queue has no consumer — this is the signal the dead worker would have shown.',
  masterapp_queue_workers: 'Consumers attached to a queue. Zero on a live queue means nothing is draining it.',
  masterapp_queue_deferred_total:
    'Jobs pushed back because their tenant was at its per-tenant concurrency ceiling. Not an error — a sustained rate means that ceiling is the binding constraint for someone.',
  masterapp_ai_tokens_total: 'Gemini tokens consumed, by feature and whose key paid for them.',
  masterapp_up: 'Always 1. Present so a scrape that returns no series is distinguishable from a process that is down.',
  masterapp_table_rows_estimate:
    'Estimated rows in a table that grows with usage and is swept by nothing. From pg_class.reltuples, not count(*).',
  masterapp_table_bytes: 'Total size of a table including its indexes and TOAST.',
  masterapp_platform_write_grants:
    'Break-glass grants of write access into a customer workspace that are live right now. Steady state is zero.',
  masterapp_build_info:
    'Always 1. The labels are the payload: which commit this process is running, and when it was built.',
};

/** The whole registry, rendered. */
export function render(): string {
  const lines: string[] = [];
  const emitted = new Set<string>();

  const header = (name: string) => {
    if (emitted.has(name)) return;
    emitted.add(name);
    const m = meta.get(name);
    if (!m) return;
    lines.push(`# HELP ${name} ${m.help}`);
    lines.push(`# TYPE ${name} ${m.type}`);
  };
  const nameOf = (key: string) => key.split('{')[0]!;

  for (const [key, value] of [...counters].sort()) {
    header(nameOf(key));
    lines.push(`${key} ${value}`);
  }
  for (const [key, value] of [...gauges].sort()) {
    header(nameOf(key));
    lines.push(`${key} ${value}`);
  }
  for (const [key, h] of [...histograms].sort()) {
    const name = nameOf(key);
    header(name);
    const labels = key.slice(name.length).replace(/^\{|\}$/g, '');
    const withLe = (le: string) => `${name}_bucket{${labels ? `${labels},` : ''}le="${le}"}`;
    for (let i = 0; i < BUCKETS.length; i += 1) lines.push(`${withLe(String(BUCKETS[i]))} ${h.counts[i]}`);
    lines.push(`${withLe('+Inf')} ${h.total}`);
    lines.push(`${name}_sum${labels ? `{${labels}}` : ''} ${h.sum}`);
    lines.push(`${name}_count${labels ? `{${labels}}` : ''} ${h.total}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Test seam. Metrics are process-global by nature; specs need a clean slate. */
export function __resetMetricsForTests() {
  counters.clear();
  gauges.clear();
  histograms.clear();
  meta.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// The named signals the assessment asked for, so call sites do not spell out
// metric names and label shapes at each of them.
// ─────────────────────────────────────────────────────────────────────────────

/** `2xx`, `4xx`, `5xx` — a class rather than a code, to keep cardinality flat. */
const statusClass = (status: number) => `${Math.floor(status / 100)}xx`;

export function recordRequest(module: string, action: string, status: number, ms: number) {
  increment('masterapp_requests_total', { module, action, status: statusClass(status) });
  observe('masterapp_request_duration_seconds', ms / 1000, { module, action });
}

export function recordError(module: string, action: string, code: string, status: number) {
  increment('masterapp_errors_total', { module, action, code, status: String(status) });
}

/**
 * A repository issued a query with no tenant filter and layer 2 refused it.
 *
 * This is the one metric in this file that should be alerted on at *any* value
 * above zero. It does not mean data leaked — the guard is doing its job, and
 * Postgres would have refused it after — but it means a query reached the
 * database layer relying on RLS alone, and the next one like it might touch a
 * table where the policy is wrong. That has happened once already, on
 * HrOvertimeRequest.
 */
export function recordTenantGuardTrip(model: string, operation: string) {
  increment('masterapp_tenant_guard_trips_total', { model, operation });
}

/**
 * A job was pushed back to the delayed set because its tenant already held its
 * share of the worker.
 *
 * Deliberately labelled by queue and not by tenant: a per-tenant series here
 * would grow without bound with the customer list. This is the platform-wide
 * curve, and a sustained rate is the signal to raise the ceiling — or to look at
 * which workspace is generating that much work, which the database can answer.
 */
/**
 * Which commit is serving.
 *
 * Nothing could answer that before. Deployments built from the working tree on
 * the VM, so the only record of what was running was whatever `git log` said on
 * the host at the moment you looked — which is the *next* release as soon as
 * somebody has pulled. During an incident that is the first question and there
 * was no way to ask it.
 *
 * `_info` metrics are the Prometheus convention for this: the value is always 1
 * and the labels carry the payload, so `masterapp_build_info` joins onto any
 * other series by instance. It lives on the token-gated metrics endpoint rather
 * than on `/api/health`, which is unauthenticated and deliberately reveals no
 * versions — a build number is free reconnaissance to anyone who can read a
 * changelog.
 *
 * Stamped into the image by infra/Dockerfile from a build arg. `unknown` means
 * the image was built outside scripts/release.sh, which is itself worth seeing.
 */
export function setBuildInfo() {
  setGauge('masterapp_build_info', 1, {
    commit: process.env.BUILD_COMMIT ?? 'unknown',
    built_at: process.env.BUILD_TIME ?? 'unknown',
    role: process.env.PROCESS_ROLE ?? 'web',
  });
}

export function recordQueueDeferred(queue: string) {
  increment('masterapp_queue_deferred_total', { queue });
}

export function recordAiTokens(feature: string, keySource: string, tokens: number) {
  increment('masterapp_ai_tokens_total', { feature, key_source: keySource }, tokens);
}
