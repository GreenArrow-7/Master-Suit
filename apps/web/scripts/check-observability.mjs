#!/usr/bin/env node
/**
 * Keeps the monitoring stack and the thing it monitors from drifting apart.
 *
 * Every check here is a failure that would be *silent*. A Prometheus rule that
 * can never fire looks exactly like one that has never needed to; an
 * Alertmanager route with no matching severity discards its alerts without
 * complaint; a queue missing from QueueHasNoConsumer is a queue whose consumer
 * can die unnoticed — which is precisely how the worker process managed to be
 * dead in production for months.
 *
 * The checks are deliberately written so that a *missing* pattern fails. A gate
 * that passes when it cannot find what it was looking for is worse than no gate:
 * restructure the file and it goes quiet, and quiet reads as correct.
 *
 * Run:  node scripts/check-observability.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const INFRA = 'infra';
const problems = [];
const fail = (msg) => problems.push(msg);

const read = (path) => {
  if (!existsSync(path)) {
    fail(`${path} does not exist.`);
    return '';
  }
  return readFileSync(path, 'utf8');
};

const prometheusYml = read(join(INFRA, 'prometheus.yml'));
const alertsYml = read(join(INFRA, 'prometheus-alerts.yml'));
const amEntrypoint = read(join(INFRA, 'alertmanager-entrypoint.sh'));
const promEntrypoint = read(join(INFRA, 'prometheus-entrypoint.sh'));
const compose = read(join(INFRA, 'docker-compose.yml'));

/** One capture group, required. Returns null and records the failure otherwise. */
function must(source, label, re) {
  const m = source.match(re);
  if (!m) {
    fail(
      `${label}: expected to find ${re} and did not. If this file was restructured, update scripts/check-observability.mjs to match — do not delete the check.`,
    );
    return null;
  }
  return m[1];
}

// ── 1. The scrape job name is load-bearing ──────────────────────────────────
//
// ApplicationDown is `up{job="master-suite"} == 0`. Rename the job in
// prometheus.yml and that rule silently becomes one that can never fire: `up`
// for a job that does not exist produces no series, so the comparison has
// nothing to evaluate and the alert stays green forever.
const jobName = must(prometheusYml, 'prometheus.yml', /^\s*-\s*job_name:\s*(\S+)\s*$/m);
const upJob = must(alertsYml, 'prometheus-alerts.yml', /up\{job="([^"]+)"\}/);
if (jobName && upJob && jobName !== upJob) {
  fail(`scrape job is "${jobName}" but ApplicationDown watches up{job="${upJob}"} — that rule can never fire.`);
}

// ── 2. Every severity has somewhere to go ───────────────────────────────────
//
// Alertmanager routes `severity="page"` to the page receiver and everything
// else to the default. A rule labelled anything else is not dropped — it lands
// in `ticket` — but it lands there by accident rather than by decision, and the
// repeat interval it inherits is the daily one. Make the set closed.
const ROUTED = new Set(['page', 'ticket']);
const severities = [...alertsYml.matchAll(/severity:\s*([a-z]+)/g)].map((m) => m[1]);
if (severities.length === 0) fail('prometheus-alerts.yml declares no severity labels at all.');
for (const sev of new Set(severities)) {
  if (!ROUTED.has(sev)) {
    fail(
      `prometheus-alerts.yml uses severity "${sev}", which alertmanager-entrypoint.sh does not route. Add a route or use one of: ${[...ROUTED].join(', ')}.`,
    );
  }
}
for (const sev of ROUTED) {
  if (!amEntrypoint.includes(`'${sev}'`)) {
    fail(`alertmanager-entrypoint.sh has no receiver named "${sev}".`);
  }
}

// ── 3. Inhibitions name alerts that exist ───────────────────────────────────
//
// `alertname="QueueHasNoConsumer"` against a renamed rule is an inhibition that
// never applies, which shows up as duplicate notifications during an incident —
// the worst possible time to discover it.
const alertNames = new Set([...alertsYml.matchAll(/^\s*-\s*alert:\s*(\S+)\s*$/gm)].map((m) => m[1]));
if (alertNames.size === 0) fail('prometheus-alerts.yml declares no alerts.');
const inhibitSection = amEntrypoint.slice(amEntrypoint.indexOf('inhibit_rules:'));
for (const m of inhibitSection.matchAll(/alertname(?:!?=|=~)"([^"]+)"/g)) {
  for (const name of m[1].split('|')) {
    if (!alertNames.has(name)) {
      fail(`alertmanager-entrypoint.sh inhibits on alertname "${name}", which no rule declares.`);
    }
  }
}

