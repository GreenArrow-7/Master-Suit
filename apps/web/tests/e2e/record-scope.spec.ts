import { test, expect } from '@playwright/test';
import { resetLoginThrottle } from './helpers';

/**
 * Record scope on the routes that load one record by id.
 *
 * The defect: `/api/v1/calls/{id}` and its sub-routes (transcript, analysis,
 * consent, recording metadata and the audio stream) loaded by `{ id, tenantId }`
 * alone, so a seller holding `calls:VIEW` at OWN scope could read a colleague's
 * call and its recording by quoting the id, while the list route beside them
 * already refused to name it. Events had no record scope at all: the list
 * returned every event in the workspace.
 *
 * Two sellers are built at OWN scope with synthetic records. Each must be
 * refused the other's records by id and by list, and must still reach their own
 * — a guard that refused everyone would pass a one-sided test.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);

async function ok(
  res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> },
  what: string,
) {
  expect(res.ok(), `${what}: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return (await res.json()) as Record<string, any>;
}

test.describe('record scope: a call or event belongs to someone', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(5 * 60_000);

  test('a seller at OWN scope cannot read a colleague’s call, recording or event by id', async ({ browser }) => {
    const api = (p: string) => `${base()}${p}`;
    const adminCtx = await browser.newContext({ baseURL: base() });
    const admin = adminCtx.request;
    await ok(await admin.post(api('/api/v1/auth/login'), { data: { email, password } }), 'admin login');

    // A role that sells at OWN scope only — built through the matrix, never by
    // editing a seeded role, so this spec cannot loosen the workspace.
    const created = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/roles/create`), {
        data: { key: `scope_${run}`, name: `Scope probe ${run}`, rank: 60 },
      }),
      'create role',
    );
    const matrix = await ok(
      await admin.get(api(`/api/v1/workspaces/${slug}/roles/matrix?roleId=${created.id}`)),
      'matrix',
    );
    const modules = new Set(['leads', 'calls', 'events', 'activities', 'tasks', 'dashboard', 'employee']);
    const changes = (matrix.permissions as { permissionId: string; module: string; action: string }[])
      .filter((perm) => modules.has(perm.module) && perm.action !== 'DELETE')
      .map((perm) => ({ permissionId: perm.permissionId, granted: true, scope: 'OWN' }));
    await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/roles/matrix-update`), {
        data: { roleId: created.id, changes },
      }),
      'grant at OWN scope',
    );

    const seller = async (tag: string) => {
      const staffEmail = `scope-${tag}-${run}@example.com`;
      const account = await ok(
        await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
          data: {
            fullName: `Scope ${tag} ${run}`,
            employeeNumber: `SC-${tag}-${run}`,
            email: staffEmail,
            roleId: created.id,
            joinedOn: new Date().toISOString().slice(0, 10),
            attendanceEligible: false,
          },
        }),
        `create ${tag}`,
      );
      const ctx = await browser.newContext({ baseURL: base() });
      await ok(
        await ctx.request.post(api('/api/v1/auth/login'), {
          data: { email: staffEmail, password: account.temporaryPassword },
        }),
        `${tag} login`,
      );
      await ok(
        await ctx.request.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
          data: { currentPassword: account.temporaryPassword, newPassword: `Scope-${run}-Aa1xxxx` },
        }),
        `${tag} password`,
      );
      return ctx;
    };
    const alice = await seller('a');
    const bob = await seller('b');

    try {
      // Alice's own lead, call and event.
      const lead = await ok(
        await alice.request.post(api('/api/v1/leads'), {
          data: { fullName: `Scope Lead ${run}`, phone: `+9715${Date.now().toString().slice(-8)}` },
        }),
        'alice lead',
      );
      const call = await ok(
        await alice.request.post(api('/api/v1/calls'), {
          data: { leadId: lead.id, recipientNumber: '+971501234567' },
        }),
        'alice call',
      );
      const event = await ok(
        await alice.request.post(api('/api/v1/events'), {
          data: {
            title: `Scope event ${run}`,
            eventType: 'PHYSICAL',
            startAt: new Date(Date.now() + 86_400_000).toISOString(),
            endAt: new Date(Date.now() + 90_000_000).toISOString(),
          },
        }),
        'alice event',
      );

      // Alice still reaches her own records: the guard refuses strangers, not owners.
      expect((await alice.request.get(api(`/api/v1/calls/${call.id}`))).status(), 'alice reads her call').toBe(200);
      expect((await alice.request.get(api(`/api/v1/events/${event.id}`))).status(), 'alice reads her event').toBe(200);

      // Bob holds the same permissions at the same scope, and is refused every
      // route that reads the record — including the recording and its audio.
      for (const path of [
        `/api/v1/calls/${call.id}`,
        `/api/v1/calls/${call.id}/transcript`,
        `/api/v1/calls/${call.id}/analysis`,
        `/api/v1/calls/${call.id}/consent`,
        `/api/v1/calls/${call.id}/recording`,
        `/api/v1/calls/${call.id}/recording/media`,
        `/api/v1/calls/${call.id}/audit`,
        `/api/v1/events/${event.id}`,
        `/api/v1/events/${event.id}/invitees`,
      ]) {
        const res = await bob.request.get(api(path));
        expect(res.status(), `bob is refused ${path}`).toBeGreaterThanOrEqual(400);
        expect(res.status(), `bob is refused ${path} without a server error`).toBeLessThan(500);
      }

      // And writes by id are refused too, not only reads.
      const patched = await bob.request.patch(api(`/api/v1/calls/${call.id}`), {
        data: { status: 'COMPLETED', outcome: 'INTERESTED' },
      });
      expect(patched.status(), 'bob cannot update the call').toBeGreaterThanOrEqual(400);

      // The lists agree with the detail routes.
      const bobCalls = await ok(await bob.request.get(api('/api/v1/calls?limit=100')), 'bob calls');
      expect(
        (bobCalls.data as { id: string }[]).some((c) => c.id === call.id),
        'the call is absent from bob’s list',
      ).toBe(false);
      const bobEvents = await ok(await bob.request.get(api('/api/v1/events')), 'bob events');
      expect(
        ((bobEvents.data ?? bobEvents) as { id: string }[]).some((e) => e.id === event.id),
        'the event is absent from bob’s list',
      ).toBe(false);

      // The administrator, who sees the whole workspace, is unaffected.
      expect((await admin.get(api(`/api/v1/calls/${call.id}`))).status(), 'admin reads the call').toBe(200);
      expect((await admin.get(api(`/api/v1/events/${event.id}`))).status(), 'admin reads the event').toBe(200);
    } finally {
      await alice.close();
      await bob.close();
      await adminCtx.close();
    }
  });
});
