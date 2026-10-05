import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { globSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { issueApiKey } from '@/lib/auth/apiKey';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { GET as exportResource } from '@/app/api/v1/exports/[resource]/route';

/**
 * Every API route runs the kernel's prologue — authenticate, rate-limit, entitle,
 * permit — through `route()` in lib/api/handler.ts.
 *
 * Ten could not, once. The kernel always answered JSON, and a payslip PDF, a CSV
 * export and a WPS bank file are streams, so each re-typed the prologue by hand,
 * and five had forgotten the fourth line: the WPS export, which bulk-exports every
 * employee's IBAN, had no rate limit at all. A second prologue made the limit
 * unforgettable; then the kernel learned to pass a returned Response through, and
 * the downloads moved onto it, `sessionOnly` so that no API key reaches them —
 * as none ever could.
 */

const API = join(__dirname, '..', '..', 'src', 'app', 'api', 'v1');

/**
 * Routes that legitimately resolve a session without the prologue.
 *
 * Both are pre-authorisation by nature: signing out must work for a session that
 * is already partly invalid, and an OAuth callback arrives from the provider
 * carrying a state token rather than a workspace context.
 */
const EXEMPT = new Set(['auth/logout/route.ts', 'integrations/meta/callback/route.ts']);

/**
 * Normalised to '/', because `globSync` returns the host's separator and EXEMPT
 * is written with '/'. On Windows neither exemption matched, so this security
 * check reported both legitimate routes as hand-rolled prologues on every run —
 * a permanently-red invariant test is one people learn to scroll past, which is
 * the failure mode that lets a real hand-rolled prologue through.
 */
const routeFiles = globSync('**/route.ts', { cwd: API }).map((file) => file.split(sep).join('/'));

describe('the security prologue', () => {
  it('is not re-implemented outside the two routes that must', () => {
    const handRolled = routeFiles.filter((file) => {
      if (EXEMPT.has(file)) return false;
      return /\bresolveCtx\s*\(\s*req/.test(readFileSync(join(API, file), 'utf8'));
    });

    // A new one here is not automatically wrong — it is a prompt to ask whether
    // the kernel would do, and to add it to EXEMPT with a reason if it will not.
    expect(handRolled).toEqual([]);
  });

  it('charges the session rate limit in one place', () => {
    // The kernel consumes the caller's session bucket; a different ceiling is
    // the route's `rateLimit`. A route that consumes it again charges every
    // request twice, which the CSV export once did.
    const doubled = routeFiles.filter((file) => /limits\.sessionUser\(/.test(readFileSync(join(API, file), 'utf8')));
    expect(doubled).toEqual([]);
  });
});

describe('a session-only download', () => {
  let fixture: Fixture;
  let apiKey = '';

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    const admin = await prisma.user.findFirstOrThrow({ where: { id: fixture.a.userId, tenantId: fixture.a.tenantId } });
    apiKey = (await issueApiKey(fixture.a.tenantId, 'download-key', admin.roleId, [], fixture.a.userId)).key;
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const exportContacts = (headers: Record<string, string>) =>
    exportResource(new Request('http://localhost/api/v1/exports/contacts', { headers }), {
      params: Promise.resolve({ resource: 'contacts' }),
    });

  it('serves the session and refuses a key holding the same role', async () => {
    expect((await exportContacts({ cookie: fixture.a.cookie })).status).toBe(200);
    // 401, not 403: the key is never read, so it cannot even be judged on its role.
    expect((await exportContacts({ authorization: `Bearer ${apiKey}` })).status).toBe(401);
  });
});
