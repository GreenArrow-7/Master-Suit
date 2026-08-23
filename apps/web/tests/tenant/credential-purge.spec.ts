/**
 * Removing a workspace's stored API keys must actually remove them.
 *
 * ── Why this is asserted rather than assumed ────────────────────────────────
 *
 * "Disconnected" is a status, and a status is cheap to set. What matters when
 * somebody clears a leaked key is that the ciphertext is *gone* from the row — a
 * connection flagged DISCONNECTED while still holding a usable token is the
 * worst of both readings: the screen says the key is gone, the database says
 * otherwise, and so nobody rotates it at the vendor either.
 *
 * The bulk endpoint is also irreversible in a way the per-provider one is not,
 * because it takes telephony, messaging and AI at once. No vendor reissues the
 * key you deleted. So the confirmation phrase is load-bearing, and the wrong
 * workspace losing its credentials is the failure that would matter most.
 *
 * Every case here drives the real DELETE handler through the request helper,
 * with a real session cookie resolved by the real `resolveCtx`. An earlier
 * draft reimplemented the route's `where` clause in the test and asserted
 * against that; it passed happily against a route mutated to ignore the
 * provider filter entirely, because it was testing the copy.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { connectionCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { DELETE as purgeAll } from '@/app/api/v1/integrations/route';
import { seedTwoTenants, grantPermissions, type Fixture } from '../helpers/fixtures';
import { del } from '../helpers/request';

const SECRET = `sk-purge-${randomBytes(4).toString('hex')}`;
const CONFIRM = 'remove-all-credentials';

let fx: Fixture;

async function seedConnections(tenantId: string) {
  await prisma.integrationConnection.deleteMany({ where: { tenantId } });
  await prisma.integrationConnection.createMany({
    data: [
      { tenantId, provider: 'gemini', status: 'CONNECTED', credentials: wrapCredentials({ apiKey: SECRET }) },
      { tenantId, provider: 'twilio', status: 'CONNECTED', credentials: wrapCredentials({ authToken: SECRET }) },
    ],
  });
}

beforeEach(async () => {
  if (!fx) {
    fx = await seedTwoTenants();
    // The fixture's admin role covers the sales modules; `integrations` is not
    // among them, and MANAGE_CONFIGURATION is what this route demands.
    for (const tenant of [fx.a, fx.b]) {
      // Scoped by tenantId, because the Prisma tenant guard refuses a bare
      // `findUnique` on a tenant-owned model — including from a test.
      const user = await prisma.user.findFirstOrThrow({
        where: { id: tenant.userId, tenantId: tenant.tenantId },
        select: { roleId: true },
      });
      await grantPermissions(tenant.tenantId, user.roleId!, [
        ['integrations', 'VIEW'],
        ['integrations', 'MANAGE_CONFIGURATION'],
      ]);
    }
  }
  await seedConnections(fx.a.tenantId);
  await seedConnections(fx.b.tenantId);
});

afterAll(async () => {
  if (fx) {
    await prisma.integrationConnection.deleteMany({
      where: { tenantId: { in: [fx.a.tenantId, fx.b.tenantId] } },
    });
    await fx.cleanup();
  }
});

const count = (tenantId: string) => prisma.integrationConnection.count({ where: { tenantId } });

describe('bulk credential removal', () => {
  it('leaves no row, and therefore no ciphertext, behind', async () => {
    // The secret really is in there first, or the assertion after proves nothing.
    expect((await connectionCredentials(fx.a.tenantId, 'gemini'))?.apiKey).toBe(SECRET);

    const res = await del(purgeAll, `/api/v1/integrations?confirm=${CONFIRM}`, fx.a.cookie);
    expect(res.status).toBe(200);
    expect([...res.body.removed].sort()).toEqual(['gemini', 'twilio']);

    expect(await count(fx.a.tenantId)).toBe(0);
    expect(await connectionCredentials(fx.a.tenantId, 'gemini')).toBeNull();
  });

  /**
   * A purge is the action most likely to be run in a hurry, on the wrong tab,
   * by somebody who administers more than one workspace.
   */
  it('touches only the workspace that asked', async () => {
    await del(purgeAll, `/api/v1/integrations?confirm=${CONFIRM}`, fx.a.cookie);

    expect(await count(fx.b.tenantId)).toBe(2);
    expect((await connectionCredentials(fx.b.tenantId, 'gemini'))?.apiKey).toBe(SECRET);
  });

  it('removes only the named providers when a subset is given', async () => {
    const res = await del(purgeAll, `/api/v1/integrations?confirm=${CONFIRM}&providers=gemini`, fx.a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.removed).toEqual(['gemini']);

    const left = await prisma.integrationConnection.findMany({
      where: { tenantId: fx.a.tenantId },
      select: { provider: true },
    });
    expect(left.map((c) => c.provider)).toEqual(['twilio']);
    expect((await connectionCredentials(fx.a.tenantId, 'twilio'))?.authToken).toBe(SECRET);
  });

  it('names what it removed rather than only counting it', async () => {
    // "2 removed" on an action with no undo leaves an administrator guessing
    // which two.
    const res = await del(purgeAll, `/api/v1/integrations?confirm=${CONFIRM}`, fx.a.cookie);
    expect(res.body.count).toBe(2);
    expect(res.body.removed).toContain('gemini');
  });

  it('refuses a provider name it does not recognise, and removes nothing', async () => {
    const res = await del(purgeAll, `/api/v1/integrations?confirm=${CONFIRM}&providers=gemini,nosuch`, fx.a.cookie);
    expect(res.status).toBe(422);
    expect(await count(fx.a.tenantId)).toBe(2);
  });
});

