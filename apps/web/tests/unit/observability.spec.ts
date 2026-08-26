/**
 * The two entrypoint scripts that turn env vars into monitoring configuration.
 *
 * These are shell, they run inside somebody else's image, and they hold the one
 * credential that gets a caller a map of the whole product's route surface —
 * which makes them the part of the observability stack least likely to be read
 * carefully and most expensive to get wrong. Both take a render-only mode so
 * the generated output can be asserted here instead of discovered on a VM.
 *
 * What is worth testing is not "does it emit YAML". It is:
 *
 *   - the refusals. Both scripts exit non-zero rather than start half-configured,
 *     because a Prometheus with no token pages about a healthy application and an
 *     Alertmanager with no recipient reads as monitored while delivering nothing.
 *   - the injection guards. Every operator-supplied value lands inside a
 *     single-quoted YAML scalar, and a quote or a newline in one of them would
 *     end that scalar early — producing a config that is either invalid or,
 *     worse, valid and routing somewhere else.
 *   - the staging shape, where SMTP is Mailpit and TLS has to be off, because
 *     that is the environment whose alerting would fail silently.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const INFRA = resolve(__dirname, '../../infra');
const AM = join(INFRA, 'alertmanager-entrypoint.sh');
const PROM = join(INFRA, 'prometheus-entrypoint.sh');

interface Run {
  status: number;
  stderr: string;
  dir: string;
}

function sh(script: string, env: Record<string, string>): Run {
  const dir = mkdtempSync(join(tmpdir(), 'obs-'));
  const varName = script === AM ? 'ALERTMANAGER_OUT_DIR' : 'PROMETHEUS_OUT_DIR';
  const only = script === AM ? 'ALERTMANAGER_RENDER_ONLY' : 'PROMETHEUS_RENDER_ONLY';
  try {
    execFileSync('sh', [script], {
      // A bare environment, not process.env: a SMTP_HOST inherited from the
      // developer's shell would make a test of "refuses without a relay" pass
      // for the wrong reason. NODE_ENV is carried only because src/lib/env.ts
      // augments NodeJS.ProcessEnv to require it; the child here is `sh`.
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        [varName]: dir,
        [only]: '1',
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '', dir };
  } catch (err) {
    const e = err as { status: number; stderr: string };
    return { status: e.status, stderr: e.stderr, dir };
  }
}

const PROD_ENV = {
  ALERT_EMAIL_TO: 'ops@example.com',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'apikey',
  SMTP_PASSWORD: 'relay-password',
  EMAIL_FROM: 'Master Suite <no-reply@example.com>',
  APP_ENV: 'production',
};

const STAGING_ENV = {
  ALERT_EMAIL_TO: 'staging-alerts@staging.invalid',
  SMTP_HOST: 'mailpit',
  SMTP_PORT: '1025',
  ALERT_SMTP_REQUIRE_TLS: 'false',
  APP_ENV: 'staging',
};

const config = (run: Run) => readFileSync(join(run.dir, 'alertmanager.yml'), 'utf8');

describe('alertmanager-entrypoint.sh', () => {
  it('refuses to start with no recipient', () => {
    const run = sh(AM, { SMTP_HOST: 'smtp.example.com', APP_ENV: 'production' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/ALERT_EMAIL_TO is empty/);
  });

  it('refuses to start with no relay', () => {
    const run = sh(AM, { ALERT_EMAIL_TO: 'ops@example.com', APP_ENV: 'production' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/SMTP_HOST is empty/);
  });

  it('refuses a value carrying a single quote, which would break out of the scalar', () => {
    const run = sh(AM, { ...PROD_ENV, ALERT_EMAIL_TO: "ops@x.com', to: 'attacker@evil.com" });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/ALERT_EMAIL_TO contains a single quote/);
  });

  it('refuses a value carrying a newline, which would inject a sibling key', () => {
    const run = sh(AM, { ...PROD_ENV, ALERT_WEBHOOK_URL: 'https://hooks.example.com/x\nevil: 1' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/ALERT_WEBHOOK_URL contains a newline/);
  });

  it('refuses a TLS setting that is neither true nor false', () => {
    const run = sh(AM, { ...PROD_ENV, ALERT_SMTP_REQUIRE_TLS: 'yes' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/must be 'true' or 'false'/);
  });

  it('renders a production config with TLS on and both receivers', () => {
    const run = sh(AM, PROD_ENV);
    expect(run.status).toBe(0);
    const yaml = config(run);
    expect(yaml).toContain("smtp_smarthost: 'smtp.example.com:587'");
    expect(yaml).toContain('smtp_require_tls: true');
    expect(yaml).toContain("- name: 'page'");
    expect(yaml).toContain("- name: 'ticket'");
    expect(yaml).toContain('matchers: [\'severity="page"\']');
  });

  it('never writes the relay password into the config, only into a 0600 file', () => {
    const run = sh(AM, PROD_ENV);
    const yaml = config(run);
    expect(yaml).not.toContain('relay-password');
    expect(yaml).toContain('smtp_auth_password_file:');

    const secret = join(run.dir, 'smtp-password');
    expect(readFileSync(secret, 'utf8')).toBe('relay-password');
    // No trailing newline, and readable by nobody else.
    expect(statSync(secret).mode & 0o777).toBe(0o600);
  });

  it('omits SMTP auth entirely when the relay wants none', () => {
    const run = sh(AM, STAGING_ENV);
    expect(run.status).toBe(0);
    const yaml = config(run);
    expect(yaml).not.toContain('smtp_auth_username');
    expect(yaml).not.toContain('smtp_auth_password_file');
    expect(existsSync(join(run.dir, 'smtp-password'))).toBe(false);
  });

  it('turns TLS off for staging, whose Mailpit relay offers none', () => {
    const yaml = config(sh(AM, STAGING_ENV));
    expect(yaml).toContain("smtp_smarthost: 'mailpit:1025'");
    expect(yaml).toContain('smtp_require_tls: false');
  });

  it('omits the webhook block when no webhook is configured', () => {
    expect(config(sh(AM, PROD_ENV))).not.toContain('webhook_configs');
  });

  it('adds the webhook to both receivers when one is configured', () => {
    const yaml = config(sh(AM, { ...PROD_ENV, ALERT_WEBHOOK_URL: 'https://hooks.example.com/T/B/x' }));
    expect(yaml.match(/webhook_configs/g)).toHaveLength(2);
  });

  it('sends pages to their own address when one is given, tickets to the default', () => {
    const yaml = config(sh(AM, { ...PROD_ENV, ALERT_PAGE_EMAIL_TO: 'oncall@example.com' }));
    const page = yaml.slice(yaml.indexOf("- name: 'page'"), yaml.indexOf("- name: 'ticket'"));
    const ticket = yaml.slice(yaml.indexOf("- name: 'ticket'"));
    expect(page).toContain("to: 'oncall@example.com'");
    expect(ticket).toContain("to: 'ops@example.com'");
  });

  it('inhibits the symptoms of an application that is down', () => {
    const yaml = config(sh(AM, PROD_ENV));
    expect(yaml).toContain('source_matchers: [\'alertname="ApplicationDown"\']');
    // Excluded from its own targets: Alertmanager's self-inhibition guard
    // compares fingerprints, and these two would differ by label.
    expect(yaml).toContain('target_matchers: [\'alertname!="ApplicationDown"\']');
  });
});

describe('prometheus-entrypoint.sh', () => {
  const render = (env: Record<string, string>) =>
    sh(PROM, { PROMETHEUS_CONFIG_SOURCE: join(INFRA, 'prometheus.yml'), ...env });

  it('refuses to start with no scrape token', () => {
    const run = render({ APP_ENV: 'production' });
    expect(run.status).toBe(1);
    // The reason matters: /api/metrics answers 404 without a token, and a
    // scraper cannot tell that apart from a process that is down.
    expect(run.stderr).toMatch(/METRICS_TOKEN is empty/);
    expect(run.stderr).toMatch(/ApplicationDown would fire against a healthy application/);
  });

  it('refuses to start with no environment label', () => {
    const run = render({ METRICS_TOKEN: 'token' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/APP_ENV is empty/);
  });

  it('writes the token to a 0600 file with no trailing newline', () => {
    const run = render({ METRICS_TOKEN: 'a-scrape-token', APP_ENV: 'production' });
    expect(run.status).toBe(0);
    const token = join(run.dir, 'metrics-token');
    expect(readFileSync(token, 'utf8')).toBe('a-scrape-token');
    expect(statSync(token).mode & 0o777).toBe(0o600);
  });

  it('stamps the environment onto every alert this server raises', () => {
    const staging = render({ METRICS_TOKEN: 't', APP_ENV: 'staging' });
    const yaml = readFileSync(join(staging.dir, 'prometheus.yml'), 'utf8');
    expect(yaml).toContain("environment: 'staging'");
    expect(yaml).not.toContain('@APP_ENV@');
  });

  it('leaves the rest of the config byte-identical to the file under review', () => {
    const run = render({ METRICS_TOKEN: 't', APP_ENV: 'production' });
    const rendered = readFileSync(join(run.dir, 'prometheus.yml'), 'utf8');
    const source = readFileSync(join(INFRA, 'prometheus.yml'), 'utf8');
    expect(rendered).toBe(source.replace(/@APP_ENV@/g, 'production'));
  });
});
