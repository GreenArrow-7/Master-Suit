/**
 * A call's detail routes must respect the scope that governs the call list.
 *
 * `GET /api/v1/calls` filters by scope: below TEAM it restricts `callerId` to
 * the viewer. Every detail route beneath `/api/v1/calls/[id]/…` looked the call
 * up with `{ id, tenantId, deletedAt: null }` and nothing else, so the scope
 * stopped at the list.
 *
 * A representative holding `calls:VIEW` at OWN could therefore read any
 * colleague's call in the same workspace by id — the transcript, the AI
 * analysis, the consent record and the recording audio itself. A cuid is not a
 * secret: it appears in the caller's own list responses, in exports and in
 * notification payloads.
 *
 * These assertions drive the real route handlers, not the helper, because the
 * bug was never in the rule — one route, coaching, already implemented it
 * correctly. The bug was that the other fourteen never called it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, get } from '../helpers/request';
import { GET as getCall } from '@/app/api/v1/calls/[id]/route';
import { GET as getTranscript } from '@/app/api/v1/calls/[id]/transcript/route';
import { GET as getRecording } from '@/app/api/v1/calls/[id]/recording/route';
import { GET as getRecordingMedia } from '@/app/api/v1/calls/[id]/recording/media/route';
import { GET as getAnalysis } from '@/app/api/v1/calls/[id]/analysis/route';
import { DELETE as withdrawConsent } from '@/app/api/v1/calls/[id]/consent/route';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
let callId = '';
let ownerCookie = '';
let outsiderCookie = '';
let directorCookie = '';

/** A member of the workspace holding `calls` at exactly `scope`. */
async function member(label: string, scope: 'OWN' | 'ORGANIZATION') {
  const email = `${label}-${suffix}@call-visibility.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['calls', 'VIEW'],
      ['calls', 'EDIT'],
      ['calls', 'CREATE'],
    ],
    scope,
  );
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  // createSessionToken already returns the full `lf_session=…` cookie value.
  return { userId: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `call-vis-${suffix}`, legalName: 'Call Visibility LLC', displayName: 'Call Visibility' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const owner = await member('owner', 'OWN');
  const outsider = await member('outsider', 'OWN');
  const director = await member('director', 'ORGANIZATION');
  ownerCookie = owner.cookie;
  outsiderCookie = outsider.cookie;
  directorCookie = director.cookie;

  const call = await prisma.call.create({
    data: {
      tenantId,
      callerId: owner.userId,
      status: 'COMPLETED',
      recipientNumber: '+971500000000',
      notes: 'Commercially sensitive conversation.',
    },
  });
  callId = call.id;

  // The child records the outsider must not reach.
  await prisma.recordingConsent.create({
    data: { tenantId, callId, consentGiven: true, givenAt: new Date(), consentedBy: owner.userId },
  });
  await prisma.recording.create({
    data: {
      tenantId,
      callId,
      storageKey: `recordings/t-${tenantId}/call-${callId}/x`,
      storageBucket: 'test',
      mimeType: 'audio/mpeg',
      sizeBytes: 1,
    },
  });
  await prisma.transcript.create({
    data: { tenantId, callId, language: 'en', content: 'Sensitive transcript body.' },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('call detail routes enforce record visibility', () => {
  it('lets the caller read their own call', async () => {
    const res = await get(getCall, `/api/v1/calls/${callId}`, ownerCookie, { id: callId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('lets an ORGANIZATION-scoped viewer read it', async () => {
    const res = await get(getCall, `/api/v1/calls/${callId}`, directorCookie, { id: callId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  /**
   * The regression. Every one of these returned 200 before the fix: the caller
   * holds `calls:VIEW`, so the kernel's permission gate passed, and nothing
   * below it asked whose call it was.
   */
  it.each([
    ['detail', getCall, ''],
    ['transcript', getTranscript, '/transcript'],
    ['recording metadata', getRecording, '/recording'],
    ['recording audio', getRecordingMedia, '/recording/media'],
    ['AI analysis', getAnalysis, '/analysis'],
  ])('refuses an OWN-scoped outsider the %s', async (_label, handler, path) => {
    const res = await get(handler, `/api/v1/calls/${callId}${path}`, outsiderCookie, { id: callId });
    expect(res.status, `expected a refusal, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(403);
  });

  it('refuses an outsider withdrawing consent on a call they cannot see', async () => {
    // A write is worse than a read: withdrawing consent makes the recording
    // permanently unplayable for the people who are entitled to it.
    const res = await del(withdrawConsent, `/api/v1/calls/${callId}/consent`, outsiderCookie, { id: callId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('does not leak the call body in the refusal', async () => {
    const res = await get(getCall, `/api/v1/calls/${callId}`, outsiderCookie, { id: callId });
    expect(JSON.stringify(res.body)).not.toContain('Commercially sensitive');
  });
});
