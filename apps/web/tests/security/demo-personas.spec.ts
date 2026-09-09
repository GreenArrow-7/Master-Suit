/**
 * SPEC-0007 — role and tenant boundaries for the three demonstration personas.
 *
 * ST-001 to ST-005 and ST-009. These assert at the **route handler**, never at
 * the navigation, because that is the difference between proving a control and
 * proving a menu. During implementation the same checks were run against the
 * rendered pages and every one came back 200: the pages render a refusal
 * instead of returning a status, so a page-level assertion would have passed
 * while proving nothing at all.
 *
 * Requires a seeded demo database:
 *
 *   ALLOW_DEMO_SEED=yes npm run db:seed -- --reset
 *
 * Skips rather than fails when it is absent, for the reason given in
 * tests/hr/demo-dataset.spec.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createSessionToken } from '../helpers/session';
import { get } from '../helpers/request';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { GET as listOpportunities } from '@/app/api/v1/opportunities/route';
import { GET as listAccounts } from '@/app/api/v1/accounts/route';
import { GET as hrResource } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { GET as platformWorkspaces } from '@/app/api/v1/platform/workspaces/route';

const DEMO = 'youhan-one-demo';
const OTHER = 'leadersfort';

interface Persona {
  key: string;
  cookie: string;
}

let ready = false;
let demoTenantId = '';
let otherTenantId = '';
const personas: Record<string, Persona> = {};
let otherAdmin: Persona | undefined;

/**
 * SPEC-0007/FR-017 · CHG-004 — the client login, resolved by address.
 *
 * Every other persona in this file is resolved by *role*, which is right for
 * asserting what a role may do but wrong here: `org_admin` matches whichever
 * administrator the query happens to return first, so a role-resolved case
 * would keep passing if `demo@youhan.in` were deleted, renamed or never
 * created. The client credential is a named fact, so it is asserted by name.
 */
const DEMO_CLIENT_LOGIN = 'demo@youhan.in';
let clientLogin: Persona | undefined;
let clientUser: { id: string; roleKey: string; status: string } | undefined;

