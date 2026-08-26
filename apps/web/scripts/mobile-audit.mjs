/**
 * Measures real horizontal overflow across routes and widths, and names the
 * elements responsible.
 *
 * The brief forbids `overflow-x: hidden` as a fix, which means every overflow
 * has to be traced to the element that actually exceeds the viewport. Reading
 * CSS cannot tell you that — only a rendered page can — so this walks the DOM
 * and reports the widest offenders per route per width.
 *
 *   node scripts/mobile-audit.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { writeFileSync, existsSync, statSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const EMAIL = process.env.AUDIT_EMAIL ?? 'admin@manathhomes.ae';
const PASSWORD = process.env.AUDIT_PASSWORD ?? process.env.DEMO_PASSWORD ?? 'ManathDemo-2026';
const SLUG = process.env.AUDIT_SLUG ?? 'manath-homes';

const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440];

const ROUTES = [
  ['login', '/login'],
  ['dashboard', `/${SLUG}/dashboard`],
  ['leads', `/${SLUG}/sales/leads`],
  ['accounts', `/${SLUG}/sales/accounts`],
  ['contacts', `/${SLUG}/sales/contacts`],
  ['opportunities', `/${SLUG}/sales/opportunities`],
  ['calls', `/${SLUG}/sales/calls`],
  ['call-audits', `/${SLUG}/sales/call-audits`],
  ['activities', `/${SLUG}/sales/activities`],
  ['tasks', `/${SLUG}/sales/tasks`],
  ['follow-ups', `/${SLUG}/sales/follow-ups`],
  ['campaigns', `/${SLUG}/sales/campaigns`],
  ['communications', `/${SLUG}/sales/communications`],
  ['inbox', `/${SLUG}/sales/communications/inbox`],
  ['calendar', `/${SLUG}/sales/calendar`],
  ['reports', `/${SLUG}/sales/reports`],
  ['notifications', `/${SLUG}/notifications`],
  ['admin-users', `/${SLUG}/admin/users`],
  ['admin-roles', `/${SLUG}/admin/roles`],
  ['admin-settings', `/${SLUG}/admin/settings`],
  ['integrations', `/${SLUG}/admin/integrations`],
  ['audit-log', `/${SLUG}/admin/audit`],
  ['people', `/${SLUG}/people`],
  ['people-employees', `/${SLUG}/people/employees`],
  ['people-attendance', `/${SLUG}/people/attendance`],
  ['people-leave', `/${SLUG}/people/leave`],
  ['people-payroll', `/${SLUG}/people/payroll`],
  ['people-checkin', `/${SLUG}/people/check-in`],
  ['profile-role', `/${SLUG}/profile/role`],
];

/** Elements whose box escapes the viewport, widest first. */
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement.scrollWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const overshoot = Math.round(r.right - vw);
    if (overshoot <= 1 && r.left >= -1) continue;
    const cs = getComputedStyle(el);
    // An element inside a deliberately scrollable container is not a page bug.
    let scrollableAncestor = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll') { scrollableAncestor = true; break; }
    }
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 90),
      width: Math.round(r.width),
      left: Math.round(r.left),
      overshoot,
      minWidth: cs.minWidth,
      position: cs.position,
      whiteSpace: cs.whiteSpace,
      inScrollable: scrollableAncestor,
    });
  }
  out.sort((a, b) => b.overshoot - a.overshoot);
  const seen = new Set();
  const top = out.filter((o) => { const k = o.tag + o.cls; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  const tiny = [...document.querySelectorAll('button, a[href], input, select, [role=button], [role=tab]')]
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((t) => t.h > 0 && t.h < 44);
  return { vw, doc, overflow: doc - vw, offenders: top, realOffenders: top.filter((o) => !o.inScrollable), tinyTargets: tiny.length, tinySample: tiny.slice(0, 5) };
})()`;

const browser = await chromium.launch();

/**
 * Reuse the session across runs.
 *
 * Sign-in is rate limited on purpose (5 per account / 15 minutes), and a probe
 * that authenticates on every invocation exhausts that budget and then fails
 * with a navigation timeout that looks like a UI bug. Caching the cookie keeps
 * repeated runs — and CI retries — off the limiter entirely.
 */
const AUTH = '.mobile-audit-auth.json';
const fresh = existsSync(AUTH) && Date.now() - statSync(AUTH).mtimeMs < 30 * 60_000;
let ctx = await browser.newContext(fresh ? { storageState: AUTH } : {});
let page = await ctx.newPage();

const signedIn = async () => {
  await page.goto(`${BASE}/${SLUG}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  return !page.url().includes('/login');
};

if (!fresh || !(await signedIn())) {
  await ctx.close();
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  try {
    // Generous: a dev server compiles the destination route on first hit.
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 120_000 });
  } catch {
    const alert = await page
      .locator('.lf-auth-alert, .lf-alert')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(`sign-in did not complete${alert ? ` — the app said: ${alert.trim()}` : ''}`);
  }
  await ctx.storageState({ path: AUTH });
}
console.log('signed in');

const results = [];
for (const [name, path] of ROUTES) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(700);
      const r = await page.evaluate(PROBE);
      results.push({ route: name, path, width, ...r });
      if (r.overflow > 1) {
        const worst = r.realOffenders[0] ?? r.offenders[0];
        console.log(
          `OVERFLOW ${name} @${width}: +${r.overflow}px — ${worst ? worst.tag + '.' + worst.cls.split(' ')[0] + ' (w=' + worst.width + ', minW=' + worst.minWidth + ')' : 'unknown'}`,
        );
      }
    } catch (err) {
      results.push({ route: name, path, width, error: String(err).slice(0, 120) });
    }
  }
}

writeFileSync('mobile-audit.json', JSON.stringify(results, null, 1));
const bad = results.filter((r) => (r.overflow ?? 0) > 1);
console.log(`\n=== ${bad.length}/${results.length} route×width combinations overflow`);
const byRoute = {};
for (const b of bad) (byRoute[b.route] ??= []).push(b.width);
for (const [route, widths] of Object.entries(byRoute)) console.log(`  ${route}: ${widths.join(', ')}`);
await browser.close();