describe('the confirmation phrase', () => {
  /**
   * `z.literal`, not a truthiness check. `?confirm=1` is what a stray retry, a
   * prefetch or a copied curl line sends, and this is the one action in the
   * product with nothing to undo it.
   */
  it.each(['', 'true', '1', 'yes', 'REMOVE-ALL-CREDENTIALS'])(
    'refuses confirm=%j and removes nothing',
    async (value) => {
      const res = await del(purgeAll, `/api/v1/integrations?confirm=${value}`, fx.a.cookie);
      expect(res.status).toBe(422);
      expect(await count(fx.a.tenantId)).toBe(2);
    },
  );

  it('refuses a request with no confirmation at all', async () => {
    const res = await del(purgeAll, '/api/v1/integrations', fx.a.cookie);
    expect(res.status).toBe(422);
    expect(await count(fx.a.tenantId)).toBe(2);
  });

  /**
   * The phrase is declared twice — in the route, and in the client component
   * that types it into the query string — because a client component cannot
   * import from a module that reaches Prisma. Two literals that must agree with
   * nothing checking they do is a button that silently stops working: the
   * request is refused, the UI says "that change was refused", and the cause is
   * one word.
   */
  it('is the same phrase in the route and in the button that sends it', () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    const inRoute = /const CONFIRM_PHRASE = '([^']+)'/.exec(read('src/app/api/v1/integrations/route.ts'))?.[1];
    const board = read('src/components/workspace/IntegrationBoard.tsx');
    const inBoard = /const CONFIRM_PHRASE = '([^']+)'/.exec(board)?.[1];

    expect(inRoute, 'the route no longer declares CONFIRM_PHRASE').toBeTruthy();
    expect(inBoard, 'the board no longer declares CONFIRM_PHRASE').toBeTruthy();
    expect(inBoard).toBe(inRoute);
    // And the value both sides agree on is the one these tests exercise.
    expect(inRoute).toBe(CONFIRM);
    expect(board).toMatch(/\/api\/v1\/integrations\?confirm=\$\{CONFIRM_PHRASE\}/);
  });
});

/**
 * The per-provider control, asserted statically because the alternative is a
 * browser and this is one button.
 *
 * It exists because removal was three steps behind a button labelled for the
 * opposite intent: Configure → scroll past the credential form → Disconnect.
 * Somebody who wants a key gone is looking at the card that says ERROR, and an
 * action they cannot find is an action the product does not have.
 */
describe('the per-provider Remove key button', () => {
  const board = readFileSync(path.resolve(__dirname, '../..', 'src/components/workspace/IntegrationBoard.tsx'), 'utf8');
  /**
   * Everything in ProviderPanel before its collapsible form — i.e. what shows
   * without pressing Configure.
   *
   * Anchored to `function ProviderPanel(` rather than to the first `{open && (`
   * in the file: RemoveAllKeys higher up has an `open` state and a block of its
   * own, so the naive slice ended before ProviderPanel had even begun and every
   * assertion below failed against a header that was not one.
   */
  const panel = board.slice(board.indexOf('function ProviderPanel('));
  const header = panel.slice(0, panel.indexOf('{open && ('));

  it('sits on the card header, not inside the form', () => {
    expect(header).toContain('Remove key');
  });

  it('is offered only when there is a key to remove, and only to someone who may', () => {
    expect(header).toMatch(/\{configured && canEdit && \(/);
  });

  it('asks twice before it removes', () => {
    // One press arms, the second sends. A single-press destructive control next
    // to Configure is a misclick away from a trip to the vendor console.
    expect(header).toMatch(/confirmRemove \? send\('disconnect'\) : setConfirmRemove\(true\)/);
    expect(header).toContain('Confirm — remove key');
  });

  it('leaves exactly one removal control on the card', () => {
    // Two buttons for one destructive action, with different labels and
    // different confirmations, made "which did I press" unanswerable.
    expect(board.match(/send\('disconnect'\)/g)).toHaveLength(1);
    expect(board).not.toContain('Disconnecting…');
  });

  it('reports the outcome with the form closed', () => {
    // The button is reachable while collapsed, and an action that says nothing
    // reads as an action that did nothing.
    expect(board).toMatch(/\{message && !open && \(/);
    expect(board).toContain('Key removed.');
  });
});
