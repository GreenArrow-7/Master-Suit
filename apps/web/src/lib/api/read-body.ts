import type { ZodTypeAny, z } from 'zod';
import { AppError, Invalid } from '@/lib/errors';
import { getNumericSetting } from '@/lib/platform-settings';

/**
 * Parse a JSON request body for the hand-rolled auth routes, which do not run
 * through the kernel in lib/api/handler.ts.
 *
 * Both a malformed/absent body and a schema violation are client errors: they
 * surface as a 422 validation problem (an AppError the routes' existing catch
 * already handles), never as a 500. Before this, `schema.parse(await req.json())`
 * let a SyntaxError or ZodError fall through to the generic Internal-error branch,
 * so an empty email or empty body answered 500.
 */
export async function readJsonBody<T extends ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw Invalid([{ field: 'body', code: 'invalid_json', message: 'Request body must be valid JSON.' }]);
  }
  // A schema violation throws a ZodError, which toResponse answers as the same 422.
  return schema.parse(raw);
}

/**
 * A multipart upload's form and its `file` part, refused on size before a byte
 * of the file is read.
 *
 * The size check once lived after `req.formData()` and `file.arrayBuffer()`, so a
 * 2 GB POST was read into memory in full and *then* rejected. Cheapest first:
 * the declared length, then the part's own size; a service that stores the
 * bytes still counts the real ones, because a Content-Length can lie.
 */
export async function readUpload(req: Request, noun = 'file') {
  const uploadMaxMb = await getNumericSetting('uploadMaxMb');
  const maxBytes = uploadMaxMb * 1024 * 1024;
  const tooLarge = () => new AppError(413, 'file-too-large', `The ${noun} must be under ${uploadMaxMb} MB.`);
  // Multipart framing adds headers and boundaries around the file itself, so
  // the envelope is allowed a little more than the file limit.
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes + 64 * 1024) throw tooLarge();

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError(422, 'validation-failed', `Attach a ${noun} to upload.`);
  }
  if (file.size > maxBytes) throw tooLarge();
  return { form, file };
}
