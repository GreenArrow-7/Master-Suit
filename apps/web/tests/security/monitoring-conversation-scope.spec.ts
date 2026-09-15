/**
 * What an ordinary monitoring grant reads about a customer's calls.
 *
 * `calls:VIEW` is the monitoring allowlist's permission for the call log, and it
 * is also the permission every coaching surface declares. So a read-only grant
 * issued to look at lead routing carried coaching notes, per-call sentiment and
 * talk ratios, audit and practice scores, objection snippets quoted from the
 * transcript, and free-text call notes. VIEW-only is not evidence the content is
 * not sensitive.
 *
 * The rule now: the call's metadata (who, when, how long, the outcome) is
 * monitoring; anything said on the call, or derived from what was said, needs a
 * grant issued with `sensitive` — the same authorisation transcripts and
 * recordings already required. Aggregate coaching and audit scores are withheld
 * too, pending an explicit owner decision. Customer users are unaffected.
 *
 * Checked with populated data on the API routes and on the page server
 * components, whose rendered element trees are searched for the values.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import { openGrant } from '@/lib/auth/platform-access';
import { GET as listCalls } from '@/app/api/v1/calls/route';
import { GET as readCall } from '@/app/api/v1/calls/[id]/route';
import { GET as readCallCoaching } from '@/app/api/v1/calls/[id]/coaching/route';
import { GET as readCoaching } from '@/app/api/v1/coaching/route';
import { GET as listPractice } from '@/app/api/v1/practice/route';
import { GET as readPractice } from '@/app/api/v1/practice/[id]/route';
import CallDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/page';
import CallsPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/page';
import CoachingPage from '@/app/(workspace)/[workspaceSlug]/sales/coaching/page';
import CallAuditsPage from '@/app/(workspace)/[workspaceSlug]/sales/call-audits/page';
import DashboardPage from '@/app/(workspace)/[workspaceSlug]/dashboard/page';
import EventDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/events/[id]/page';
import { createPlatformSessionToken, createSessionToken } from '../helpers/session';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { get } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `convscope-${suffix}`;
const NOTE = `Call note ${suffix}: client disclosed their budget`;
const COACHING = `Coaching ${suffix}: rushed the pricing objection`;
const SNIPPET = `Snippet ${suffix}: we are already talking to your competitor`;

let tenantId = '';
let callId = '';
const cookies = { plain: '', sensitive: '', customer: '' };

async function monitor(label: string, sensitive: boolean) {
  const email = `${label}.${suffix}@platform.test`;
  const identity = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: `Monitor ${label}`,
      passwordHash: 'x',
      // A session proven with the monitoring password needs one to exist; the
      // value is a placeholder, never checked, as passwordHash is.
      monitoringPasswordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'SUPPORT',
    },
  });
  await openGrant({
    platformUserId: identity.id,
    tenantId,
    kind: 'READ',
    sensitive,
    reason: sensitive ? 'Reviewing a disputed call with the customer' : 'Investigating a lead-routing fault',
  });
  return createPlatformSessionToken(identity.id, tenantId, { credentialPurpose: 'MONITORING' });
}

/** Every string a rendered element tree would put on screen or in props. */
function strings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) strings(item, out, seen);
    return out;
  }
  if ('props' in (node as object)) return strings((node as { props: unknown }).props, out, seen);
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_') || typeof value === 'function') continue;
    strings(value, out, seen);
  }
  return out;
}

async function renderAs(as: keyof typeof cookies, page: (props: never) => Promise<unknown>, params = {}) {
  cookieJar.value = cookies[as];
  const tree = await page({
    params: Promise.resolve({ workspaceSlug: slug, ...params }),
    searchParams: Promise.resolve({}),
  } as never);
  return strings(tree).join('\n');
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'ConvScope LLC', displayName: 'ConvScope', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `seller-${suffix}`, name: 'Seller', rank: 20, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [
    ['calls', 'VIEW'],
    ['leads', 'VIEW'],
  ]);
  const seller = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `seller.${suffix}@convscope.test`,
    fullName: `Seller ${suffix}`,
  });
  cookies.customer = await createSessionToken(tenantId, seller.id);

  const call = await prisma.call.create({
    data: { tenantId, callerId: seller.id, status: 'COMPLETED', durationSecs: 184, notes: NOTE, startedAt: new Date() },
  });
  callId = call.id;
  await prisma.coachingNote.create({ data: { tenantId, callId, authorId: seller.id, body: COACHING } });
  const objection = await prisma.objection.create({ data: { tenantId, name: `Competitor ${suffix}` } });
  await prisma.objectionMatch.create({
    data: { tenantId, callId, objectionId: objection.id, phrase: 'competitor', snippet: SNIPPET },
  });

  cookies.plain = await monitor('plain', false);
  cookies.sensitive = await monitor('sensitive', true);
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

const MISSING_ID = 'clzzzzzzzzzzzzzzzzzzzzzz';

