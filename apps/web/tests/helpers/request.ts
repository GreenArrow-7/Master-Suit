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
  handler: Function,
  method: string,
  path: string,
  as?: As,
  body?: Record<string, unknown>,
): Promise<TestResponse> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: buildHeaders(as, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await handler(req, { params: Promise.resolve(extractParams(path)) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export const get = (handler: Function, path: string, as?: As) => send(handler, 'GET', path, as);

export const post = (handler: Function, path: string, body: Record<string, unknown>, as?: As) =>
  send(handler, 'POST', path, as, body);

export const patch = (handler: Function, path: string, body: Record<string, unknown>, as?: As) =>
  send(handler, 'PATCH', path, as, body);

export const del = (handler: Function, path: string, as?: As) => send(handler, 'DELETE', path, as);

/** `/api/v1/leads/abc123` → `{ id: 'abc123' }` */
function extractParams(path: string): Record<string, string> {
  const parts = path.split('?')[0].split('/');
  return parts.length >= 5 && parts[1] === 'api' && parts[4] ? { id: parts[4] } : {};
}
