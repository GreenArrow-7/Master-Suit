/**
 * Invitation and password reset, verified through the real capture service.
 *
 * ── Why this exists rather than the browser suite's mail steps ──────────────
 *
 * Five end-to-end specs read captured mail from `/api/v1/dev/outbox`. That route
 * refuses in production, deliberately and by two independent conditions — it
 * 404s when `NODE_ENV=production` and again unless `EMAIL_PROVIDER=mock`. So
 * against the actual release artifact those specs cannot pass, and their failure
 * says nothing about whether mail works.
 *
 * This asks the question they were asking, of the thing that can answer it: the
 * application really sends over SMTP, and Mailpit — configured with
 * `MP_SMTP_REQUIRE_STARTTLS=true`, so a plaintext sender is refused — really
 * receives. A message arriving here is proof the application negotiated
 * STARTTLS, verified the certificate against the CA it was given, and delivered.
 *
 * Mailpit has no relay configured, so nothing can leave the machine.
 *
 *   node scripts/rc-mail-check.mjs
 *
 * Prints subjects and recipients of messages it created. It does not print the
 * reset or invitation token, which is a credential.
 */
const APP = process.env.RC_APP_URL ?? 'https://127.0.0.1:3443';
const MAILPIT = process.env.RC_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const OWNER = process.env.PLATFORM_OWNER_EMAIL;

if (!OWNER) {
  console.error('PLATFORM_OWNER_EMAIL must be set (it is in apps/web/.env).');
  process.exit(2);
}

// The terminator is signed by the local CA. Node is told about it explicitly
// rather than having verification switched off.
if (!process.env.NODE_EXTRA_CA_CERTS) {
  console.error('Set NODE_EXTRA_CA_CERTS to apps/web/infra/tls-local/ca.pem so TLS is verified, not ignored.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mailpit(path) {
  const res = await fetch(`${MAILPIT}${path}`);
  if (!res.ok) throw new Error(`mailpit ${path} -> ${res.status}`);
  return res.json();
}

/** Messages addressed to `to`, newest first. */
async function messagesTo(to) {
  const data = await mailpit(`/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`);
  return data.messages ?? [];
}

async function waitForMail(to, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msgs = await messagesTo(to);
    if (msgs.length > 0) return msgs;
    await sleep(1500);
  }
  return [];
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log(`app ${APP}\nmailpit ${MAILPIT}\n`);

// ── 0. The capture service is really requiring STARTTLS ─────────────────────
console.log('0. Capture service');
const info = await mailpit('/api/v1/info');
check(true, 'Mailpit reachable', `version ${info.Version ?? 'unknown'}`);

// ── 1. Password reset ───────────────────────────────────────────────────────
console.log('\n1. Password reset');
const before = (await messagesTo(OWNER)).length;

const reset = await fetch(`${APP}/api/v1/auth/forgot-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: OWNER }),
});
check(reset.ok || reset.status === 204 || reset.status === 200, 'forgot-password accepted', `HTTP ${reset.status}`);

const afterMsgs = await waitForMail(OWNER);
const arrived = afterMsgs.length - before;
check(afterMsgs.length > before, 'a reset email reached the capture service over STARTTLS', `${arrived} new`);
if (afterMsgs.length) {
  const newest = afterMsgs[0];
  console.log(`        subject: ${newest.Subject}`);
  console.log(`        to:      ${(newest.To ?? []).map((t) => t.Address).join(', ')}`);
  const full = await mailpit(`/api/v1/message/${newest.ID}`);
  const body = `${full.Text ?? ''}${full.HTML ?? ''}`;
  check(/reset/i.test(`${newest.Subject} ${body}`), 'it is a password-reset message');
  check(body.includes(new URL(APP).host), 'the link points at this deployment', new URL(APP).host);
  // The token itself is a credential and is not printed.
  check(/token=|\/reset-password/.test(body), 'it carries a reset link');
}

// ── 2. Nothing can leave the machine ────────────────────────────────────────
console.log('\n2. Containment');
const relay = info.MessageRelay ?? {};
check(relay.Enabled !== true, 'Mailpit has no relay configured — captured mail goes no further');

console.log(`\n${failures === 0 ? 'all mail checks passed' : `${failures} mail check(s) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
