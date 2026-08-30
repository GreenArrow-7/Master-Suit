/**
 * The appearance preference, and the one place that knows how it is stored.
 *
 * The theme used to live in `useState` inside TopBar, which meant it was lost on
 * every refresh — you could pick dark, reload, and be back in light. That is the
 * bug this module exists to fix; the second theme is what made it worth fixing
 * properly rather than adding one more piece of component state.
 *
 * ── Why localStorage and not a column on User ─────────────────────────────
 *
 * A `User.theme` column survives a login on a *different* device, which
 * localStorage does not. It also costs a migration, an endpoint, a write on
 * every toggle, and a round trip before the first paint — and until that round
 * trip returns the page must render *something*, so it would still need a local
 * copy to avoid a flash. The local copy is therefore not the shortcut; it is the
 * part that cannot be removed.
 *
 * ponytail: per-browser preference. If "my theme follows me between my laptop
 * and the office machine" is ever asked for, add the column and keep this as the
 * pre-paint cache, rather than replacing it.
 */

export const THEMES = ['light', 'dark', 'glass'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  light: {
    name: 'Light',
    description: 'The default. Highest contrast for long spells in dense tables.',
  },
  dark: {
    name: 'Dark Classic',
    description: 'A clean, flat dark interface. Familiar business styling, strong readability.',
  },
  glass: {
    name: 'Glassy',
    description: 'Dark Classic with translucent panels and a soft blur. Tables and inputs stay solid.',
  },
};

export const STORAGE_KEY = 'lf-theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/**
 * Reads the stored preference. Returns null rather than a default so callers can
 * tell "no choice made" from "chose light".
 *
 * Every access is guarded: a private window, cleared site data, or a browser set
 * to block storage makes the accessor itself throw, and a theme preference is
 * not worth a blank page.
 */
export function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Applies a theme to the document and remembers it.
 *
 * `light` clears the attribute rather than setting `data-theme="light"`, because
 * the light palette is defined on bare `:root` — setting it would be harmless
 * but implies a `[data-theme='light']` block exists to match.
 */
export function applyTheme(theme: Theme): void {
  if (theme === 'light') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignored on purpose: the theme still applies for this session.
  }

  // Lets any other mounted component follow the change without prop-drilling a
  // context through the whole shell for one string.
  window.dispatchEvent(new CustomEvent('lf:theme', { detail: theme }));
}

/**
 * The script that runs before first paint, as a string for `dangerouslySetInnerHTML`.
 *
 * This has to be inline and synchronous in <head>. Anything deferred — a module,
 * an effect, a hydration pass — paints the light theme first and then swaps,
 * which is a white flash on every navigation for anyone using a dark theme.
 *
 * Kept deliberately tiny and dependency-free: it is parsed and executed on every
 * page load before anything else, and it must not be able to throw.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='glass')document.documentElement.dataset.theme=t;}catch(e){}})();`;
