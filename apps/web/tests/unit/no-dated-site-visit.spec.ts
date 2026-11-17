import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No test books a site visit on a hard-coded date.
 *
 * `POST /api/v1/site-visits` refuses a visit more than a day in the past — "Log
 * a past visit as an activity; the register is forward." A literal date passed
 * to it is therefore a fuse: it passes until the day it names goes by, then
 * fails `verify` on every branch at once, with a message pointing at the
 * calendar integration rather than at the clock.
 *
 * It has burned twice. `google-calendar-sync.spec.ts` lit on 8 November 2026
 * and `microsoft-calendar-sync.spec.ts` on 11 November — three days after the
 * first was fixed and the audit of its siblings was written down as not done.
 * This is that audit, enforced.
 */

const root = join(__dirname, '..');

/**
 * Matched on the field, not on a window around the route call. `scheduledAt`
 * belongs to the site-visit route alone, so this never trips on the `dueAt`
 * literals of the follow-ups and tasks a few lines away: those routes take a
 * past date happily, and their fixed dates keep each event distinct on purpose.
 */
const DATED_SCHEDULED_AT = /scheduledAt\s*:\s*['"`]\d{4}-\d{2}-\d{2}T/;

function specFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...specFiles(path));
    else if (entry.name.endsWith('.spec.ts')) found.push(path);
  }
  return found;
}

describe('no test books a site visit on a hard-coded date', () => {
  it('finds none', () => {
    const offenders: string[] = [];
    for (const file of specFiles(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (DATED_SCHEDULED_AT.test(line)) offenders.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
