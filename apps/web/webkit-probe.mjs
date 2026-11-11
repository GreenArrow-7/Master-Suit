/**
 * The reported iPhone journeys, driven in WebKit against a production build.
 *
 * WebKit is Safari's engine and the engine iOS WKWebView uses. It is not an
 * iPhone — no iOS process model, no real network — but it is the closest thing
 * reachable without the device, and it is a different engine from the Chromium
 * every other test here uses.
 *
 * It captures what the brief asked for and nothing else: the first client
 * exception, every failed request, every response of 400 or worse, and the
 * number of writes each save makes.
 *
 * Usage:  node webkit-blank-screen.mjs <baseURL> <email> <password> <workspaceSlug>
 */
import { webkit, devices } from '@playwright/test';

const [, , BASE, EMAIL, PASSWORD, SLUG] = process.argv;
if (!BASE || !EMAIL || !PASSWORD || !SLUG) {
  console.error('usage: node webkit-blank-screen.mjs <baseURL> <email> <password> <workspaceSlug>');
  process.exit(2);
}

const stamp = Date.now().toString(36);
const events = [];
const note = (kind, detail) => {
  events.push({ at: new Date().toISOString(), kind, detail });
  console.log(`  [${kind}] ${detail}`);
};

const browser = await webkit.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],
  // The app's WebView announces itself; the server has a 3.1.1 gate keyed on it,
  // so the journey should be driven as the app, not as mobile Safari.
  userAgent: `${devices['iPhone 13'].userAgent} YouhanOneApp/1.2.0+18`,
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

let firstException = null;
page.on('pageerror', (err) => {
  if (!firstException) firstException = `${err.name}: ${err.message}`;
  note('pageerror', `${err.name}: ${err.message}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') note('console.error', msg.text().slice(0, 300));
});
page.on('requestfailed', (req) =>
  note('requestfailed', `${req.method()} ${req.url().slice(0, 120)} — ${req.failure()?.errorText}`),
);
page.on('response', async (res) => {
  if (res.status() < 400) return;
  // The body too, for an API answer: a status alone cannot say which field.
  let body = '';
  if (res.url().includes('/api/')) body = ` :: ${(await res.text().catch(() => '')).slice(0, 300)}`;
  note('http', `${res.status()} ${res.request().method()} ${res.url().slice(0, 120)}${body}`);
});

/** Every write the page makes, so "saved exactly once" is a count, not a hope. */
const writes = [];
page.on('request', (req) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method()) && req.url().includes('/api/'))
    writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
});

/** Is there a usable page here, or a blank one? */
const screenState = async () => {
  const text = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).trim();
  return {
    url: new URL(page.url()).pathname,
    chars: text.length,
    heading: await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => null),
    blank: text.length < 40,
  };
};

/**
 * Type, then check the value survived.
 *
 * In the production bundle React attaches after the HTML paints, and a value
 * written before that is replaced by the controlled field's empty state — the
 * form then posts nothing. Retrying until it sticks is what a person does
 * without noticing; a harness has to be told.
 */
const typeInto = async (selector, value) => {
  const control = page.locator(selector).first();
  for (let attempt = 0; attempt < 6; attempt++) {
    await control.fill(value);
    if ((await control.inputValue()) === value) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${selector} would not hold a value — the page is not hydrated`);
};

const step = async (label, fn) => {
  console.log(`\n── ${label}`);
  const before = writes.length;
  await fn();
  const state = await screenState();
  console.log(`  state: ${JSON.stringify(state)}`);
  console.log(`  writes this step: ${JSON.stringify(writes.slice(before))}`);
  if (state.blank) {
    console.log(`  *** BLANK SCREEN at ${state.url} ***`);
    await page.screenshot({ path: `blank-${label.replace(/\W+/g, '-')}.png` });
  }
  return state;
};

try {
  await step('sign in', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    // Wait for hydration before typing. In the production bundle React attaches
    // after the HTML paints, and a value written before that is replaced by the
    // controlled field's empty state — the form then posts nothing and the
    // server answers 422. The same gap a real thumb can hit on a slow phone.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await typeInto('input[type="email"]', EMAIL);
    await typeInto('input[type="password"]', PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 });
  });

  let leadUrl = '';
  await step('create a lead and save', async () => {
    await page.goto(`${BASE}/${SLUG}/sales/leads/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await typeInto('#fullName', `WebKit Probe ${stamp}`);
    // The contact rule: a manually created lead needs one way to reach it.
    await typeInto('#phone', `05${String(Date.now()).slice(-8)}`);
    await page.getByRole('button', { name: 'Create lead' }).click();
    // Wait for the destination itself, not for the click to return: the probe
    // used to sample the URL while the navigation was still in flight and then
    // check persistence against the Add-lead form.
    await page.waitForURL(/\/sales\/leads\/[a-z0-9]{10,}$/i, { timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    leadUrl = page.url();
  });

  await step('edit details, change tags, save', async () => {
    await page.getByRole('button', { name: 'More ▾' }).click();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await typeInto('input[placeholder*="investor"], input[name="tags"], #tags', `vip, investor, wk${stamp}`);
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/leads/'), {
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // Wait for the write to come back before moving on, so a cancellation in
    // the next step is the application's doing and not the probe's.
    const res = await saved;
    note('save', `PATCH answered ${res.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  });

  await step('navigate away', async () => {
    await page.goto(`${BASE}/${SLUG}/sales/leads`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  });

  const back = await step('and return', async () => {
    await page.goto(leadUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  });

  const body = await page.locator('body').innerText();
  console.log('\n──────── result ────────');
  console.log(`tags persisted:        ${body.includes(`wk${stamp}`)}`);
  console.log(`page usable on return: ${!back.blank} (${back.chars} chars)`);
  console.log(`first client exception: ${firstException ?? 'none'}`);
  const saves = writes.filter((w) => w.includes('/api/v1/leads'));
  console.log(`writes to /api/v1/leads: ${saves.length} — ${JSON.stringify(saves)}`);
  console.log(`total captured events: ${events.length}`);
} finally {
  await browser.close();
}
