/**
 * What a page server component would put on screen, without a browser: its
 * rendered element tree is walked for every string and number in children and
 * props. Client components in the tree are not executed, so their props count
 * as shown.
 */

/** Every string a rendered element tree would put on screen or in props. */
export function strings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) strings(item, out, seen);
    return out;
  }
  const element = node as { props?: unknown };
  if ('props' in element) return strings(element.props, out, seen);
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_') || typeof value === 'function') continue;
    strings(value, out, seen);
  }
  return out;
}

export const pageText = async (tree: unknown) => strings(await tree).join('\n');
