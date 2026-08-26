/**
 * The navigation resolver, checked against the routes it resolves to.
 *
 * `entityRoute` is a hand-written table, and a hand-written table of paths goes
 * wrong in exactly the way the bug it replaced went wrong: silently. Nothing
 * throws when a path is a segment short — the person clicking gets a 404, and
 * only they find out.
 *
 * Three of these ran red before the fix and are kept as regressions:
 *
 *   1. every path in the table resolves to a route that exists on disk;
 *   2. every `objectType` any service writes onto a Notification is routable —
 *      the HR services wrote eleven of them and nothing had ever read one;
 *   3. the result depends on the slug it is given and on nothing ambient, which
 *      is the property that stops the current URL deciding the destination.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { entityRoute, isRoutableType, ROUTABLE_TYPES } from '@/lib/nav/entityRoute';

const root = path.resolve(__dirname, '../..');
const appDir = path.join(root, 'src/app');

/**
 * Every page route, as a list of segments with `[param]` left in place.
 * Route-group folders — `(workspace)`, `(auth)` — are not path segments.
 */
function routePatterns(dir: string, prefix: string[] = []): string[][] {
  const found: string[][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') found.push(prefix);
    if (!entry.isDirectory()) continue;
    const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
    found.push(...routePatterns(path.join(dir, entry.name), isGroup ? prefix : [...prefix, entry.name]));
  }
  return found;
}

const ROUTES = routePatterns(appDir);

function routeExists(pathname: string): boolean {
  const segments = pathname.split('?')[0]!.split('/').filter(Boolean);
  return ROUTES.some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every((part, i) => (part.startsWith('[') && part.endsWith(']') ? true : part === segments[i])),
  );
}

const SLUG = 'acme';
const ID = 'ckz0000000000000000000000';

describe('the route table points at routes that exist', () => {
  it('resolves every routable type', () => {
    for (const type of ROUTABLE_TYPES) {
      expect(entityRoute(type, ID, SLUG), `${type} resolved to null`).not.toBeNull();
    }
  });

  it('lands every type on a real page route', () => {
    const missing = ROUTABLE_TYPES.map((type) => [type, entityRoute(type, ID, SLUG)!] as const).filter(
      ([, target]) => !routeExists(target),
    );
    expect(missing, `no page.tsx serves: ${missing.map(([t, p]) => `${t} -> ${p}`).join(', ')}`).toEqual([]);
  });

  it('proves the check can fail', () => {
    // `/social-leads/{id}` is what three services stored in `actionUrl`. It has
    // never existed — under any prefix — and this is the assertion that says so.
    expect(routeExists(`/${SLUG}/sales/social-leads/${ID}`)).toBe(false);
    expect(routeExists(`/${SLUG}/notifications/leads/${ID}`)).toBe(false);
    expect(routeExists('/people/overtime')).toBe(false);
    expect(routeExists(`/${SLUG}/sales/leads/${ID}`)).toBe(true);
  });
});

