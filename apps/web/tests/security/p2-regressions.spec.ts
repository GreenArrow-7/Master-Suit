import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { consume, limits } from '@/lib/security/ratelimit';
import { redis } from '@/lib/redis';
import { MethodNotAllowed, MethodNotAllowedError } from '@/lib/errors';
import { POST as uploadDocument } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/documents/upload/route';
import { POST as telephonyWebhook } from '@/app/api/v1/webhooks/telephony/route';
import { GET as rolesGet } from '@/app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route';
import { grantPermissions, seedTwoTenants, type Fixture, type TenantFixture } from '../helpers/fixtures';

/**
 * Regression cover for the P2 fixes that shipped without a test.
 *
 * Each case here fails if the original defect returns. They are grouped in one
 * file because they share nothing but that history — splitting them across six
 * files would hide the fact that they were a single omission.
 */
let fixture: Fixture;
let workspace: TenantFixture;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  workspace = fixture.a;

  // The kernel checks permission before it reaches the action switch or the
  // upload's size guard, so without these the cases below would assert on a 403
  // and prove nothing about the defects they exist for.
  // The tenant guard refuses an unscoped read, as it should.
  const user = await prisma.user.findFirstOrThrow({
    where: { id: workspace.userId, tenantId: workspace.tenantId },
    select: { roleId: true },
  });
  await grantPermissions(workspace.tenantId, user.roleId, [
    ['roles', 'VIEW'],
    ['hr_documents', 'CREATE'],
  ]);
});

afterAll(async () => {
  await fixture.cleanup();
});

