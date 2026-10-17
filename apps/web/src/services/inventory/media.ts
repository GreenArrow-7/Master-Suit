/**
 * Receiving a project or listing file from the browser (Lead Eagle audit rows
 * M11-03, M12-02): the same pipeline as every other upload — size refused
 * before the body is read, the type recognised by its bytes, the malware scan,
 * object storage, then the row. A failed row takes the object back out, so
 * nothing is left in the bucket that no row points at.
 */
import { z } from 'zod';
import { assertClean, scanBuffer } from '@/lib/antivirus';
import { readUpload } from '@/lib/api/read-body';
import { prisma } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { HOSTED_KINDS, mediaPrefix, sniffMediaType } from '@/lib/inventory/media';
import { deleteObject, putObject } from '@/lib/storage';
import type { Ctx } from '@/lib/security/rbac';

const fields = z.object({
  kind: z.enum(HOSTED_KINDS).default('IMAGE'),
  title: z.string().trim().max(200).optional(),
});

export async function uploadMedia(ctx: Ctx, req: Request, target: { project: string } | { listing: string }) {
  const { form, file } = await readUpload(req);
  const parsed = fields.safeParse({
    kind: form.get('kind') || undefined,
    title: form.get('title') || undefined,
  });
  if (!parsed.success) {
    throw Invalid([{ field: 'kind', code: 'invalid', message: 'Choose a photo, floor plan, brochure or creative.' }]);
  }
  const { kind } = parsed.data;
  const title = parsed.data.title || file.name.slice(0, 200);

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffMediaType(kind, bytes);
  assertClean(await scanBuffer(bytes));

  const owner = 'project' in target ? `project-${target.project}` : `listing-${target.listing}`;
  const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
  const storageKey = `${mediaPrefix(ctx.tenantId)}${owner}/${crypto.randomUUID()}-${safeName}`;
  await putObject(storageKey, bytes, mimeType);

  const data = {
    tenantId: ctx.tenantId,
    kind,
    title,
    storageKey,
    mimeType,
    sizeBytes: bytes.length,
    createdById: ctx.actor.id,
  };
  const select = { id: true, kind: true, title: true, mimeType: true } as const;
  const row: Promise<{ id: string; kind: string; title: string | null; mimeType: string | null }> =
    'project' in target
      ? prisma.projectMedia.create({ data: { ...data, projectId: target.project }, select })
      : prisma.listingMedia.create({ data: { ...data, listingId: target.listing }, select });
  return row.catch(async (error: unknown) => {
    await deleteObject(storageKey).catch(() => {});
    throw error;
  });
}
