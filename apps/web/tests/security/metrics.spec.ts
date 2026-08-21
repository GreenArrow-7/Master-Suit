/**
 * P1-1 — nothing in this application exported a metric.
 *
 * `docs/DEPLOY-AZURE.md` said it plainly: "No metrics, traces or error
 * reporting. docker compose logs is what you have." And the logs were not
 * shipped anywhere either, so they died with the container.
 *
 * The two signals worth reading here are the ones that would have caught real
 * defects this codebase actually had:
 *
 *   * `masterapp_queue_workers` — the worker container exited on start for
 *     months and nothing in the web process knew. A counter maintained by the
 *     enqueue path would have looked healthy throughout; only asking Redis
 *     "is anything attached to this queue" shows it.
 *   * `masterapp_tenant_guard_trips_total` — a repository issuing a query with
 *     no tenant filter. It does not mean data leaked, the guard refused it; it
 *     means the query reached the database relying on RLS alone, and the next
 *     one like it might hit a table whose policy is wrong. That has happened
 *     once already, on HrOvertimeRequest.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMetricsForTests,
  increment,
  observe,
  recordError,
  recordRequest,
  recordTenantGuardTrip,
  render,
  setGauge,
} from '@/lib/metrics';
import { GET as metricsRoute } from '@/app/api/metrics/route';
import { secretAgeDays } from '@/lib/metrics';

const scrape = (token?: string) =>
  metricsRoute(
    new Request('http://localhost/api/metrics', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );

beforeEach(() => __resetMetricsForTests());
afterEach(() => {
  delete process.env.METRICS_TOKEN;
});

describe('the endpoint', () => {
  it('is absent when no token is configured, rather than refusing', async () => {
    // 404, not 401. An endpoint that is absent cannot be probed for how it
    // responds to a wrong credential — the same shape as /api/v1/dev/outbox.
    const response = await scrape('anything');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('refuses a wrong token', async () => {
    process.env.METRICS_TOKEN = 'the-real-token';
    expect((await scrape('not-the-token')).status).toBe(404);
    expect((await scrape()).status).toBe(404);
  });

  it('refuses a token that is merely a prefix of the real one', async () => {
    process.env.METRICS_TOKEN = 'the-real-token';
    expect((await scrape('the-real-toke')).status).toBe(404);
    expect((await scrape('the-real-token-and-more')).status).toBe(404);
  });

  it('serves the exposition format to a correct token', async () => {
    process.env.METRICS_TOKEN = 'the-real-token';
    const response = await scrape('the-real-token');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-type')).toContain('version=0.0.4');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('always emits masterapp_up, so an empty scrape is distinguishable from a dead process', async () => {
    process.env.METRICS_TOKEN = 'the-real-token';
    const body = await (await scrape('the-real-token')).text();
    expect(body).toContain('masterapp_up 1');
  });

  it('reports which commit is answering', async () => {
    // The first question during an incident, and one this deployment could not
    // answer at all: images were built from the working tree on the VM, so the
    // only record of what was running was `git log` on the host — which is the
    // next release the moment somebody pulls.
    process.env.METRICS_TOKEN = 'the-real-token';
    process.env.BUILD_COMMIT = 'abc123def456';
    process.env.BUILD_TIME = '2026-08-20T12:00:00Z';
    try {
      const body = await (await scrape('the-real-token')).text();
      expect(body).toContain('commit="abc123def456"');
      expect(body).toContain('built_at="2026-08-20T12:00:00Z"');
    } finally {
      delete process.env.BUILD_COMMIT;
      delete process.env.BUILD_TIME;
    }
  });

  it('says unknown rather than nothing for an image built outside the release script', async () => {
    // Absence would look like the metric was not implemented. `unknown` is a
    // fact worth seeing: this image did not come through scripts/release.sh.
    process.env.METRICS_TOKEN = 'the-real-token';
    delete process.env.BUILD_COMMIT;
    const body = await (await scrape('the-real-token')).text();
    expect(body).toContain('commit="unknown"');
  });

  it('reports the size of the tables nothing sweeps', async () => {
    // AuditLog, HrAttendancePunch and PlatformAuditEvent are append-only and the
    // retention job does not touch them — deleting an audit trail is a
    // compliance decision, not an engineering one. So growth is reported rather
    // than assumed away, which makes "when do we need to partition" a graph.
    process.env.METRICS_TOKEN = 'the-real-token';
    const body = await (await scrape('the-real-token')).text();
    for (const table of ['AuditLog', 'HrAttendancePunch', 'PlatformAuditEvent']) {
      expect(body).toContain(`masterapp_table_rows_estimate{table="${table}"}`);
      expect(body).toContain(`masterapp_table_bytes{table="${table}"}`);
    }
  });

  it('publishes the age of the face-service token, and the threshold beside it', async () => {
    // The face sidecar's only authentication is one bearer token, and until it
    // could accept an outgoing token alongside the current one there was no way
    // to change it without failing every check-in mid-shift. The mechanism
    // exists; this gauge and FaceServiceTokenStale are what make anyone use it.
    process.env.METRICS_TOKEN = 'the-real-token';
    const body = await (await scrape('the-real-token')).text();
    expect(body).toContain('masterapp_secret_age_days{secret="face_service_token"}');
    // The threshold travels with the metric so the rule file — mounted read-only
    // — carries no hard-coded number.
    expect(body).toContain('masterapp_secret_max_age_days{secret="face_service_token"}');
  });

  it('publishes the retention window on each append-only table, zero when none is set', async () => {
    // The three tables grow forever and nothing deleted from them until the
    // sweep learned to — but only when given a number, and that number is a
    // compliance answer. "Nobody has decided" is a real state; this is what
    // stops it being an invisible one. Zero is unambiguous because the schema
    // floors a real window at 30 days.
    process.env.METRICS_TOKEN = 'the-real-token';
    const body = await (await scrape('the-real-token')).text();
    for (const table of ['AuditLog', 'HrAttendancePunch', 'PlatformAuditEvent']) {
      expect(body).toContain(`masterapp_retention_window_days{table="${table}"}`);
    }
  });

  it("reports the database's connection budget, which is what says the pooler is needed", async () => {
    // The PgBouncer overlay ships verified-safe and opt-in, and its own comments
    // estimate the headroom at roughly a thousand organizations. An estimate is
    // what you use when nothing measures — so turning it on, or leaving it off,
    // was a guess in both directions until this.
    process.env.METRICS_TOKEN = 'the-real-token';
    const body = await (await scrape('the-real-token')).text();
    expect(body).toMatch(/masterapp_db_connections_total \d+/);
    // The limit travels with the reading so the alert carries no hard-coded
    // number and a raised max_connections is respected.
    expect(body).toMatch(/masterapp_db_connections_max \d+/);
    // At least this process's own connection is active while it answers.
    expect(body).toContain('masterapp_db_connections{state=');
  });

  it('reports every queue, including the ones with no consumer', async () => {
    process.env.METRICS_TOKEN = 'the-real-token';
    const body = await (await scrape('the-real-token')).text();

    // The signal that would have caught the dead worker. `ai`, `media` and
    // `webhook` are the three whose absence costs the most.
    for (const queue of ['ai', 'media', 'webhook', 'maintenance', 'notifications']) {
      expect(body).toContain(`masterapp_queue_workers{queue="${queue}"}`);
      expect(body).toContain(`masterapp_queue_depth{queue="${queue}"}`);
      expect(body).toContain(`masterapp_queue_oldest_waiting_seconds{queue="${queue}"}`);
    }
  });
});

describe('exposition format', () => {
  it('emits HELP and TYPE once per metric, whatever the label count', () => {
    increment('masterapp_requests_total', { module: 'leads', action: 'VIEW', status: '2xx' });
    increment('masterapp_requests_total', { module: 'calls', action: 'VIEW', status: '2xx' });
    const out = render();
    expect(out.match(/# HELP masterapp_requests_total/g)).toHaveLength(1);
    expect(out.match(/# TYPE masterapp_requests_total counter/g)).toHaveLength(1);
  });

  it('sorts labels, so one series cannot appear under two keys', () => {
    increment('masterapp_requests_total', { status: '2xx', module: 'leads', action: 'VIEW' });
    increment('masterapp_requests_total', { module: 'leads', action: 'VIEW', status: '2xx' });
    const out = render();
    expect(out).toContain('masterapp_requests_total{action="VIEW",module="leads",status="2xx"} 2');
  });

  it('escapes label values rather than emitting a broken line', () => {
    increment('masterapp_errors_total', { module: 'a"b', action: 'c\\d', code: 'e\nf', status: '500' });
    const out = render();
    expect(out).toContain('a\\"b');
    expect(out).toContain('c\\\\d');
    expect(out).toContain('e\\nf');
    // One line per series, whatever was in the labels.
    expect(out.split('\n').filter((l) => l.startsWith('masterapp_errors_total{'))).toHaveLength(1);
  });

  it('renders a histogram with cumulative buckets, a sum and a count', () => {
    observe('masterapp_request_duration_seconds', 0.02, { module: 'leads', action: 'VIEW' });
    observe('masterapp_request_duration_seconds', 0.4, { module: 'leads', action: 'VIEW' });
    const out = render();
    // 0.02 falls in every bucket from 0.025 up; 0.4 from 0.5 up. Cumulative.
    expect(out).toContain('le="0.01"} 0');
    expect(out).toContain('le="0.025"} 1');
    expect(out).toContain('le="0.5"} 2');
    expect(out).toContain('le="+Inf"} 2');
    expect(out).toMatch(/masterapp_request_duration_seconds_count\{[^}]*\} 2/);
    expect(out).toMatch(/masterapp_request_duration_seconds_sum\{[^}]*\} 0\.42/);
  });

  it('keeps status a class rather than a code, so cardinality stays flat', () => {
    recordRequest('leads', 'VIEW', 404, 12);
    recordRequest('leads', 'VIEW', 409, 12);
    const out = render();
    expect(out).toContain('status="4xx"} 2');
    expect(out).not.toContain('status="404"');
  });

  it('gauges replace rather than accumulate', () => {
    setGauge('masterapp_queue_depth', 5, { queue: 'ai' });
    setGauge('masterapp_queue_depth', 2, { queue: 'ai' });
    expect(render()).toContain('masterapp_queue_depth{queue="ai"} 2');
  });
});

describe('the signals that matter', () => {
  it('counts a tenant guard trip by model and operation', () => {
    recordTenantGuardTrip('Lead', 'findMany');
    recordTenantGuardTrip('Lead', 'findMany');
    recordTenantGuardTrip('Call', 'update');
    const out = render();
    expect(out).toContain('masterapp_tenant_guard_trips_total{model="Lead",operation="findMany"} 2');
    expect(out).toContain('masterapp_tenant_guard_trips_total{model="Call",operation="update"} 1');
    // The HELP text is where the alerting rule lives, so it is asserted too.
    expect(out).toMatch(/# HELP masterapp_tenant_guard_trips_total .*alert on this/);
  });

  it('counts a deferred job by queue and not by tenant', async () => {
    const { recordQueueDeferred } = await import('@/lib/metrics');
    recordQueueDeferred('ai');
    recordQueueDeferred('ai');
    const out = render();
    expect(out).toContain('masterapp_queue_deferred_total{queue="ai"} 2');
    // A per-tenant label here would grow without bound with the customer list.
    expect(out).not.toMatch(/masterapp_queue_deferred_total\{[^}]*tenant/);
  });

  it('separates errors by code, so a 500 spike is distinguishable from a 403 one', () => {
    recordError('leads', 'VIEW', 'forbidden', 403);
    recordError('leads', 'VIEW', 'internal-error', 500);
    const out = render();
    expect(out).toContain('code="forbidden",module="leads",status="403"');
    expect(out).toContain('code="internal-error",module="leads",status="500"');
  });
});

describe('secret age', () => {
  const DAY = 86_400_000;
  const now = Date.parse('2026-08-20T12:00:00Z');

  it('counts whole days since the stamp', () => {
    expect(secretAgeDays('2026-08-10', 91, now)).toBe(10);
  });

  it('reports a deployment that has never rotated as overdue, not as nothing', () => {
    // The alternative is skipping the series, and a missing series looks exactly
    // like a scrape that failed — which would leave the alert green forever on
    // precisely the deployments where the token is oldest.
    expect(secretAgeDays(undefined, 91, now)).toBe(91);
    expect(secretAgeDays('', 91, now)).toBe(91);
  });

  it('treats an unparseable stamp the same way', () => {
    expect(secretAgeDays('not-a-date', 91, now)).toBe(91);
    expect(secretAgeDays('2026-13-45', 91, now)).toBe(91);
  });

  it('never reports a negative age', () => {
    // A stamp in the future is somebody's clock. Reported as zero rather than a
    // negative number, which would read as "rotated very recently indeed".
    expect(secretAgeDays('2026-09-01', 91, now)).toBe(0);
  });

  it('is exactly at the threshold on the day it becomes stale', () => {
    // The alert is `>=`, so this is the day it fires — pinned because an
    // off-by-one here is a day of silence nobody would notice.
    const ninety = new Date(now - 90 * DAY).toISOString().slice(0, 10);
    expect(secretAgeDays(ninety, 91, now)).toBe(90);
  });
});