// ── 4. QueueHasNoConsumer lists every queue that has a consumer ─────────────
//
// The rule names its queues by hand, because `masterapp_queue_workers == 0` is
// correct for a consumed queue and normal for a declared-but-unconsumed one.
// A hand-written list drifts. This is the drift that matters most: a queue
// missing here is a queue whose worker can exit without anything noticing,
// which is the exact failure the whole metrics endpoint was built for.
const consumed = new Set();
for (const file of readdirSync('src/workers')) {
  if (!file.endsWith('.ts') || file === 'index.ts') continue;
  const body = readFileSync(join('src/workers', file), 'utf8');
  for (const m of body.matchAll(/new Worker\(\s*'([^']+)'/g)) consumed.add(m[1]);
}
if (consumed.size === 0)
  fail('found no `new Worker(...)` call in src/workers — the consumed-queue list could not be derived.');

const watched = must(alertsYml, 'prometheus-alerts.yml', /alert: QueueHasNoConsumer[\s\S]*?queue=~"([^"]+)"/);
if (watched) {
  const listed = new Set(watched.split('|'));
  for (const q of consumed) {
    if (!listed.has(q))
      fail(
        `queue "${q}" has a consumer in src/workers but QueueHasNoConsumer does not watch it — its worker could die unnoticed.`,
      );
  }
  for (const q of listed) {
    if (!consumed.has(q))
      fail(
        `QueueHasNoConsumer watches queue "${q}", which nothing consumes — it would fire immediately and permanently.`,
      );
  }
}

// ── 5. The paths the three files agree on ───────────────────────────────────
//
// prometheus.yml names absolute paths; docker-compose.yml mounts them there;
// the entrypoint writes the credential there. Any one of these moving alone
// produces a container that starts and a target that is permanently down.
const rulePath = must(prometheusYml, 'prometheus.yml', /rule_files:\s*\n\s*(?:#[^\n]*\n\s*)*-\s*(\S+)/);
if (rulePath && !compose.includes(`prometheus-alerts.yml:${rulePath}:ro`)) {
  fail(
    `prometheus.yml loads rules from ${rulePath}, but docker-compose.yml does not mount prometheus-alerts.yml there.`,
  );
}

const credsPath = must(prometheusYml, 'prometheus.yml', /credentials_file:\s*(\S+)/);
const tokenDir = must(promEntrypoint, 'prometheus-entrypoint.sh', /PROMETHEUS_OUT_DIR:-([^}]+)\}/);
if (credsPath && tokenDir && credsPath !== `${tokenDir}/metrics-token`) {
  fail(
    `prometheus.yml reads the token from ${credsPath}, but prometheus-entrypoint.sh writes it to ${tokenDir}/metrics-token.`,
  );
}
if (tokenDir && !compose.includes(`tmpfs: ['${tokenDir}']`)) {
  fail(
    `prometheus-entrypoint.sh writes the scrape token to ${tokenDir}, which docker-compose.yml does not mount as tmpfs — it would land on the host's disk.`,
  );
}
const amDir = must(amEntrypoint, 'alertmanager-entrypoint.sh', /ALERTMANAGER_OUT_DIR:-([^}]+)\}/);
if (amDir && !compose.includes(`tmpfs: ['${amDir}']`)) {
  fail(
    `alertmanager-entrypoint.sh writes the relay password to ${amDir}, which docker-compose.yml does not mount as tmpfs.`,
  );
}

// ── 6. The scrape target is the endpoint that exists ───────────────────────
const metricsPath = must(prometheusYml, 'prometheus.yml', /metrics_path:\s*(\S+)/);
if (metricsPath) {
  const routeFile = join('src/app', metricsPath, 'route.ts');
  if (!existsSync(routeFile)) fail(`prometheus.yml scrapes ${metricsPath}, but ${routeFile} does not exist.`);
}
// Scoped to the application's own job: `targets:` also appears under the
// alertmanager block and under the self-scrape, and matching the first one in
// the file would assert against whichever happened to be written first.
const appJob = jobName ? prometheusYml.slice(prometheusYml.indexOf(`job_name: ${jobName}`)) : '';
const target = must(appJob, `prometheus.yml (job ${jobName})`, /targets:\s*\['([^']+)'\]/);
if (target && target !== 'web:3000') {
  fail(`prometheus.yml scrapes "${target}"; the web service listens on web:3000 inside the compose network.`);
}

// ── 7. Both deployment overlays actually start the stack ───────────────────
//
// The services sit behind `profiles: ['observability']` so development does not
// start them. That is only safe while every real environment clears the profile
// — otherwise the profile is just a way to have written a monitoring stack that
// nothing runs, which is the state this script exists to end.
/**
 * The block belonging to one service, from its key up to the next top-level
 * key. Sliced rather than matched with a lazy `(?:.*\n)*?`, which happily runs
 * past the end of one service into the next and finds the sibling's setting —
 * a check that cannot fail for either service as long as one of them is right.
 */
function serviceBlock(body, svc) {
  const start = body.indexOf(`\n  ${svc}:\n`);
  if (start < 0) return null;
  const rest = body.slice(start + 1);
  const next = rest.slice(1).search(/\n {0,2}\S/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

for (const overlay of ['docker-compose.azure.yml', 'docker-compose.staging.yml']) {
  const body = read(join(INFRA, overlay));
  for (const svc of ['prometheus', 'alertmanager']) {
    const block = serviceBlock(body, svc);
    if (block === null) {
      fail(`${overlay} has no ${svc} service — that deployment would run without it.`);
    } else if (!block.includes('profiles: !reset []')) {
      fail(`${overlay} does not clear the observability profile for ${svc} — that deployment would run without it.`);
    }
  }
}

if (problems.length > 0) {
  console.error('observability drift:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(
  `observability: ok — ${alertNames.size} alert rules, ${consumed.size} consumed queues watched, job "${jobName}".`,
);
