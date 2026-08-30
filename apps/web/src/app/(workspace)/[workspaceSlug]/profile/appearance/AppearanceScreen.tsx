'use client';

import { applyTheme, THEMES, THEME_LABELS, type Theme } from '@/lib/theme';
import { useTheme } from '@/lib/useTheme';

/**
 * Settings → Appearance.
 *
 * A radio group, not a select or a row of swatches: three mutually exclusive
 * options is exactly what radios are for, they arrive keyboard-navigable and
 * screen-reader-labelled without any work, and the description for each choice
 * has somewhere to live.
 *
 * The change applies on selection rather than behind a Save button. There is
 * nothing to validate, nothing to fail, and the result is visible in the same
 * instant — a confirmation step would only add a way to pick a theme and not get
 * it.
 */
export default function AppearanceScreen() {
  /**
   * Subscribed to the same source as the top bar's quick toggle, so changing the
   * theme there while this screen is open moves the radio with it — and so does
   * changing it in another tab.
   */
  const theme = useTheme();

  const choose = (next: Theme) => applyTheme(next);

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="lf-eyebrow" style={{ padding: 0, marginBottom: 10 }}>
        Theme
      </legend>

      <div style={{ display: 'grid', gap: 10 }}>
        {THEMES.map((option) => {
          const { name, description } = THEME_LABELS[option];
          const selected = theme === option;
          return (
            <label
              key={option}
              className="lf-card"
              data-selected={selected ? '' : undefined}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: 'var(--lf-space-4)',
                cursor: 'pointer',
                // The selected card is outlined rather than filled: a filled
                // card would restyle itself under each theme it is describing.
                outline: selected ? '2px solid var(--lf-wine-600)' : 'none',
                outlineOffset: -1,
              }}
            >
              <input
                type="radio"
                name="lf-theme"
                value={option}
                checked={selected}
                onChange={() => choose(option)}
                style={{ marginTop: 3, accentColor: 'var(--lf-wine-600)' }}
              />
              <span style={{ display: 'grid', gap: 2 }}>
                <strong style={{ fontSize: 'var(--lf-text-sm)' }}>{name}</strong>
                <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-2)' }}>{description}</span>
              </span>
            </label>
          );
        })}
      </div>

      <p style={{ margin: '14px 0 0', fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
        Saved in this browser, so it survives a refresh and your next sign-in here. Signing in on a different device
        starts from the default.
      </p>
    </fieldset>
  );
}
