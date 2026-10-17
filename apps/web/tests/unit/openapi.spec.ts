import { globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiPath, HTTP_METHODS, jsonSchema, openApiDocument, type RouteEntry } from '@/lib/api/openapi';
import { GET as serveDoc } from '@/app/api/v1/openapi.json/route';
import { z } from 'zod';

/**
 * The OpenAPI document (M19-01) is read off every route's `route()` spec, and
 * `public/openapi.json` — what GET /api/v1/openapi.json serves — must equal it.
 * After changing a route's schemas: run this file with OPENAPI_WRITE=1.
 */
const web = path.resolve(__dirname, '../..');
const app = path.join(web, 'src', 'app');
const FILE = path.join(web, 'public', 'openapi.json');

async function entries(): Promise<RouteEntry[]> {
  const files = globSync('api/v1/**/route.ts', { cwd: app }).sort();
  const out: RouteEntry[] = [];
  for (const file of files) {
    const mod = (await import(/* @vite-ignore */ path.join(app, file))) as Record<string, unknown>;
    for (const method of HTTP_METHODS) {
      const handler = mod[method] as { spec?: RouteEntry['spec'] } | undefined;
      if (handler) out.push({ path: apiPath(file), method, spec: handler.spec });
    }
  }
  return out;
}

describe('the OpenAPI document', () => {
  it('maps a route file to its path', () => {
    expect(apiPath('api/v1/leads/[id]/route.ts')).toBe('/api/v1/leads/{id}');
    expect(apiPath('api\\v1\\exports\\[resource]\\route.ts')).toBe('/api/v1/exports/{resource}');
    expect(apiPath('api/v1/files/[...key]/route.ts')).toBe('/api/v1/files/{key}');
  });

  it('turns zod schemas into JSON Schema', () => {
    const schema = z
      .object({
        name: z.string().min(2).max(10),
        email: z.string().email().optional(),
        n: z.coerce.number().int().min(1).max(5).default(3),
        kind: z.enum(['A', 'B']),
        at: z.coerce.date().nullable(),
        tags: z.array(z.string()).max(3),
      })
      .strict()
      .refine(() => true);
    expect(jsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 10 },
        email: { type: 'string', format: 'email' },
        n: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
        kind: { type: 'string', enum: ['A', 'B'] },
        at: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      },
      required: ['name', 'kind', 'at', 'tags'],
      additionalProperties: false,
    });
  });

  it('documents a pattern only when JSON Schema reads it the way the API does', () => {
    expect(jsonSchema(z.string().regex(/^[a-z]+$/))).toEqual({ type: 'string', pattern: '^[a-z]+$' });
    // JSON Schema patterns carry no flags: /i as a pattern would refuse what the API takes.
    expect(jsonSchema(z.string().regex(/^[A-Z]+$/i))).toEqual({ type: 'string' });
  });

  it('is built from every route, lints clean, and public/openapi.json is that document', async () => {
    const doc = openApiDocument(await entries());
    const json = JSON.parse(JSON.stringify(doc));

    // The acceptance: the lead list with its query schema.
    const leads = json.paths['/api/v1/leads'];
    expect(leads.get['x-permission']).toBe('leads:VIEW');
    expect(leads.get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['limit', 'cursor', 'q', 'filter', 'includeUnassigned', 'includeClosedOut']),
    );
    expect(leads.post.requestBody.content['application/json'].schema.required).toContain('fullName');

    // A lint of what OpenAPI 3.1 requires and a generator trips on.
    expect(json.openapi).toBe('3.1.0');
    const ids = new Set<string>();
    const problems: string[] = [];
    for (const [route, item] of Object.entries<Record<string, any>>(json.paths)) {
      const inPath = [...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const [method, op] of Object.entries<any>(item)) {
        if (ids.has(op.operationId)) problems.push(`${method} ${route}: duplicate operationId ${op.operationId}`);
        ids.add(op.operationId);
        if (!op.responses?.['200']) problems.push(`${method} ${route}: no success response`);
        const declared = (op.parameters ?? []).filter((p: any) => p.in === 'path');
        for (const name of inPath) {
          if (!declared.some((p: any) => p.name === name && p.required === true)) {
            problems.push(`${method} ${route}: path parameter ${name} not declared`);
          }
        }
        for (const p of declared) if (!inPath.includes(p.name)) problems.push(`${method} ${route}: stray ${p.name}`);
        const seen = new Set<string>();
        for (const p of op.parameters ?? []) {
          if (seen.has(`${p.in}:${p.name}`)) problems.push(`${method} ${route}: parameter ${p.name} twice`);
          seen.add(`${p.in}:${p.name}`);
        }
      }
    }
    for (const ref of JSON.stringify(json).matchAll(/"\$ref":"#\/([^"]+)"/g)) {
      const target = ref[1]!.split('/').reduce<any>((node, key) => node?.[key], json);
      if (!target) problems.push(`unresolved $ref ${ref[1]}`);
    }
    expect(problems).toEqual([]);

    if (process.env.OPENAPI_WRITE === '1') writeFileSync(FILE, JSON.stringify(json, null, 2) + '\n');
    // Parsed, not compared as text: the layout of the file is no drift.
    expect(
      JSON.parse(readFileSync(FILE, 'utf8')),
      'public/openapi.json is stale: run tests/unit/openapi.spec.ts with OPENAPI_WRITE=1',
    ).toEqual(json);
  }, 120_000);

  it('is served at /api/v1/openapi.json without a session', async () => {
    const res = await serveDoc(new Request('http://localhost/api/v1/openapi.json'), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/api/v1/leads'].get).toBeTruthy();
  });
});
