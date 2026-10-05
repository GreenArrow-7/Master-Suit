/** A URL- and code-safe handle from a display name: lower-case words joined by hyphens. */
export const slugify = (name: string, max = 40) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
