import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { GRID_COLUMNS, resolveColumns, storedColumnsFor, type GridObject } from '@/lib/grid/columns';

const OBJECTS = Object.keys(GRID_COLUMNS) as [GridObject, ...GridObject[]];

const query = z.object({ object: z.enum(OBJECTS) }).strict();

export const GET = route({ module: 'settings', action: 'VIEW', query }, async ({ ctx, query }) => {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId: ctx.tenantId },
    select: { gridColumns: true },
  });
  return {
    object: query.object,
    catalogue: GRID_COLUMNS[query.object],
    columns: resolveColumns(query.object, storedColumnsFor(setting?.gridColumns, query.object)).map((c) => c.key),
  };
});

const body = z
  .object({
    object: z.enum(OBJECTS),
    /** Ordered keys of the optional columns to show. Fixed columns are implicit. */
    columns: z.array(z.string().max(60)).max(50),
  })
  .strict();

export const PUT = route(
  { module: 'settings', action: 'MANAGE_CONFIGURATION', body, auditEvent: 'PERMISSION_CHANGED' },
  async ({ ctx, body }) => {
    const catalogue = GRID_COLUMNS[body.object];
    const known = new Set(catalogue.map((column) => column.key));
    const unknown = body.columns.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw Invalid(
        unknown.map((key) => ({ field: 'columns', code: 'unknown_column', message: `No such column: ${key}` })),
      );
    }

    // Fixed columns are always rendered; storing them would let a later edit drop
    // them and leave rows with no link to their record.
    const optional = body.columns.filter((key) => !catalogue.find((c) => c.key === key)?.fixed);
    const deduped = [...new Set(optional)];

    const existing = await prisma.organizationSetting.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { gridColumns: true },
    });
    const merged = {
      ...(existing?.gridColumns && typeof existing.gridColumns === 'object'
        ? (existing.gridColumns as Record<string, unknown>)
        : {}),
      [body.object]: deduped,
    };

    await prisma.organizationSetting.update({
      where: { tenantId: ctx.tenantId },
      data: { gridColumns: merged },
    });

    return { object: body.object, columns: resolveColumns(body.object, deduped).map((c) => c.key) };
  },
);
