/**
 * True only for a request made on this machine without passing through anything
 * that forwards traffic from elsewhere.
 *
 * For development surfaces that must stay local even when the server itself is
 * reachable from outside — a dev tunnel, a port forward, a reverse proxy. Those
 * all rewrite or add forwarding headers naming the real client and host, so a
 * request qualifies when its Host is a loopback name and every forwarding header
 * it carries names this machine too. The local TLS relay used by the browser
 * suite forwards `x-forwarded-for: 127.0.0.1` and still qualifies.
 *
 * Deliberately strict: an unparseable or unexpected forwarding header refuses.
 * This is not authentication; it only keeps a development-only route from being
 * served to anyone who is not on this machine.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

const hostname = (value: string): string => {
  try {
    return new URL(`http://${value.trim()}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
};

const listed = (header: string | null) =>
  (header ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export function isDirectLocalRequest(req: Request): boolean {
  if (!LOOPBACK.has(hostname(req.headers.get('host') ?? ''))) return false;
  if (listed(req.headers.get('x-forwarded-host')).some((value) => !LOOPBACK.has(hostname(value)))) return false;
  if (listed(req.headers.get('x-forwarded-for')).some((value) => !LOOPBACK.has(value.toLowerCase()))) return false;
  // Rarely set, and its syntax is easy to smuggle past a loose parser.
  if (req.headers.get('forwarded') || req.headers.get('x-original-host')) return false;
  return true;
}
