import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bareRoute } from '@/lib/api/handler';

/**
 * The API's OpenAPI 3.1 document (M19-01), public like any API reference.
 * Generated from the route() specs into `public/openapi.json` and kept equal
 * to them by tests/unit/openapi.spec.ts; read from disk rather than imported,
 * so half a megabyte of JSON is never type-checked or bundled.
 */
export const GET = bareRoute('/api/v1/openapi.json', async () => {
  const doc = await readFile(path.join(process.cwd(), 'public', 'openapi.json'), 'utf8');
  return new Response(doc, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
});
