'use client';

import { useSyncExternalStore } from 'react';

/**
 * False while the markup is still the server's, true once React has attached to it.
 *
 * A client component renders its buttons on the server too, and until hydration
 * finishes those buttons are painted, enabled, and completely inert: the click
 * handler does not exist yet, so a tap in that window is swallowed with no error
 * and no request. It is not a theoretical race. On a phone — slower CPU, slower
 * script parse — the window is long enough that a person who reaches for the
 * control the moment the row appears hits it, presses again, and reports that the
 * button "sometimes does nothing".
 *
 * Gating `disabled` on this makes the control honest: it says it cannot act while
 * it genuinely cannot, instead of accepting an action it will drop. The cost is
 * that the button is briefly disabled after a load, which is the truth.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because it gives the
 * server and the hydrating client the same answer (false) without a second render
 * pass, so there is no hydration mismatch to warn about.
 */
const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // client, after hydration
    () => false, // server render, and the hydrating pass
  );
}
