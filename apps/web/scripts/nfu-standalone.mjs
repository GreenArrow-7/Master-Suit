/**
 * The release artifact, served the way the deployment serves it.
 *
 * `next start` prints "does not work with output: standalone" and serves the
 * other build, so browser evidence taken through it is evidence about a
 * different artifact. This runs `.next-prod/standalone/server.js` under
 * NODE_ENV=production.
 *
 * The startup check refuses to boot in production with mock providers, and it
 * is right to — a mock accepts what the real one would reject. So the three are
 * configured rather than mocked: email over real SMTP to the local Mailpit
 * capture, antivirus against the running ClamAV container, and WhatsApp named
 * without credentials, so an actual send fails loudly instead of succeeding
 * quietly. Nothing here weakens TLS or certificate verification.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}
Object.assign(env, {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  PORT: '3320',
  HOSTNAME: '127.0.0.1',
  EMAIL_PROVIDER: 'smtp',
  ANTIVIRUS_PROVIDER: 'clamav',
  WHATSAPP_PROVIDER: 'meta',
  APP_URL: 'https://127.0.0.1:3443',
  // The TLS terminator in scripts/nfu-tls-term.mjs is the only route in.
  TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
});

// cwd is the standalone directory: server.js resolves `distDir` and `public`
// relative to where it runs, which is why the release copies static in beside it.
spawn(process.execPath, ['server.js'], { env, stdio: 'inherit', cwd: '.next-prod/standalone' });
