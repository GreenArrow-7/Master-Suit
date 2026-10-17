import type { ZodTypeAny } from 'zod';
import type { RouteSpec } from './handler';

/**
 * The OpenAPI 3.1 document, read off the routes (audit M19-01).
 *
 * `route()` hangs its spec on the handler it returns, so each exported GET,
 * POST, … names its module, action, product modules and its params, query and
 * body schemas. `tests/unit/openapi.spec.ts` imports every route file, builds
 * the document with `openApiDocument` and keeps `public/openapi.json` equal to
 * it (OPENAPI_WRITE=1 rewrites the file); `GET /api/v1/openapi.json` serves it.
 *
 * ponytail: responses are described as "Success" without a schema — the
 * handlers return untyped objects. Add response schemas to RouteSpec when a
 * client generator needs them.
 */

type Json = Record<string, unknown>;
type AnySpec = RouteSpec<ZodTypeAny, ZodTypeAny, ZodTypeAny>;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** `api/v1/leads/[id]/route.ts` (under src/app) → `/api/v1/leads/{id}`. */
export function apiPath(file: string): string {
  const segments = file
    .split(/[\\/]/)
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => segment.replace(/^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/, '{$1}'));
  return `/${segments.join('/')}`;
}

/** A zod (v3) schema as JSON Schema 2020-12, which OpenAPI 3.1 uses as is. */
export function jsonSchema(schema: ZodTypeAny, depth = 0): Json {
  if (depth > 12) return {};
  const def = (schema as { _def: Record<string, any> })._def;
  const inner = (next: ZodTypeAny) => jsonSchema(next, depth + 1);
  const withDescription = (out: Json) => (def.description ? { ...out, description: def.description } : out);
  switch (def.typeName) {
    case 'ZodString': {
      const out: Json = { type: 'string' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out.minLength = check.value;
        else if (check.kind === 'max') out.maxLength = check.value;
        else if (check.kind === 'length') out.minLength = out.maxLength = check.value;
        else if (check.kind === 'email') out.format = 'email';
        else if (check.kind === 'url') out.format = 'uri';
        else if (check.kind === 'uuid') out.format = 'uuid';
        else if (check.kind === 'datetime') out.format = 'date-time';
        else if (check.kind === 'date') out.format = 'date';
        // A JSON Schema pattern has no flags; /^[a-z]+$/i as one would refuse "ABC".
        else if (check.kind === 'regex' && !/[ims]/.test(check.regex.flags)) out.pattern = check.regex.source;
      }
      return withDescription(out);
    }
    case 'ZodNumber': {
      const out: Json = { type: def.checks?.some((c: { kind: string }) => c.kind === 'int') ? 'integer' : 'number' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
        else if (check.kind === 'max') out[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
      }
      return withDescription(out);
    }
    case 'ZodBigInt':
      return withDescription({ type: 'integer' });
    case 'ZodBoolean':
      return withDescription({ type: 'boolean' });
    case 'ZodDate':
      return withDescription({ type: 'string', format: 'date-time' });
    case 'ZodLiteral':
      return withDescription({ const: def.value });
    case 'ZodEnum':
      return withDescription({ type: 'string', enum: def.values });
    case 'ZodNativeEnum':
      return withDescription({ enum: [...new Set(Object.values(def.values as Record<string, unknown>))] });
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodObject': {
      const shape = def.shape() as Record<string, ZodTypeAny>;
      const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, inner(value)]));
      const required = Object.entries(shape)
        .filter(([, value]) => !value.isOptional())
        .map(([key]) => key);
      const catchall = def.catchall?._def?.typeName !== 'ZodNever' ? def.catchall : null;
      return withDescription({
        type: 'object',
        properties,
        ...(required.length && { required }),
        ...(catchall
          ? { additionalProperties: inner(catchall) }
          : def.unknownKeys === 'strict' && { additionalProperties: false }),
      });
    }
    case 'ZodArray':
      return withDescription({
        type: 'array',
        items: inner(def.type),
        ...(def.minLength && { minItems: def.minLength.value }),
        ...(def.maxLength && { maxItems: def.maxLength.value }),
        ...(def.exactLength && { minItems: def.exactLength.value, maxItems: def.exactLength.value }),
      });
    case 'ZodSet':
      return withDescription({ type: 'array', uniqueItems: true, items: inner(def.valueType) });
    case 'ZodTuple':
      return withDescription({ type: 'array', prefixItems: def.items.map(inner) });
    case 'ZodRecord':
    case 'ZodMap':
      return withDescription({ type: 'object', additionalProperties: inner(def.valueType) });
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return withDescription({ anyOf: [...def.options.values()].map(inner) });
    case 'ZodIntersection':
      return withDescription({ allOf: [inner(def.left), inner(def.right)] });
    case 'ZodOptional':
      return inner(def.innerType);
    case 'ZodNullable':
      return { anyOf: [inner(def.innerType), { type: 'null' }] };
    case 'ZodDefault': {
      const value = def.defaultValue();
      return { ...inner(def.innerType), ...(value !== undefined && { default: JSON.parse(JSON.stringify(value)) }) };
    }
    case 'ZodCatch':
    case 'ZodReadonly':
      return inner(def.innerType);
    case 'ZodBranded':
      return inner(def.type);
    case 'ZodEffects':
      return withDescription(inner(def.schema));
    case 'ZodPipeline':
      return inner(def.in);
    case 'ZodLazy':
      return inner(def.getter());
    default:
      // ZodAny, ZodUnknown and anything this walker does not know: any value.
      return {};
  }
}

