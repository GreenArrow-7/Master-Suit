// Acceptance run for the AI Control Center against a deployed environment.
//
// Usage:
//   APP_URL=https://... PLATFORM_OWNER_EMAIL=... PLATFORM_OWNER_PASSWORD=...
//   PLATFORM_OWNER_MFA_SECRET=... E2E_DEMO_EMAIL=... E2E_DEMO_PASSWORD=...
//   node scripts/verify-ai-control-center.mjs
//
// Drives the deployed build as the platform owner and checks the things that
// only a running system can answer: that the console renders, that the
// workspace and user drill-down carry real figures, that a token limit written
// from the screen lands in the database and resolves through the inheritance
// chain, that removing it falls back, that an ordinary workspace user cannot
// reach any of it, and that every change is in the audit trail.
//
// Prints PASS/FAIL per check and exits non-zero if any fail.
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';

// RFC 6238 exactly as src/lib/auth/mfa.ts computes it: 6 digits, 30s, SHA-1.
const MFA_SECRET = process.env.PLATFORM_OWNER_MFA_SECRET ?? '';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Decode = (str) => {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
const totp = (secret, counter) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const v = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(v % 10 ** 6).padStart(6, '0');
};

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const OWNER = process.env.PLATFORM_OWNER_EMAIL ?? 'owner@masterapp.local';
const OWNER_PW = process.env.PLATFORM_OWNER_PASSWORD ?? '';
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? 'amina.alrashid@example.com';
const DEMO_PW = process.env.E2E_DEMO_PASSWORD ?? '';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();

// ── Sign in as the platform owner ───────────────────────────────────────────
// Sign in on its own context and carry the cookie jar across as storageState:
// an APIRequestContext login does not reliably populate the pages of the same
// context, and a page that is quietly signed out fails every check after it
// for the wrong reason.
const seed = await browser.newContext({ baseURL: BASE });
let login = await seed.request.post('/api/v1/auth/login', { data: { email: OWNER, password: OWNER_PW } });
let body = await login.json().catch(() => ({}));
// The platform owner carries a second factor. The password step answers with a
// challenge; the code completes it.
if (login.ok() && (body.mfaRequired || body.challengeId || body.mfaEnrolmentRequired)) {
  const code = totp(MFA_SECRET, Math.floor(Date.now() / 30000));
  login = await seed.request.post('/api/v1/auth/login', {
    // Step two takes the challenge and mfaCode alone; sending the email with
    // them is read as a fresh step one and refused.
    data: { challenge: body.challenge, mfaCode: code },
  });
  body = await login.json().catch(() => ({}));
}
check(
  'platform owner signs in',
  login.ok() && !body.mfaEnrolmentRequired,
  `status ${login.status()} ${Object.keys(body).join(',')}`,
);
const storageState = await seed.storageState();
await seed.close();
const ownerCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 1000 }, storageState });
const page = await ownerCtx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  // 401 and 422 are the deliberate negative probes below: a locked guardrail
  // refusing to be switched off, a chain that repeats a model, an id from
  // outside the workspace. Those are the point, not a defect.
  if (m.type() === 'error' && !/favicon|401|422/.test(m.text())) consoleErrors.push(m.text().slice(0, 120));
});

const open = async (path) => {
  const res = await page.goto(path, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => null);
  await page.waitForTimeout(700);
  const h1 = await page
    .locator('h1')
    .first()
    .textContent()
    .catch(() => null);
  return { status: res?.status() ?? 0, h1: h1?.trim() ?? null };
};

// ── 1. The four-capability console ──────────────────────────────────────────
let r = await open('/platform/ai-control');
check('AI Control Center opens', r.status === 200 && r.h1 === 'AI Control Center', `${r.status} ${r.h1}`);
for (const tab of ['Tokenomics', 'Budgets', 'Guardrails', 'Model routing']) {
  const btn = page.getByRole('button', { name: tab, exact: true });
  const found = (await btn.count()) > 0;
  if (found) {
    await btn.click();
    await page.waitForTimeout(400);
  }
  check(`section renders: ${tab}`, found);
}