async function personaFor(tenantId: string, roleKey: string): Promise<Persona | undefined> {
  const user = await prisma.user.findFirst({
    where: { tenantId, role: { key: roleKey }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!user) return undefined;
  return { key: roleKey, cookie: await createSessionToken(tenantId, user.id) };
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUnique({ where: { slug: DEMO }, select: { id: true } });
  const other = await prisma.tenant.findUnique({ where: { slug: OTHER }, select: { id: true } });
  if (!demo || !other) return;
  demoTenantId = demo.id;
  otherTenantId = other.id;
  for (const key of ['sales_rep', 'hr_admin', 'org_admin']) {
    const p = await personaFor(demo.id, key);
    if (p) personas[key] = p;
  }
  otherAdmin = await personaFor(other.id, 'org_admin');

  const client = await prisma.user.findFirst({
    where: { tenantId: demo.id, email: DEMO_CLIENT_LOGIN },
    select: { id: true, status: true, role: { select: { key: true } } },
  });
  if (client) {
    clientUser = { id: client.id, roleKey: client.role?.key ?? '', status: client.status };
    clientLogin = { key: DEMO_CLIENT_LOGIN, cookie: await createSessionToken(demo.id, client.id) };
  }
  ready = Boolean(personas.sales_rep && personas.hr_admin && personas.org_admin && otherAdmin);
});

/** A refusal, not a crash. 500 must never satisfy a negative assertion. */
const REFUSED = [401, 403, 404];

const hrParams = (workspaceSlug: string, resource: string) => ({ workspaceSlug, resource });

describe.skipIf(!process.env.DATABASE_URL)('SPEC-0007 demonstration persona boundaries', () => {
  it('the fixture is present', () => {
    expect(ready, 'seed the demo database first; all three personas and the second workspace are required').toBe(true);
  });

  // ── ST-003, ST-005 · SEC-003, SEC-005 ─────────────────────────────────────
  it('ST-003 the Sales persona is refused every HR resource', async () => {
    if (!ready) return;
    for (const resource of ['employees', 'departments', 'leave-requests', 'attendance']) {
      const res = await get(
        hrResource,
        `/api/v1/workspaces/${DEMO}/hr/${resource}`,
        personas.sales_rep!.cookie,
        hrParams(DEMO, resource),
      );
      expect(REFUSED, `sales_rep reached HR ${resource} with ${res.status}`).toContain(res.status);
      expect(res.status, 'a 500 is a broken route, not a refusal').not.toBe(500);
    }
  });

  it('ST-003b the HR persona is refused the Sales collections', async () => {
    if (!ready) return;
    const cases: [string, typeof listLeads][] = [
      ['/api/v1/leads', listLeads],
      ['/api/v1/opportunities', listOpportunities],
      ['/api/v1/accounts', listAccounts],
    ];
    for (const [path, handler] of cases) {
      const res = await get(handler, path, personas.hr_admin!.cookie);
      expect(REFUSED, `hr_admin reached ${path} with ${res.status}`).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
  });

  // ── ST-004 · SEC-005 ──────────────────────────────────────────────────────
  // Without this, a suite of refusals would pass just as well against three
  // broken logins.
  it('ST-004 each persona still reaches what its own role grants', async () => {
    if (!ready) return;
    const hr = await get(
      hrResource,
      `/api/v1/workspaces/${DEMO}/hr/employees`,
      personas.hr_admin!.cookie,
      hrParams(DEMO, 'employees'),
    );
    expect(hr.status, 'hr_admin cannot read employees — the negative tests prove nothing').toBe(200);

    const leads = await get(listLeads, '/api/v1/leads', personas.sales_rep!.cookie);
    expect(leads.status, 'sales_rep cannot read leads').toBe(200);

    const adminHr = await get(
      hrResource,
      `/api/v1/workspaces/${DEMO}/hr/employees`,
      personas.org_admin!.cookie,
      hrParams(DEMO, 'employees'),
    );
    const adminLeads = await get(listLeads, '/api/v1/leads', personas.org_admin!.cookie);
    expect(adminHr.status, 'org_admin cannot read HR').toBe(200);
    expect(adminLeads.status, 'org_admin cannot read Sales').toBe(200);
  });

  // ── ST-005 · SEC-003 ──────────────────────────────────────────────────────
  it('ST-005 no persona reaches the platform control plane, including the Management persona', async () => {
    if (!ready) return;
    for (const key of ['sales_rep', 'hr_admin', 'org_admin']) {
      const res = await get(platformWorkspaces, '/api/v1/platform/workspaces', personas[key]!.cookie);
      expect(REFUSED, `${key} reached the platform control plane with ${res.status}`).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
  });

  // ── ST-001 · SEC-004 · both directions ────────────────────────────────────
  it('ST-001 a demo persona cannot reach the other workspace', async () => {
    if (!ready) return;
    for (const key of ['hr_admin', 'org_admin']) {
      for (const resource of ['employees', 'departments']) {
        const res = await get(
          hrResource,
          `/api/v1/workspaces/${OTHER}/hr/${resource}`,
          personas[key]!.cookie,
          hrParams(OTHER, resource),
        );
        expect(REFUSED, `${key} reached ${OTHER}/${resource} with ${res.status}`).toContain(res.status);
        expect(res.status).not.toBe(500);
      }
    }
  });

  it('ST-001b the other workspace cannot reach the demo workspace', async () => {
    if (!ready) return;
    const res = await get(
      hrResource,
      `/api/v1/workspaces/${DEMO}/hr/employees`,
      otherAdmin!.cookie,
      hrParams(DEMO, 'employees'),
    );
    expect(REFUSED, `${OTHER} admin reached ${DEMO} HR with ${res.status}`).toContain(res.status);
    expect(res.status).not.toBe(500);

    // Leadersfort is HRMS-only, so Sales is refused by entitlement as well as
    // by scope — a second, independent reason, which is the point of asserting it.
    const leads = await get(listLeads, '/api/v1/leads', otherAdmin!.cookie);
    expect(REFUSED).toContain(leads.status);
  });

  it('ST-001c no demo record leaks into the other workspace responses', async () => {
    if (!ready) return;
    const res = await get(
      hrResource,
      `/api/v1/workspaces/${OTHER}/hr/employees`,
      otherAdmin!.cookie,
      hrParams(OTHER, 'employees'),
    );
    if (res.status !== 200) return; // refused outright, which is stronger
    const body = JSON.stringify(res.body ?? {});
    const demoNumbers = await prisma.employeeProfile.findMany({
      where: { tenantId: demoTenantId },
      select: { employeeNumber: true },
      take: 20,
    });
    for (const e of demoNumbers) {
      expect(body.includes(e.employeeNumber), `${e.employeeNumber} leaked into ${OTHER}`).toBe(false);
    }
  });

  // ── The client login ─ SPEC-0007/FR-017 · CHG-004 ─────────────────────
  //
  // One credential is handed to clients. These five cases are the whole of what
  // makes that safe, asserted against that address specifically rather than
  // against its role.

  it('ST-012 the client login exists, is tenant-scoped, and is not a platform administrator', async () => {
    if (!ready) return;
    expect(clientUser, `${DEMO_CLIENT_LOGIN} is not seeded — the demonstration has no client login`).toBeTruthy();
    expect(clientUser!.status, 'the client login is not ACTIVE').toBe('ACTIVE');
    expect(clientUser!.roleKey, 'the client login is not on the expected role').toBe('org_admin');

    // The platform identity is the escalation that matters: a workspace role
    // cannot grant it, and only this field can.
    const platform = await prisma.platformUser.findUnique({
      where: { normalizedEmail: DEMO_CLIENT_LOGIN },
      select: { platformRole: true, status: true },
    });
    expect(platform, 'the client login has no platform identity, so it cannot sign in').toBeTruthy();
    expect(platform!.platformRole, 'the client login is not an ordinary USER').toBe('USER');

    // And no second, wider membership anywhere. One credential must mean one
    // workspace; a second membership is how "one login" quietly becomes two.
    const memberships = await prisma.workspaceMembership.count({
      where: { salesUser: { email: DEMO_CLIENT_LOGIN } },
    });
    expect(memberships, 'the client login holds more than one workspace membership').toBeLessThanOrEqual(1);
  });

  it('ST-013 the client login reaches Sales and HRMS with the same session', async () => {
    if (!ready) return;
    if (!clientLogin) return;
    // The positive half. Without it the four refusals below would pass just as
    // well against a login that reaches nothing at all.
    const leads = await get(listLeads, '/api/v1/leads', clientLogin.cookie);
    const opportunities = await get(listOpportunities, '/api/v1/opportunities', clientLogin.cookie);
    const accounts = await get(listAccounts, '/api/v1/accounts', clientLogin.cookie);
    const hr = await get(
      hrResource,
      `/api/v1/workspaces/${DEMO}/hr/employees`,
      clientLogin.cookie,
      hrParams(DEMO, 'employees'),
    );
    expect(leads.status, 'the client login cannot read Sales leads').toBe(200);
    expect(opportunities.status, 'the client login cannot read opportunities').toBe(200);
    expect(accounts.status, 'the client login cannot read accounts').toBe(200);
    expect(hr.status, 'the client login cannot read HR employees').toBe(200);
  });

  it('ST-014 the client login cannot reach the other workspace', async () => {
    if (!ready) return;
    if (!clientLogin) return;
    for (const resource of ['employees', 'departments']) {
      const res = await get(
        hrResource,
        `/api/v1/workspaces/${OTHER}/hr/${resource}`,
        clientLogin.cookie,
        hrParams(OTHER, resource),
      );
      expect(REFUSED, `the client login reached ${OTHER}/${resource} with ${res.status}`).toContain(res.status);
      expect(res.status, 'a 500 is a broken route, not a refusal').not.toBe(500);
    }
  });

  it('ST-015 the client login is refused the platform control plane', async () => {
    if (!ready) return;
    if (!clientLogin) return;
    const res = await get(platformWorkspaces, '/api/v1/platform/workspaces', clientLogin.cookie);
    expect(REFUSED, `the client login reached the platform control plane with ${res.status}`).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  /**
   * ST-016 — the isolation the client login depends on is enforced *below* the
   * application, so that a routing mistake above it cannot expose another
   * tenant.
   *
   * Asserted as the database property rather than by a second cross-tenant
   * request: `ST-014` already covers the request path, and the value of this
   * case is that it fails even if the route layer is bypassed entirely.
   */
  it('ST-016 the tables the client login reads are protected by forced row-level security', async () => {
    if (!ready) return;
    const tables = ['Lead', 'Opportunity', 'Account', 'Contact', 'EmployeeProfile', 'HrAttendanceRecord'];
    const rows = await prisma.$queryRawUnsafe<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      tables,
    );
    expect(rows.length, 'some tables the client login reads were not found').toBe(tables.length);
    const unprotected = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname);
    expect(unprotected, 'tables the client login reads without RLS enabled and forced').toEqual([]);
  });

  // ── ST-009 · SEC-006 ──────────────────────────────────────────────────────
  it('ST-009 the demo workspace holds no integration connection, so nothing can dispatch or call back', async () => {
    if (!ready) return;
    const connections = await prisma.integrationConnection.count({ where: { tenantId: demoTenantId } });
    expect(connections, 'an integration connection exists — outbound dispatch becomes possible').toBe(0);
    expect(otherTenantId).not.toBe('');
  });

  it('ST-008 the environment selects inert providers, so no message can leave', () => {
    // The control for SEC-006 is environment configuration, not application
    // code: the demo deployment selects mock providers and holds no vendor
    // credential. Asserted here so a demo environment configured otherwise
    // fails a test rather than surprising someone mid-demonstration.
    expect(process.env.EMAIL_PROVIDER ?? 'mock').toBe('mock');
    expect(process.env.WHATSAPP_PROVIDER ?? 'mock').toBe('mock');
    expect(process.env.ANTIVIRUS_PROVIDER ?? 'mock').toBe('mock');
    expect(process.env.GEMINI_API_KEY ?? '', 'a live AI key is configured for a demo run').toBe('');
  });
});

/**
 * The remaining cases TASK-006 declares.
 *
 * Split into their own block because they are about a different thing: the
 * first block proves what each persona may *not* reach, and these prove what
 * each persona *may* reach, plus the controls that sit underneath.
 */
describe.skipIf(!process.env.DATABASE_URL)('SPEC-0007 persona access and underlying controls', () => {
  it('IT-006 the Sales persona reaches its own Sales collections', async () => {
    if (!ready) return;
    for (const [path, handler] of [
      ['/api/v1/leads', listLeads],
      ['/api/v1/opportunities', listOpportunities],
    ] as const) {
      const res = await get(handler, path, personas.sales_rep!.cookie);
      expect(res.status, `sales_rep cannot read ${path}`).toBe(200);
    }
  });

  it('IT-007 the HR persona reaches the HR collections, and the leave queue carries all three states', async () => {
    if (!ready) return;
    for (const resource of ['employees', 'departments']) {
      const res = await get(
        hrResource,
        `/api/v1/workspaces/${DEMO}/hr/${resource}`,
        personas.hr_admin!.cookie,
        hrParams(DEMO, resource),
      );
      expect(res.status, `hr_admin cannot read ${resource}`).toBe(200);
    }
    // The approval queue is the HR demonstration's centrepiece. A queue with
    // only one state in it shows nothing worth showing.
    const grouped = await prisma.hrLeaveRequest.groupBy({
      by: ['status'],
      where: { tenantId: demoTenantId },
      _count: { _all: true },
    });
    const states = grouped.map((g) => String(g.status));
    for (const s of ['APPROVED', 'PENDING', 'REJECTED']) expect(states).toContain(s);
  });

  it('IT-008 the Management persona reaches both modules', async () => {
    if (!ready) return;
    const hr = await get(
      hrResource,
      `/api/v1/workspaces/${DEMO}/hr/employees`,
      personas.org_admin!.cookie,
      hrParams(DEMO, 'employees'),
    );
    const leads = await get(listLeads, '/api/v1/leads', personas.org_admin!.cookie);
    expect(hr.status).toBe(200);
    expect(leads.status).toBe(200);
  });

  /**
   * ST-002 — the database layer, for the models this specification populates.
   *
   * Narrower than the test plan first described it, and deliberately so. The
   * cross-tenant *read* proof over a NOBYPASSRLS role already exists in
   * tests/tenant/rls.spec.ts and covers every tenant, this one included;
   * duplicating it here would need `RLS_DATABASE_URL`, which a demo database
   * does not have, and a duplicate that silently skips is worse than none.
   *
   * What this asserts instead is the property that duplicate would depend on:
   * that every HR table SPEC-0007 writes to actually has row-level security
   * enabled and forced. If a future migration adds an HR model without a
   * policy, this fails.
   */
  it('ST-002 every HR table this specification populates has RLS enabled and forced', async () => {
    if (!ready) return;
    const tables = [
      'HrAttendanceRecord',
      'HrLeaveRequest',
      'HrLeaveBalance',
      'HrLeaveType',
      'HrHoliday',
      'HrShift',
      'EmployeeProfile',
      'Department',
      'Designation',
    ];
    const rows = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      tables,
    );
    expect(rows.length, 'some expected HR tables were not found').toBe(tables.length);
    const unprotected = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname);
    expect(unprotected, 'HR tables without RLS enabled and forced').toEqual([]);
  });

  /**
   * ST-010 — the throttles apply to a demonstration login like any other.
   *
   * Asserted as configuration rather than by hammering the login route: making
   * this suite trip the real per-IP bucket would leave every later spec, and
   * anyone running the app locally afterwards, locked out for fifteen minutes.
   * The behaviour itself is exercised by tests/security/ratelimit.spec.ts.
   */
  it('ST-010 demonstration logins are ordinary accounts, subject to the same protections', async () => {
    if (!ready) return;
    const { limits } = await import('@/lib/security/ratelimit');
    const user = await prisma.user.findFirst({
      where: { tenantId: demoTenantId, role: { key: 'hr_admin' } },
      select: { email: true },
    });
    expect(user?.email).toBeTruthy();
    // A demo login must resolve to a real per-account bucket, not be exempt.
    const bucket = limits.loginPerAccount(user!.email);
    expect(bucket, 'a demonstration login has no per-account rate-limit bucket').toBeTruthy();
    expect(bucket.max, 'the per-account login limit is unbounded for a demo account').toBeGreaterThan(0);

    // And it must be an ordinary workspace member, not a platform role.
    const membership = await prisma.workspaceMembership.findFirst({
      where: { tenantId: demoTenantId, salesUser: { email: user!.email } },
      select: { platformUser: { select: { platformRole: true } } },
    });
    expect(membership?.platformUser?.platformRole ?? 'USER').toBe('USER');
  });

  /**
   * ST-011 — no credential in anything this specification committed.
   *
   * The seed prints a generated password once to the operator's terminal, by
   * design. Nothing may write one to a file.
   */
  it('ST-011 no credential appears in the specification artefacts or the generator', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const roots = [
      'specs/SPEC-0007-client-demo-data-personas-reset',
      'apps/web/prisma/seed',
      'apps/web/tests/hr',
      'apps/web/tests/security',
      'apps/web/tests/e2e/demo-walkthrough.spec.ts',
      'docs/DEMO.md',
    ];
    const repo = join(process.cwd(), '..', '..');
    const files: string[] = [];
    const walk = (p: string) => {
      const abs = join(repo, p);
      let s;
      try {
        s = statSync(abs);
      } catch {
        return;
      }
      if (s.isDirectory()) for (const e of readdirSync(abs)) walk(join(p, e));
      else files.push(abs);
    };
    roots.forEach(walk);
    expect(files.length, 'nothing was scanned, so this proves nothing').toBeGreaterThan(10);

    const leaks = [
      // The negative lookahead matters: `const DEMO_PASSWORD = process.env.DEMO_PASSWORD`
      // is the correct way to read a credential and must not be reported as
      // leaking one. Without it this case failed on the seed's own source.
      /DEMO_PASSWORD\s*=\s*(?!process\.env)["']?[A-Za-z0-9._~+/-]{8,}/,
      /PLATFORM_OWNER_PASSWORD\s*=\s*(?!process\.env)["']?[A-Za-z0-9._~+/-]{8,}/,
      // Eight characters or more. The one-character placeholders this suite
      // uses to exercise the database-name gate (postgresql://u:p@…) are not
      // credentials, and a check that flags them trains people to ignore it.
      /postgresql:\/\/[^\s:]+:[^\s@'"]{8,}@/,
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const re of leaks) if (re.test(text)) offenders.push(`${f}: ${text.match(re)![0].slice(0, 30)}…`);
    }
    expect(offenders, 'a credential appears in a committed artefact').toEqual([]);
  });
});
