import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { deleteObject } from '@/lib/storage';

const params = z.object({ id: z.string().cuid() });

/**
 * Removes a lead document.
 *
 * Gated on `documents:DELETE`, which the seeded roles grant to the organisation
 * administrator alone — every other role, including the representatives who
 * upload, holds `documents:VIEW` and nothing more. That split is the point:
 * the people doing the work put files in, and only an administrator takes one
 * out. It is expressed through the existing RBAC rather than a bespoke check,
 * so a workspace that builds a custom role gets the same rule for free.
 *
 * Uploading is deliberately NOT gated on this module: it hangs off
 * `leads:EDIT`, so anyone who may work a lead may attach a file to it.
 *
 * The row is soft-deleted and the object is removed from the bucket. Those are
 * not the same decision:
 *
 *   - The row carries who uploaded what and when, and the audit trail refers to
 *     it. Hard-deleting it would erase the record that the file ever existed,
 *     which is the opposite of what an administrator deleting a wrong or
 *     sensitive upload usually wants to prove later.
 *   - The bytes are the thing being deleted. Leaving them in the bucket while
 *     the row says "deleted" is how a file someone asked to have removed stays
 *     downloadable to anyone who kept the storage key.
 *
 * Storage removal is attempted first but does not fail the request: if the
 * object is already gone the delete should still succeed, and a bucket outage
 * must not block an administrator from removing a file they have been asked to
 * remove. An orphaned object is recoverable — the row still names its key — and
 * a half-delete that threw would leave them unable to try again.
 */
export const DELETE = route(
  { module: 'documents', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    const document = await prisma.document.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
      select: { id: true, name: true, storageKey: true, leadId: true },
    });
    if (!document) throw NotFound('Document');

    if (document.storageKey) {
      await deleteObject(document.storageKey).catch(() => {});
    }

    // `deletedAt` alone: DocumentStatus has no DELETED member, and the soft-delete
    // guard in lib/db.ts already excludes the row from every read. `storageKey` is
    // deliberately kept — the bytes are gone, but the row should still say which
    // object it referred to, which is what makes the audit entry answerable.
    await prisma.document.update({
      where: { tenantId: ctx.tenantId, id: document.id },
      data: { deletedAt: new Date() },
    });

    return { id: document.id, name: document.name, deleted: true };
  },
);