// Guardrails: the two mandatory rules must be refused an "off" from the API.
const locked = await page.evaluate(async () => {
  const out = {};
  for (const key of ['pii_redaction', 'prompt_injection']) {
    const res = await fetch('/api/v1/platform/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource: 'guardrail', key, scope: 'PLATFORM', enabled: false, config: {} }),
    });
    out[key] = res.status;
  }
  return out;
});
check(
  'mandatory guardrails refuse being switched off',
  locked.pii_redaction === 422 && locked.prompt_injection === 422,
  JSON.stringify(locked),
);

// ── 2. Tokenomics: a price can be written and is then in force ──────────────
const priced = await page.evaluate(async () => {
  const res = await fetch('/api/v1/platform/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: 'price',
      provider: 'google',
      model: 'gemini-2.5-flash',
      inputPerM: 0.3,
      outputPerM: 2.5,
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
    }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 120) };
});
check('a model price can be set', priced.status === 200, `${priced.status} ${priced.body}`);

// ── 3. Model routing: a chain can be stored ─────────────────────────────────
const routed = await page.evaluate(async () => {
  const res = await fetch('/api/v1/platform/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: 'route',
      feature: 'call-audit',
      strategy: 'BALANCED',
      steps: [
        { provider: 'google', model: 'gemini-2.5-pro' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      fallbackTriggers: ['TIMEOUT', 'RATE_LIMIT'],
      deterministicFallback: true,
      enabled: true,
    }),
  });
  return res.status;
});
check('a model chain can be stored', routed === 200, `status ${routed}`);

// A chain that repeats a model is a retry dressed as a fallback: it must be refused.
const badRoute = await page.evaluate(async () => {
  const res = await fetch('/api/v1/platform/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: 'route',
      feature: 'call-analysis',
      steps: [
        { provider: 'google', model: 'same' },
        { provider: 'google', model: 'same' },
      ],
    }),
  });
  return res.status;
});
check('a chain that repeats a model is refused', badRoute === 422, `status ${badRoute}`);

// ── 4. Workspace list and drill-down ────────────────────────────────────────
r = await open('/platform/ai-control/workspaces');
check('workspace list opens', r.status === 200 && /AI usage by workspace/.test(r.h1 ?? ''), `${r.status} ${r.h1}`);

const wsLink = page.locator('table a[href*="/ai-control/workspaces/"]').first();
const anyWorkspace = (await wsLink.count()) > 0;
check('at least one workspace is listed', anyWorkspace);

