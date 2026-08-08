/**
 * Invokes a route handler the way Next would, carrying a real session cookie.
 *
 * The previous version accepted a Ctx and then dropped it on the floor, so every
 * request arrived unauthenticated, and patch/del returned a hardcoded 501
 * instead of calling anything. Auth here is a genuine session cookie minted by
 * tests/helpers/session.ts and resolved by the real resolveCtx.
 */
interface TestResponse {
  status: number;
  body: any;
}

/**
 * A Next route handler, as this file invokes one.
 *
 * Was `Function`, which accepts any callable — including one taking the wrong
 * arguments — so a helper called with a mismatched handler compiled fine and
 * failed at run time.
 */
type RouteHandler = (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** A caller: either a session cookie header value, or an API key. */
export type As = string | { apiKey: string };

function buildHeaders(as?: As, withBody = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withBody) headers['content-type'] = 'application/json';
  if (typeof as === 'string') headers['cookie'] = as;
  else if (as) headers['authorization'] = `Bearer ${as.apiKey}`;
  return headers;
}

async function send(
  handler: RouteHandler,
  method: string,
  path: string,
  as?: As,
  body?: Record<string, unknown>,
  params?: Record<string, string>,
): Promise<TestResponse> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: buildHeaders(as, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await handler(req, { params: Promise.resolve(params ?? extractParams(path)) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * `params` is explicit for routes whose segments extractParams cannot infer —
 * anything that is not the `/api/v1/<module>/<id>` shape, such as
 * `/api/v1/workspaces/[workspaceSlug]/hr/[resource]`.
 */
export const get = (handler: RouteHandler, path: string, as?: As, params?: Record<string, string>) =>
  send(handler, 'GET', path, as, undefined, params);

export const post = (
  handler: RouteHandler,
  path: string,
  body: Record<string, unknown>,
  as?: As,
  params?: Record<string, string>,
) => send(handler, 'POST', path, as, body, params);

export const patch = (
  handler: RouteHandler,
  path: string,
  body: Record<string, unknown>,
  as?: As,
  params?: Record<string, string>,
) => send(handler, 'PATCH', path, as, body, params);

export const del = (handler: RouteHandler, path: string, as?: As, params?: Record<string, string>) =>
  send(handler, 'DELETE', path, as, undefined, params);

/** `/api/v1/leads/abc123` → `{ id: 'abc123' }` */
function extractParams(path: string): Record<string, string> {
  const parts = path.split('?')[0].split('/');
  return parts.length >= 5 && parts[1] === 'api' && parts[4] ? { id: parts[4] } : {};
}
