/**
 * Each person's saved views of the project catalogue and the listing book
 * (Lead Eagle audit rows M11-08, M12-05), as the lead grid has (M4-19): a name
 * and the list's filters as they stood. A view is personal — only its owner
 * lists, opens or deletes it — and changes nothing, so reading the list is
 * enough to keep one. Opening it is a link: the filters are the URL.
 */
import { prisma, withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { catalogueFilters } from '@/lib/inventory/catalogue';
import { listingFilters } from '@/lib/inventory/listings';

export const INVENTORY_VIEWS = {
  PROJECT: { objectType: 'PROJECT_LIST', path: '/projects', keys: Object.keys(catalogueFilters.shape) },
  LISTING: { objectType: 'LISTING_LIST', path: '/listings', keys: Object.keys(listingFilters.shape) },
} as const;
export type InventoryList = keyof typeof INVENTORY_VIEWS;

/** The list's own filters and nothing else, as strings, in the filter's own order (stable links). */
function cleanParams(list: InventoryList, params: Record<string, unknown>) {
  return Object.fromEntries(
    INVENTORY_VIEWS[list].keys.flatMap((key) => {
      const value = params[key];
      return typeof value === 'string' && value && value.length <= 500 ? [[key, value]] : [];
    }),
  );
}

/** A view's link, module-relative (SalesLink): its filters, then its id. */
export function viewHref(list: InventoryList, view: { id: string; filterTree: unknown }) {
  const tree = view.filterTree && typeof view.filterTree === 'object' ? view.filterTree : {};
  const query = new URLSearchParams({ ...cleanParams(list, tree as Record<string, unknown>), saved: view.id });
  return `${INVENTORY_VIEWS[list].path}?${query}`;
}

export async function listViews(ctx: Ctx, list: InventoryList) {
  const views = await prisma.smartView.findMany({
    where: { tenantId: ctx.tenantId, objectType: INVENTORY_VIEWS[list].objectType, ownerId: ctx.actor.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, filterTree: true },
  });
  return views.map((v) => ({ id: v.id, name: v.name, href: viewHref(list, v) }));
}

export async function saveView(ctx: Ctx, list: InventoryList, name: string, params: Record<string, unknown>) {
  return withTx(ctx.tenantId, async (tx) => {
    const view = await tx.smartView.create({
      data: {
        tenantId: ctx.tenantId,
        objectType: INVENTORY_VIEWS[list].objectType,
        name,
        ownerId: ctx.actor.id,
        visibility: 'PERSONAL',
        filterTree: cleanParams(list, params),
        createdById: ctx.actor.id,
      },
      select: { id: true, name: true, filterTree: true },
    });
    await audit(ctx, { event: 'RECORD_CREATED', objectType: 'smart_views', recordId: view.id }, tx);
    return { id: view.id, name: view.name, href: viewHref(list, view) };
  });
}

/** Deletes one of the caller's own views; anyone else's answers 404, like a missing id. */
export async function deleteView(ctx: Ctx, list: InventoryList, id: string) {
  return withTx(ctx.tenantId, async (tx) => {
    const { count } = await tx.smartView.updateMany({
      where: {
        tenantId: ctx.tenantId,
        id,
        objectType: INVENTORY_VIEWS[list].objectType,
        ownerId: ctx.actor.id,
        deletedAt: null,
      },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    if (count === 0) throw NotFound('View');
    await audit(ctx, { event: 'RECORD_DELETED', objectType: 'smart_views', recordId: id }, tx);
    return { id };
  });
}