// ── P2-8 · a wrong method returned 500 ───────────────────────────────────────
describe('P2-8: write-only actions answer 405, not 500', () => {
  it('carries the Allow header RFC 9110 requires', () => {
    const error = MethodNotAllowed('POST');
    expect(error).toBeInstanceOf(MethodNotAllowedError);
    expect(error.status).toBe(405);
    expect(error.allow).toEqual(['POST']);
    // A client told only "no" has to guess what to do instead.
    expect(error.message).toMatch(/POST/);
  });

  it('answers a GET on a POST-only action with 405 and Allow', async () => {
    const request = new Request(`http://localhost/api/v1/workspaces/${workspace.slug}/roles/create`, {
      headers: { cookie: workspace.cookie },
    });
    const response = await rolesGet(request, {
      params: Promise.resolve({ workspaceSlug: workspace.slug, action: 'create' }),
    });

    // The defect: `throw new Error('Use POST for this action.')` reached the
    // kernel's catch-all and became a 500 — a client mistake paged as a server
    // fault.
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

// ── P2-4 · uploads were buffered before the size check ───────────────────────
describe('P2-4: an oversized upload is refused before it is read', () => {
  it('rejects on Content-Length before parsing the body', async () => {
    const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;

    /**
     * The body is deliberately not valid multipart.
     *
     * That is what makes the status meaningful. The original code called
     * `req.formData()` and then `file.arrayBuffer()` before anyone asked how
     * big the payload was, so a 2 GB POST was pulled into memory and only then
     * refused. If that ordering came back, this request would fail on parsing —
     * a 422 or a 500 — because there is no file in it. A 413 can only be
     * produced by the Content-Length guard, which runs first.
     */
    const request = new Request(`http://localhost/api/v1/workspaces/${workspace.slug}/hr/documents/upload`, {
      method: 'POST',
      headers: {
        cookie: workspace.cookie,
        'content-type': 'multipart/form-data; boundary=----probe',
        'content-length': String(maxBytes * 4),
      },
      body: 'not-multipart-at-all',
    });

    const response = await uploadDocument(request, {
      params: Promise.resolve({ workspaceSlug: workspace.slug }),
    });

    expect(response.status).toBe(413);
    expect((await response.json()).detail).toMatch(new RegExp(`${env.UPLOAD_MAX_MB} MB`));
  });

  it('still refuses a file whose declared size is honest but too large', async () => {
    // The second guard: `file.size`, known without reading the bytes.
    const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
    const form = new FormData();
    form.set('file', new File([new Uint8Array(maxBytes + 1024)], 'big.pdf', { type: 'application/pdf' }));
    form.set('employeeId', 'irrelevant');
    form.set('kind', 'PASSPORT');

    const request = new Request(`http://localhost/api/v1/workspaces/${workspace.slug}/hr/documents/upload`, {
      method: 'POST',
      headers: { cookie: workspace.cookie },
      body: form,
    });

    const response = await uploadDocument(request, {
      params: Promise.resolve({ workspaceSlug: workspace.slug }),
    });
    expect(response.status).toBe(413);
  });
});

// ── P2-5 · the telephony webhook had no rate limit ───────────────────────────
describe('P2-5: the telephony webhook is rate limited before it touches the database', () => {
  const integrationKey = `probe-${randomBytes(6).toString('hex')}`;

  afterAll(async () => {
    const keys = await redis.keys(`rl:webhook:${integrationKey}*`);
    if (keys.length) await redis.del(...keys);
  });

  it('declares a webhook limit keyed by integration, not by IP', () => {
    const limit = limits.webhook(integrationKey);
    expect(limit.key).toContain(integrationKey);
    expect(limit.max).toBeGreaterThan(0);
    expect(limit.windowSeconds).toBeGreaterThan(0);
  });

  it('answers 429 once the window is spent', async () => {
    const limit = limits.webhook(integrationKey);

    // The budget is spent through the limiter itself rather than by sending 600
    // requests: the point under test is that the route consumes the bucket
    // before it touches the database, not how large the bucket is.
    for (let i = 0; i < limit.max; i++) await consume(limit);

    const response = await telephonyWebhook(
      new Request('http://localhost/api/v1/webhooks/telephony', {
        method: 'POST',
        headers: {
          'x-webhook-signature': 'probe',
          'x-webhook-timestamp': String(Date.now()),
          'x-webhook-id': 'probe',
          'x-integration-key': integrationKey,
        },
        body: '{}',
      }),
    );

    // Unauthenticated at the point of arrival — the signature cannot be checked
    // until the integration is looked up — so without a limit every hit, valid
    // or not, cost a query and anyone who learned the URL could drive that load.
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
  });
});

// ── P2-11 · platform settings displayed fabricated values ────────────────────
describe('P2-11: platform settings reads configuration rather than literals', () => {
  const source = readFileSync('src/app/(platform)/platform/settings/page.tsx', 'utf8');

  it('no longer hardcodes the values it used to invent', () => {
    // Asserted on the rendered rows, not on any mention of the old strings: the
    // file explains in a comment what it replaced, and a bare substring match
    // hits that comment.
    const rows = source.slice(source.indexOf('const rows'), source.indexOf('return ('));
    // These were shown to operators of deployed platforms. The second was false
    // when it was written: RLS was not enforced at all.
    expect(rows).not.toContain("'http://localhost:3000'");
    expect(rows).not.toContain('PostgreSQL tenant policies');
    expect(rows).not.toContain("'Unified PlatformSession'");
  });

  it('renders values taken from the environment', () => {
    expect(source).toContain('env.APP_URL');
    expect(source).toContain('env.NODE_ENV');
    // A page that describes a system other than the running one is consulted
    // precisely when someone is trying to find out what is true.
    expect(env.APP_URL).toBeTruthy();
  });
});

// ── P2-14 · there was no loading.tsx anywhere ────────────────────────────────
describe('P2-14: every route group has a loading state', () => {
  const groups = [
    'src/app/(workspace)/[workspaceSlug]',
    'src/app/(workspace)/[workspaceSlug]/sales',
    'src/app/(workspace)/[workspaceSlug]/people',
    'src/app/(workspace)/[workspaceSlug]/admin',
    'src/app/(platform)/platform',
  ];

  it.each(groups)('%s has loading.tsx', (group) => {
    // Without one, a slow query leaves the previous page on screen with no sign
    // the navigation was accepted — and the second click is the one that
    // creates the duplicate record.
    expect(existsSync(`${group}/loading.tsx`)).toBe(true);
  });

  it('each loading file renders the shared skeleton', () => {
    for (const group of groups) {
      expect(readFileSync(`${group}/loading.tsx`, 'utf8')).toContain('PageSkeleton');
    }
  });
});

// ── P2-15 · a People page threw instead of redirecting ───────────────────────
describe('P2-15: the People module is gated by a layout, not by each page', () => {
  const source = readFileSync('src/app/(workspace)/[workspaceSlug]/people/layout.tsx', 'utf8');

  it('checks the HRMS entitlement and redirects rather than throwing', () => {
    expect(source).toContain("module: 'HRMS'");
    expect(source).toContain('redirect(');
    // Mirrors sales/layout.tsx, so a page added later inherits the gate instead
    // of having to remember it.
    const sales = readFileSync('src/app/(workspace)/[workspaceSlug]/sales/layout.tsx', 'utf8');
    expect(sales).toContain("module: 'SALES'");
    expect(sales).toContain('redirect(');
  });
});

// ── P2-2 · the dashboard fired its counts sequentially ───────────────────────
describe('P2-2: the dashboard batches its queries', () => {
  const source = readFileSync('src/app/(workspace)/[workspaceSlug]/dashboard/page.tsx', 'utf8');

  it('awaits the People and Sales groups together, not one after the other', () => {
    // `await people` then `await sales` made a workspace running both modules
    // pay two sequential rounds — the slowest People query *plus* the slowest
    // Sales query, rather than the slower of the two.
    expect(source).not.toMatch(/const people = showPeople\s*\?\s*await Promise\.all/);
    expect(source).not.toMatch(/const sales = showSales\s*\?\s*await Promise\.all/);
    // Matched as "both groups inside one Promise.all" rather than as an exact
    // string: the dashboard has since grown the self-service and approval-queue
    // panels, so the array is longer than two. The invariant is one concurrent
    // round, not a particular number of queries in it.
    expect(source).toMatch(/await Promise\.all\(\[[^\]]*\bpeopleQuery\b[^\]]*\bsalesQuery\b[^\]]*\]\)/s);
  });

  it('does not cache record counts', () => {
    // Configuration is cached in this codebase; record data is not. A dashboard
    // showing yesterday's pending-approval count is one nobody can act on.
    expect(source).not.toContain("from '@/lib/redis'");
    expect(source).not.toContain('cached(');
  });
});
