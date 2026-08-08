import type { FilterNode } from '@/lib/api/filterTree';

/**
 * In-memory version of the filter grammar compiled by lib/api/filterTree, for
 * evaluating a condition node against a single already-loaded record. Deliberately
 * not routed through Prisma — the record is already in hand from the previous node.
 */
export function evaluateFilterNode(node: FilterNode, record: Record<string, any>): boolean {
  if ('op' in node) {
    const results = node.children.map((c) => evaluateFilterNode(c, record));
    return node.op === 'AND' ? results.every(Boolean) : results.some(Boolean);
  }

  const actual = node.field.split('.').reduce<any>((v, k) => v?.[k], record);
  const value = node.value;

  switch (node.cmp) {
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'gt':
      return actual > (value as any);
    case 'gte':
      return actual >= (value as any);
    case 'lt':
      return actual < (value as any);
    case 'lte':
      return actual <= (value as any);
    case 'in':
      return Array.isArray(value) && value.includes(actual);
    case 'nin':
      return Array.isArray(value) && !value.includes(actual);
    case 'contains':
      return Array.isArray(actual)
        ? actual.includes(value)
        : String(actual ?? '')
            .toLowerCase()
            .includes(String(value).toLowerCase());
    case 'starts':
      return String(actual ?? '')
        .toLowerCase()
        .startsWith(String(value).toLowerCase());
    case 'ends':
      return String(actual ?? '')
        .toLowerCase()
        .endsWith(String(value).toLowerCase());
    case 'between': {
      const [a, b] = value as [any, any];
      return actual >= a && actual <= b;
    }
    case 'is_null':
      return actual == null;
    case 'is_not_null':
      return actual != null;
    // ponytail: 'relative' date tokens (today/last_7_days/...) aren't evaluated in-memory;
    // treat as non-match rather than mis-firing. Add when a condition node needs them.
    case 'relative':
      return false;
    default:
      return false;
  }
}
