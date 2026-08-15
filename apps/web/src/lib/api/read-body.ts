import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Invalid } from '@/lib/errors';

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
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw Invalid(err.issues.map((i) => ({ field: i.path.join('.'), code: i.code, message: i.message })));
    }
    throw err;
  }
}
