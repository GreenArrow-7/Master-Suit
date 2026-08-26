import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Ten route files could not use the API kernel — `lib/api/handler.ts` always
 * answers JSON, and a payslip PDF, a CSV export and a WPS bank file are streams
 * — so each authenticated, entitled, permitted and rate-limited by hand.
 *
 * The assessment named one consequence: the WPS export, which bulk-exports every
 * employee's IBAN and labour-card number, had no rate limit. Reading all ten
 * showed it was five — every HR bypass. Payslip PDFs, HR document downloads and
 * uploads, HR report exports and the bank file were all unlimited.
 *
 * None of them omitted the limit deliberately. They omitted it because it is the
 * fourth line of a prologue somebody retypes each time, and the fourth line is
 * the one that gets forgotten. So `resolveGuardedCtx` applies it by default and
 * offers no way to say "none" — which is a property worth a test that reads the
 * source, because the next hand-rolled prologue will look reasonable too.
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

const routeFiles = globSync('**/route.ts', { cwd: API });

describe('the security prologue', () => {
  it('is not re-implemented outside the two routes that must', () => {
    const handRolled = routeFiles.filter((file) => {
      if (EXEMPT.has(file)) return false;
      return /\bresolveCtx\s*\(\s*req/.test(readFileSync(join(API, file), 'utf8'));
    });

    // A new one here is not automatically wrong — it is a prompt to ask whether
    // the kernel or resolveGuardedCtx would do, and to add it to EXEMPT with a
    // reason if neither will.
    expect(handRolled).toEqual([]);
  });

  it('offers no way to ask for no rate limit', () => {
    // The guarantee in one assertion. `limit` may be *replaced*; it cannot be
    // switched off, because a route that forgets it is the failure this exists
    // to stop.
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'api', 'guarded.ts'), 'utf8');
    expect(source).toMatch(/spec\.limit \?\? limits\.sessionUser\(ctx\.actor\.id\)/);
    expect(source).not.toMatch(/limit\s*===\s*(null|'none'|false)/);
  });

  it('runs the four steps in the kernel’s order', () => {
    // Identify, entitle, permit, throttle — and each throws before the next
    // runs, so a caller without an entitlement never reaches the permission
    // check and never consumes a token from somebody else's bucket.
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'api', 'guarded.ts'), 'utf8');
    const order = ['resolveCtx(', 'assertModuleEntitlement(', 'assertPermission(', 'consume('].map((needle) =>
      source.indexOf(needle, source.indexOf('export async function resolveGuardedCtx')),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