describe('an ordinary monitoring grant', () => {
  it('still lists and opens the call — the metadata is what monitoring is for', async () => {
    const list = await get(listCalls, '/api/v1/calls', cookies.plain);
    expect(list.status).toBe(200);
    const row = list.body.data.find((c: { id: string }) => c.id === callId);
    expect(row).toMatchObject({ id: callId, status: 'COMPLETED', durationSecs: 184 });

    const one = await get(readCall, `/api/v1/calls/${callId}`, cookies.plain, { id: callId });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: callId, status: 'COMPLETED' });
  });

  it('gets neither call notes, from the list nor from the call', async () => {
    const list = await get(listCalls, '/api/v1/calls', cookies.plain);
    expect(JSON.stringify(list.body)).not.toContain(suffix + ': client');
    expect(list.body.data.find((c: { id: string }) => c.id === callId).notes).toBeNull();
    const one = await get(readCall, `/api/v1/calls/${callId}`, cookies.plain, { id: callId });
    expect(one.body.notes).toBeNull();
  });

  it('is refused coaching notes, coaching metrics and practice sessions, before any lookup', async () => {
    for (const [handler, path, params] of [
      [readCallCoaching, `/api/v1/calls/${callId}/coaching`, { id: callId }],
      [readCoaching, '/api/v1/coaching', {}],
      [listPractice, '/api/v1/practice', {}],
      [readPractice, `/api/v1/practice/${MISSING_ID}`, { id: MISSING_ID }],
    ] as const) {
      const res = await get(handler, path, cookies.plain, params);
      expect(res.status, path).toBe(403);
      expect(JSON.stringify(res.body), path).toMatch(/granted separately/i);
      expect(JSON.stringify(res.body), path).not.toContain(suffix);
    }
  });

  it('sees the call page without the note, the coaching notes or the objection snippet', async () => {
    const text = await renderAs('plain', CallDetailPage as never, { id: callId });
    expect(text).toContain('Not included in this access.');
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain(COACHING);
    expect(text).not.toContain(SNIPPET);
  });

  it('gets the call list page without notes in the grid payload', async () => {
    const text = await renderAs('plain', CallsPage as never);
    expect(text).toContain(`Seller ${suffix}`);
    expect(text).not.toContain(NOTE);
  });

  it('is shown a notice, and no data, on the coaching and call-audit screens', async () => {
    for (const page of [CoachingPage, CallAuditsPage]) {
      const text = await renderAs('plain', page as never);
      expect(text).toContain('Not included in this access');
      expect(text).not.toContain(suffix);
    }
  });

  it('is refused the dashboard (its audit score) and event pages (AI meeting summaries) outright', async () => {
    // The dashboard is self-service, which a monitoring session never reaches;
    // events are not in the monitoring allowlist. Both refusals are what keeps
    // the average audit score and meeting summaries out, so they are asserted.
    await expect(renderAs('plain', DashboardPage as never)).rejects.toThrow(/forbidden/);
    await expect(renderAs('plain', EventDetailPage as never, { id: MISSING_ID })).rejects.toThrow(/forbidden/);
  });
});

describe('a monitoring grant issued with sensitive scope (positive control)', () => {
  it('reads the notes and the coaching routes', async () => {
    const one = await get(readCall, `/api/v1/calls/${callId}`, cookies.sensitive, { id: callId });
    expect(one.body.notes).toBe(NOTE);
    const coaching = await get(readCallCoaching, `/api/v1/calls/${callId}/coaching`, cookies.sensitive, { id: callId });
    expect(coaching.status).toBe(200);
    expect(JSON.stringify(coaching.body)).toContain(COACHING);
    for (const [handler, path] of [
      [readCoaching, '/api/v1/coaching'],
      [listPractice, '/api/v1/practice'],
    ] as const) {
      expect((await get(handler, path, cookies.sensitive, {})).status, path).toBe(200);
    }
    // Past the gate: the missing session answers for itself.
    const practice = await get(readPractice, `/api/v1/practice/${MISSING_ID}`, cookies.sensitive, { id: MISSING_ID });
    expect(practice.status).toBe(404);
  });

  it('sees the note, the coaching notes and the snippet on the call page', async () => {
    const text = await renderAs('sensitive', CallDetailPage as never, { id: callId });
    expect(text).toContain(NOTE);
    expect(text).toContain(COACHING);
    expect(text).toContain(SNIPPET);
  });

  it('gets the coaching and call-audit screens', async () => {
    for (const page of [CoachingPage, CallAuditsPage]) {
      expect(await renderAs('sensitive', page as never)).not.toContain('Not included in this access');
    }
  });
});

describe('the workspace’s own people', () => {
  it('are unchanged: notes, coaching and every coaching screen', async () => {
    const one = await get(readCall, `/api/v1/calls/${callId}`, cookies.customer, { id: callId });
    expect(one.body.notes).toBe(NOTE);
    const coaching = await get(readCallCoaching, `/api/v1/calls/${callId}/coaching`, cookies.customer, { id: callId });
    expect(JSON.stringify(coaching.body)).toContain(COACHING);
    expect((await get(readCoaching, '/api/v1/coaching', cookies.customer, {})).status).toBe(200);

    const page = await renderAs('customer', CallDetailPage as never, { id: callId });
    expect(page).toContain(NOTE);
    expect(page).toContain(COACHING);
    expect(page).toContain(SNIPPET);
    for (const screen of [CoachingPage, CallAuditsPage]) {
      expect(await renderAs('customer', screen as never)).not.toContain('Not included in this access');
    }
  });
});