/** The object schema under refinements and pipes, for params and query. */
function objectShape(schema: ZodTypeAny | undefined): Record<string, ZodTypeAny> | null {
  let current = schema as { _def: Record<string, any> } | undefined;
  while (current) {
    const def = current._def;
    if (def.typeName === 'ZodObject') return def.shape();
    current = def.schema ?? def.in ?? def.innerType;
  }
  return null;
}

function parameters(path: string, spec: AnySpec | undefined) {
  const params = objectShape(spec?.params) ?? {};
  const fromPath = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  return [
    ...fromPath.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: params[name] ? jsonSchema(params[name]!) : { type: 'string' },
    })),
    ...Object.entries(objectShape(spec?.query) ?? {}).map(([name, schema]) => ({
      name,
      in: 'query',
      required: !schema.isOptional(),
      schema: jsonSchema(schema),
    })),
  ];
}

export interface RouteEntry {
  path: string;
  method: (typeof HTTP_METHODS)[number];
  /** Absent for a handler outside `route()` (`bareRoute`, a stream, a webhook). */
  spec?: AnySpec;
}

const operationId = (method: string, path: string) =>
  `${method.toLowerCase()}${path
    .replace(/^\/api\/v1/, '')
    .split(/[/{}.-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')}`;

function operation({ path, method, spec }: RouteEntry): Json {
  const params = parameters(path, spec);
  const common = {
    operationId: operationId(method, path),
    ...(params.length && { parameters: params }),
    responses: {
      '200': { description: 'Success' },
      default: { $ref: '#/components/responses/Problem' },
    },
  };
  if (!spec) {
    return {
      tags: ['other'],
      description: 'Answers outside the route() kernel (its own authentication); no declared schema.',
      ...common,
    };
  }
  const modules = spec.productModule ? [spec.productModule].flat() : [];
  return {
    tags: [spec.module],
    summary: spec.anonymous ? 'Public' : spec.selfService ? 'Your own account' : `${spec.module}:${spec.action}`,
    ...(!spec.anonymous && !spec.selfService && { 'x-permission': `${spec.module}:${spec.action}` }),
    ...(modules.length && { 'x-product-modules': modules }),
    security: spec.anonymous ? [] : spec.sessionOnly ? [{ session: [] }] : [{ session: [] }, { apiKey: [] }],
    ...common,
    ...(spec.body &&
      method !== 'GET' && {
        requestBody: {
          required: !spec.body.isOptional(),
          content: { 'application/json': { schema: jsonSchema(spec.body) } },
        },
      }),
  };
}

export function openApiDocument(entries: RouteEntry[]) {
  const paths: Record<string, Json> = {};
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    paths[entry.path] = { ...paths[entry.path], [entry.method.toLowerCase()]: operation(entry) };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'YOUHAN ONE API',
      version: '1',
      description:
        'Generated from the route() specs (src/lib/api/openapi.ts). Errors are RFC 9457 problem+json; see docs/03-API.md.',
    },
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'lf_session' },
        apiKey: { type: 'http', scheme: 'bearer', description: 'A workspace API key, `lf_live_…`.' },
      },
      responses: {
        Problem: {
          description: 'An error, as RFC 9457 problem+json.',
          content: {
            'application/problem+json': {
              schema: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  title: { type: 'string' },
                  status: { type: 'integer' },
                  detail: { type: 'string' },
                  requestId: { type: 'string' },
                  errors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { field: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
