'use client';

import { useSyncExternalStore } from 'react';
import { readStoredTheme, type Theme } from './theme';

/**
 * The current theme, as a subscription rather than component state.
 *
 * The theme lives outside React — in localStorage and on a DOM attribute set
 * before the app boots — which is exactly what `useSyncExternalStore` is for.
 * Reading it with `useState` + `useEffect` means rendering a guess ('light')
 * and correcting it after mount, which is both a flash and the pattern
 * `react-hooks/set-state-in-effect` exists to catch.
 *
 * `storage` is subscribed alongside the app's own event so two tabs of the same
 * workspace agree: that event fires only in *other* tabs, so switching to Glassy
 * in one updates the switch in the rest without a refresh.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('lf:theme', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('lf:theme', onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** A string, so React's identity check compares by value and cannot loop. */
function getSnapshot(): Theme {
  return readStoredTheme() ?? 'light';
}

/**
 * The server has no access to the preference, so it renders the default and the
 * pre-paint script has already corrected the document by the time this hydrates.
 */
function getServerSnapshot(): Theme {
  return 'light';
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
