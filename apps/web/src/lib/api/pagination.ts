import { z } from 'zod';

/**
 * Keyset (cursor) pagination only. OFFSET is not offered: page 40 000 of an offset
 * query over a million leads costs the same as a table scan.
 */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export interface Cursor {
  updatedAt: string;
  id: string;
}

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString());
    return typeof parsed?.id === 'string' && typeof parsed?.updatedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Keyset predicate for a stable (updatedAt DESC, id DESC) ordering, from the query's cursor. */
export function cursorWhere(raw?: string) {
  const cursor = decodeCursor(raw);
  if (!cursor) return {};
  const at = new Date(cursor.updatedAt);
  return { OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: cursor.id } }] };
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export function toPage<T extends { id: string; updatedAt: Date }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    nextCursor: hasMore && last ? encodeCursor({ id: last.id, updatedAt: last.updatedAt.toISOString() }) : null,
  };
}
