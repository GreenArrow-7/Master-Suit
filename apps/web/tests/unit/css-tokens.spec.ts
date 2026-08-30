import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `var(--lf-…)` resolves to a token that exists.
 *
 * The notification panel and the Create menu both asked for `--lf-radius-md` and
 * `--lf-shadow-lg`. Neither is defined anywhere, so both dropdowns rendered with
 * square corners and no shadow — in every theme, since the day they were
 * written. Nothing failed: an undefined custom property is not an error, the
 * declaration is simply dropped, so the only way to notice is to look at it and
 * know what it was supposed to look like.
 *
 * That is what makes this worth a test rather than a fix. A typo'd token is
 * silent by design, and a second theme multiplies the surfaces where nobody is
 * looking closely.
 */

const root = join(__dirname, '..', '..', 'src');
const sources = [join(root, 'styles', 'tokens.css'), join(root, 'app', 'globals.css')];

/**
 * Declared elsewhere, on purpose.
 *
 * next/font mints these three in `app/layout.tsx` and puts them on <html> via a
 * className, so they are real at runtime and simply not greppable in CSS.
 */
const DECLARED_IN_JS = ['--lf-font-fraunces', '--lf-font-inter-tight', '--lf-font-jetbrains'];

/** Tokens are declared as `--lf-name:` anywhere in the two stylesheets. */
function declaredTokens(): Set<string> {
  const declared = new Set<string>(DECLARED_IN_JS);
  for (const file of sources) {
    const css = readFileSync(file, 'utf8');
    for (const match of css.matchAll(/(--lf-[a-z0-9-]+)\s*:/gi)) declared.add(match[1]!.toLowerCase());
  }
  return declared;
}

/**
 * Uses are `var(--lf-name)` in the stylesheets and in the inline styles that
 * components still carry — the bug was in a component, so a stylesheet-only
 * scan would have missed it entirely.
 */
function usedTokens(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const files = [...sources, join(root, 'components', 'nav', 'TopBar.tsx')];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    /**
     * The trailing group says whether a fallback follows. `var(--x, 1rem)` is a
     * deliberate optional read — `--lf-stack-gap` is set per-component and read
     * with a default — and it cannot silently drop the declaration, so it is not
     * what this test looks for. A bare `var(--x)` can, and is.
     */
    for (const match of text.matchAll(/var\(\s*(--lf-[a-z0-9-]+)\s*([,)])/gi)) {
      if (match[2] === ',') continue;
      const token = match[1]!.toLowerCase();
      if (!used.has(token)) used.set(token, new Set());
      used.get(token)!.add(file.split(/[\\/]/).pop()!);
    }
  }
  return used;
}

describe('CSS custom properties', () => {
  it('are declared before they are used', () => {
    const declared = declaredTokens();
    const undeclared = [...usedTokens()]
      .filter(([token]) => !declared.has(token))
      .map(([token, files]) => `${token} (used in ${[...files].join(', ')})`);

    expect(undeclared).toEqual([]);
  });

  it('finds the tokens it is meant to be checking', () => {
    // Guards the regexes: a scan that matches nothing would pass the case above
    // by accident and go on passing after somebody renames the token syntax.
    const declared = declaredTokens();
    expect(declared.size).toBeGreaterThan(50);
    expect(declared.has('--lf-surface')).toBe(true);
    expect(usedTokens().size).toBeGreaterThan(30);
  });
});