describe('every notification a service writes can be opened', () => {
  /**
   * Literal `objectType: '…'` values that end up on a Notification row.
   *
   * `objectType` is not a notification-only field name — the audit log uses it
   * too, for a much wider vocabulary — so this cannot simply scan src/services.
   * Two narrower passes instead: the HR notification registry, which is nothing
   * but notifications, and the text immediately around every direct
   * `prisma.notification` write elsewhere.
   */
  function writtenObjectTypes(): string[] {
    const found = new Set<string>();
    const collect = (source: string) => {
      for (const match of source.matchAll(/objectType: '([^']+)'/g)) found.add(match[1]!);
    };

    collect(readFileSync(path.join(root, 'src/services/hr/notify.ts'), 'utf8'));

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const source = readFileSync(full, 'utf8');
        for (const write of source.matchAll(/prisma\s*\.\s*notification\s*\n?\s*\.\s*create(?:Many)?\(/g)) {
          collect(source.slice(write.index!, write.index! + 800));
        }
      }
    };
    walk(path.join(root, 'src/services'));
    return [...found];
  }

  it('routes every literal objectType the services store', () => {
    const written = writtenObjectTypes();
    expect(written.length).toBeGreaterThan(5);
    const unroutable = written.filter((type) => !isRoutableType(type));
    expect(unroutable, `written but unroutable: ${unroutable.join(', ')}`).toEqual([]);
  });

  it('routes the four objectTypes the automation engine writes', () => {
    // Written as a variable rather than a literal, from records.ts, and in upper
    // case — which is why the resolver normalises rather than matching exactly.
    for (const type of ['LEAD', 'OPPORTUNITY', 'ACCOUNT', 'CONTACT']) {
      expect(entityRoute(type, ID, SLUG)).toBe(
        `/${SLUG}/sales/${{ LEAD: 'leads', OPPORTUNITY: 'opportunities', ACCOUNT: 'accounts', CONTACT: 'contacts' }[type]}/${ID}`,
      );
    }
    expect(entityRoute('SOCIAL_COMMENT', ID, SLUG)).toBe(`/${SLUG}/sales/social-leads`);
  });
});

describe('the destination depends on the record, never on where you clicked from', () => {
  it('interpolates the slug it is given', () => {
    expect(entityRoute('lead', ID, 'alpha')).toBe(`/alpha/sales/leads/${ID}`);
    expect(entityRoute('lead', ID, 'beta')).toBe(`/beta/sales/leads/${ID}`);
  });

  it('is the same string however many times it is called', () => {
    const once = entityRoute('opportunity', ID, SLUG);
    expect(entityRoute('opportunity', ID, SLUG)).toBe(once);
    expect(once).toBe(`/${SLUG}/sales/opportunities/${ID}`);
  });

  it('deep-links only where the destination screen reads the parameter', () => {
    // Both of these are real: /people/payroll reads ?run=, /people/performance
    // reads ?cycle=. A parameter the screen ignores would look like deep linking
    // and do nothing.
    expect(entityRoute('hr_payroll_run', ID, SLUG)).toBe(`/${SLUG}/people/payroll?run=${ID}`);
    expect(entityRoute('hr_review_cycle', ID, SLUG)).toBe(`/${SLUG}/people/performance?cycle=${ID}`);
    expect(entityRoute('hr_leave_request', ID, SLUG)).toBe(`/${SLUG}/people/leave`);
  });

  it('sends a payslip to payslips and a payroll run to payroll', () => {
    // These shared one objectType, and one type cannot name two screens.
    expect(entityRoute('hr_payslip', ID, SLUG)).toBe(`/${SLUG}/people/payslips`);
    expect(entityRoute('hr_payroll_run', ID, SLUG)).not.toBe(entityRoute('hr_payslip', ID, SLUG));
  });
});

describe('it refuses rather than guesses', () => {
  it('returns null for a type it does not know', () => {
    expect(entityRoute('hr_offer', ID, SLUG)).toBeNull();
    expect(entityRoute('wardrobe', ID, SLUG)).toBeNull();
    expect(entityRoute('', ID, SLUG)).toBeNull();
    expect(entityRoute(null, ID, SLUG)).toBeNull();
  });

  it('returns null for a detail route with no id, rather than the bare collection', () => {
    expect(entityRoute('lead', null, SLUG)).toBeNull();
    expect(entityRoute('candidate', undefined, SLUG)).toBeNull();
    // A screen does not need one.
    expect(entityRoute('hr_overtime_request', null, SLUG)).toBe(`/${SLUG}/people/overtime`);
  });

  it('returns null without a workspace slug, rather than an unprefixed path', () => {
    // The whole defect in one assertion: a path with no slug is not a
    // destination, it is a 404 waiting to happen.
    expect(entityRoute('lead', ID, '')).toBeNull();
  });

  it('escapes an id rather than letting it change the path', () => {
    expect(entityRoute('lead', 'a/b', SLUG)).toBe(`/${SLUG}/sales/leads/a%2Fb`);
  });
});
