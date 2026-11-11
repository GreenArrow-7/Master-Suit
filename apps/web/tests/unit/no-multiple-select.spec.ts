import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No screen uses `<select multiple>`.
 *
 * iOS renders a multiple select as a single-line control that opens the
 * one-column picker wheel. That wheel cannot express more than one choice, so
 * every tap replaces the last and the field reports "0 items" however many rows
 * the user taps. It is not a styling problem and no amount of CSS reaches it:
 * the control is drawn by the system.
 *
 * Two screens shipped with one — work-location assignment (reported from the
 * field, 9 Nov 2026) and the automatic-assignment rules panel (found while
 * fixing the first). Both are now checkbox groups. The reason this is a test
 * rather than two fixes is that nothing fails on a desktop: the defect is
 * invisible to everyone developing the application, and a third one would ship
 * the same way.
 *
 * `size` without `multiple` is fine — a tall single-choice list is an ordinary
 * select on every platform.
 */

const root = join(__dirname, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * The attribute inside a `<select …>` tag, however it is spelled: bare
 * `multiple`, `multiple={true}`, or `multiple={someFlag}`.
 */
const SELECT_TAG = /<select\b[^>]*>/gs;
const MULTIPLE = /\bmultiple\b(?!\s*=\s*\{\s*false\s*\})/;

/**
 * Comments are stripped first: the three checkbox groups that replaced the
 * selects each explain themselves by naming `<select multiple>`, and a guard
 * that its own fix trips is a guard nobody keeps. `(?<!:)` spares `https://`.
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');

describe('no screen uses a multiple select', () => {
  it('finds none in src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      for (const tag of stripComments(readFileSync(file, 'utf8')).match(SELECT_TAG) ?? []) {
        if (MULTIPLE.test(tag)) offenders.push(`${file.slice(root.length + 1)}: ${tag.replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