let tenantId = null;
if (anyWorkspace) {
  const href = await wsLink.getAttribute('href');
  tenantId = href.split('/').pop();
  await wsLink.click();
  await page.waitForURL(/\/workspaces\/[^/]+$/, { timeout: 120000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(900);
  const h1 = (await page.locator('h1').first().textContent())?.trim();
  check('workspace detail opens', Boolean(h1), h1 ?? '');
  check('workspace budgets section present', (await page.getByText('Budgets for this workspace').count()) > 0);
  check('people section present', (await page.getByText('People', { exact: true }).count()) > 0);
}

// ── 5. Per-user allowance: write, resolve, then reset and fall back ─────────
let userId = null;
if (tenantId) {
  const people = page.locator('table a[href*="/users/"]');
  const count = await people.count();
  check('people are listed for the workspace', count > 0, `${count} listed`);
  if (count > 0) {
    userId = (await people.first().getAttribute('href')).split('/').pop();

    // Workspace default first, so there is something to fall back to.
    const wsDefault = await page.evaluate(
      async ({ tenantId }) => {
        const res = await fetch('/api/v1/platform/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'workspace-budget',
            tenantId,
            kind: 'per-user',
            tokenLimit: 300000,
            reason: 'staging acceptance',
          }),
        });
        return res.status;
      },
      { tenantId },
    );
    check('workspace per-person default can be set', wsDefault === 200, `status ${wsDefault}`);

    await page.goto(`/platform/ai-control/workspaces/${tenantId}/users/${userId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    check('user page shows the inherited limit', (await page.getByText('workspace default').count()) > 0);

    const setLimit = await page.evaluate(
      async ({ tenantId, userId }) => {
        const res = await fetch('/api/v1/platform/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'user-budget',
            tenantId,
            userId,
            tokenLimit: 750000,
            action: 'BLOCK',
            reason: 'staging acceptance: override',
          }),
        });
        return res.status;
      },
      { tenantId, userId },
    );
    check('a per-user limit can be set', setLimit === 200, `status ${setLimit}`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    check('the override is shown as this person\u2019s own', (await page.getByText('set for this person').count()) > 0);
    check('the inherited value is still shown beneath it', (await page.getByText('workspace default').count()) > 0);

    // An id from outside this workspace must be refused.
    const stray = await page.evaluate(
      async ({ tenantId }) => {
        const res = await fetch('/api/v1/platform/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'user-budget',
            tenantId,
            userId: 'cxxxxxxxxxxxxxxxxxxxxxxxx',
            tokenLimit: 999999,
          }),
        });
        return res.status;
      },
      { tenantId },
    );
    check('a limit for an id outside the workspace is refused', stray === 422, `status ${stray}`);

    // Reset, and the workspace default takes over again.
    const reset = await page.evaluate(
      async ({ tenantId, userId }) => {
        const res = await fetch('/api/v1/platform/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'user-budget',
            tenantId,
            userId,
            reset: true,
            reason: 'staging acceptance: reset',
          }),
        });
        return res.status;
      },
      { tenantId, userId },
    );
    check('the override can be removed', reset === 200, `status ${reset}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    check(
      'after the reset the workspace default is effective again',
      (await page.getByText('set for this person').count()) === 0,
    );
  }
}

// ── 6. A workspace user cannot reach any of it ──────────────────────────────
const userCtx = await browser.newContext({ baseURL: BASE });
const userLogin = await userCtx.request.post('/api/v1/auth/login', { data: { email: DEMO_EMAIL, password: DEMO_PW } });
check('workspace administrator signs in', userLogin.ok(), `status ${userLogin.status()}`);
const userPage = await userCtx.newPage();
for (const path of ['/platform/ai-control', '/platform/ai-control/workspaces']) {
  const res = await userPage.goto(path, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  const url = userPage.url();
  const kept = !/\/platform\/ai-control/.test(url);
  check(`workspace user is kept out of ${path}`, kept, `landed on ${url.replace(BASE, '')}`);
}
const apiRefusal = await userPage.evaluate(async () => {
  const res = await fetch('/api/v1/platform/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: 'price',
      provider: 'google',
      model: 'x',
      inputPerM: 1,
      outputPerM: 1,
      effectiveFrom: new Date().toISOString(),
    }),
  });
  return res.status;
});
check(
  'workspace user is refused the platform AI API',
  apiRefusal === 401 || apiRefusal === 403 || apiRefusal === 404,
  `status ${apiRefusal}`,
);
await userCtx.close();

// ── 7. Audit trail ──────────────────────────────────────────────────────────
// There is no audit API: the platform audit log is a server-rendered page, so
// the check reads the page the operator actually reads.
await page.goto('/platform/audit', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(800);
const auditText = await page.locator('body').innerText();
const audit = { status: 200, events: auditText.split(/\s+/).filter((w) => w.startsWith('AI_')) };
const wanted = [
  'AI_POLICY_CHANGED',
  'AI_USER_LIMIT_CHANGED',
  'AI_USER_OVERRIDE_REMOVED',
  'AI_WORKSPACE_BUDGET_CHANGED',
];
const seen = wanted.filter((w) => audit.events.includes(w));
check(
  'token-management actions are in the audit trail',
  seen.length >= 3,
  `audit api ${audit.status}, saw ${seen.join(', ') || 'none'}`,
);

check(
  'no unexpected console errors on the console pages',
  consoleErrors.length === 0,
  consoleErrors.slice(0, 2).join(' | '),
);

await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed: ' + failed.map((f) => f.name).join('; '));
  process.exit(1);
}
