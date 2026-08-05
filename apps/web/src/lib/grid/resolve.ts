import { prisma } from '@/lib/db';
import { resolveColumns, storedColumnsFor, type ColumnDef, type GridObject } from './columns';

/**
 * The workspace's configured columns for one object. Every list page calls this
 * rather than reading `OrganizationSetting` itself, so the fallback behaviour when
 * a workspace has no preference is decided in exactly one place.
 */
export async function columnsFor(tenantId: string, object: GridObject): Promise<ColumnDef[]> {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: { gridColumns: true },
  });
  return resolveColumns(object, storedColumnsFor(setting?.gridColumns, object));
}
