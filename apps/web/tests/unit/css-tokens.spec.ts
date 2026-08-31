import { readdirSync, readFileSync } from 'node:fs';
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

/** Every .tsx under src — inline styles are where these bugs actually live. */
function allTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTsx(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Uses are `var(--lf-name)` in the stylesheets and in the inline styles that
 * components carry. This scanned ONLY TopBar.tsx at first — the file the
 * original bug was in — and an app-wide audit then found 83 more uses of
 * six tokens that had never existed (--lf-ink-600 alone appeared 65 times).
 * A guard scoped to where the last bug was is not a guard.
 */
function usedTokens(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const files = [...sources, ...allTsx(join(root, 'components')), ...allTsx(join(root, 'app'))];

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

/**
 * Button variants that do not exist.
 *
 * `lf-btn--primary` was on eleven buttons across six screens and was defined
 * nowhere. It happened to be harmless — the base `.lf-btn` already paints the
 * burgundy primary, so those buttons looked right — but that is luck, not
 * design: the same typo on `lf-btn--danger` would have shipped a delete button
 * styled as a normal one, and nothing would have failed.
 *
 * Scoped to `lf-btn--*` rather than every class name. The button variants are a
 * closed set defined in one stylesheet, so the check is exact; a general
 * "every className exists in CSS" sweep would flag every class that comes from
 * a library, a data attribute or a template literal, and get switched off.
 */
describe('button variants', () => {
  const componentDir = join(root, 'app');
  const cssText = sources.map((file) => readFileSync(file, 'utf8')).join('\n');

  function definedVariants(): Set<string> {
    const defined = new Set<string>();
    for (const match of cssText.matchAll(/\.(lf-btn--[a-z0-9-]+)/gi)) defined.add(match[1]!.toLowerCase());
    return defined;
  }

  function usedVariants(): Map<string, Set<string>> {
    const used = new Map<string, Set<string>>();

    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.tsx')) out.push(full);
      }
      return out;
    };

    for (const file of [...walk(componentDir), ...walk(join(root, 'components'))]) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(lf-btn--[a-z0-9-]+)/gi)) {
        const variant = match[1]!.toLowerCase();
        if (!used.has(variant)) used.set(variant, new Set());
        used.get(variant)!.add(file.split(/[\\/]/).pop()!);
      }
    }
    return used;
  }

  it('are defined before they are used', () => {
    const defined = definedVariants();
    const undefinedVariants = [...usedVariants()]
      .filter(([variant]) => !defined.has(variant))
      .map(([variant, files]) => `${variant} (used in ${[...files].sort().join(', ')})`);

    expect(undefinedVariants).toEqual([]);
  });

  it('finds the variants it is meant to be checking', () => {
    expect(definedVariants().has('lf-btn--secondary')).toBe(true);
    expect(usedVariants().size).toBeGreaterThan(2);
  });
});
