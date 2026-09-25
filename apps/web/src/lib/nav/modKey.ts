import { useSyncExternalStore } from 'react';

/**
 * The shortcut modifier as the viewer's keyboard names it.
 *
 * Windows is this product's stated environment, so the server and the first
 * paint say Ctrl and only a Mac corrects it after hydration — the other way
 * round flashed ⌘ at every Windows user. `useSyncExternalStore` rather than a
 * set-state-in-effect: the value never changes once known, so there is nothing
 * to subscribe to.
 */
const subscribe = () => () => {};
const onClient = (): 'Ctrl' | '⌘' => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl');
const onServer = (): 'Ctrl' | '⌘' => 'Ctrl';

export function useModKey(): 'Ctrl' | '⌘' {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
