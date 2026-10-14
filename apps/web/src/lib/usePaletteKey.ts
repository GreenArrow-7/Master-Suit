'use client';

import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * The palette's shortcut as this keyboard writes it: ⌘K on a Mac, iPhone or
 * iPad, Ctrl K anywhere else. The server cannot know which, so it renders
 * Ctrl K, the hydration pass keeps it, and a Mac corrects it right after: no
 * mismatch.
 */
export function usePaletteKey(): string {
  return useSyncExternalStore(
    never,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'),
    () => 'Ctrl K',
  );
}
