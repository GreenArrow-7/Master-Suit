import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { AppError } from '@/lib/errors';
import { readUpload } from '@/lib/api/read-body';
import { requireWorkspace } from '@/lib/workspace';
import { uploadDocument } from '@/services/hr/documents';

/**
 * Multipart upload. The kernel leaves a body that is not JSON unread, so the
 * file reaches readUpload untouched, after authentication, entitlement,
 * permission and the rate limit.
 */
export const POST = route(
  {
    module: 'hr_documents',
    action: 'CREATE',
    productModule: 'HRMS',
    sessionOnly: true,
    params: z.object({ workspaceSlug: z.string() }),
  },
  async ({ ctx, params, req }) => {
    await requireWorkspace(ctx, params.workspaceSlug);

    // Refused on its declared size before anything is read; uploadDocument
    // counts the real bytes too.
    const { form, file } = await readUpload(req);

    const employeeId = String(form.get('employeeId') ?? '');
    const kind = String(form.get('kind') ?? '');
    if (!employeeId || !kind)
      throw new AppError(422, 'validation-failed', 'An employee and a document kind are required.');

    /**
     * Parsed before anything is stored.
     *
     * `new Date('31/12/2026')` is an Invalid Date rather than an error, and it
     * stayed quiet all the way to Prisma, which rejected it with a
     * PrismaClientValidationError — not an AppError, so the caller got a bare
     * 500 with nothing to act on. Worse, `uploadDocument` writes the bytes to
     * object storage before it writes the row, so every such attempt left the
     * file behind with no record pointing at it.
     */
    const optionalDate = (field: string): Date | undefined => {
      const raw = String(form.get(field) ?? '');
      if (!raw) return undefined;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(422, 'validation-failed', `${field} is not a date we can read. Use YYYY-MM-DD.`);
      }
      return parsed;
    };

    const document = await uploadDocument(ctx, {
      employeeId,
      kind,
      number: String(form.get('number') ?? '') || undefined,
      issuedAt: optionalDate('issuedAt'),
      expiresAt: optionalDate('expiresAt'),
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return document;
  },
);
