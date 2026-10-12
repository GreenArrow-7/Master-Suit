/** "vip, investor, vip" typed into a tags field → ['vip', 'investor']: trimmed, deduplicated, at most the API's 20. */
export const parseTags = (typed: string): string[] =>
  [
    ...new Set(
      typed
        .split(',')
        .map((tag) => tag.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 20);
