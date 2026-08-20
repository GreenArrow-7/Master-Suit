/**
 * Guards a fetch whose URL came from outside.
 *
 * ── The reachable surface ───────────────────────────────────────────────────
 *
 * `services/shared/ingestRecording.ts` fetches a recording from a URL a
 * telephony vendor put in a webhook. The webhook is signed, and that signature
 * is the real mitigation — but it is the *only* one, and it fails open in a way
 * worth naming: two of the four supported vendors (Exotel, Knowlarity) cannot
 * sign at all and are authenticated by an unguessable URL key instead.
 *
 * The process doing the fetching is the worker, inside the Compose network,
 * which is exactly where the interesting targets are: `postgres:5432`,
 * `minio:9000`, `prometheus:9090`, `alertmanager:9093`, the face engine, and on
 * a cloud host the instance metadata service on 169.254.169.254 — which on some
 * providers hands out credentials to anything that asks.
 *
 * A URL is not a promise about where it points.
 *
 * ── Two checks, because either alone is insufficient ────────────────────────
 *
 * **The allow-list** answers "is this a host we expect recordings from". It is
 * the strong check, and it is the one that goes stale: a vendor moves CDN and
 * ingestion stops, so it is configurable rather than compiled in.
 *
 * **The address check** answers "wherever this points, is it somewhere on the
 * inside". It needs no knowledge of vendors and cannot go stale, so it holds
 * when the allow-list has been widened by an operator in a hurry.
 *
 * ── What this does not stop ─────────────────────────────────────────────────
 *
 * DNS rebinding. The name is resolved here and resolved again by `fetch`, and a
 * record with a one-second TTL can differ between the two. Closing that means
 * connecting to a pinned address with a `Host` header — an undici dispatcher
 * rather than a check — which is a larger change than this is. The allow-list
 * is what carries the weight against it: an attacker would need a rebinding
 * record on a host somebody already trusts for recordings.
 *
 * Redirects are handled at the call site with `redirect: 'error'`, and that is
 * not optional. An allowed host that 302s to `http://169.254.169.254/` defeats
 * every check here, because the check ran against the first URL.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/**
 * Ranges that must never be the target of a fetch driven by outside input.
 *
 * Written as explicit predicates rather than CIDR arithmetic because the list
 * is short, fixed, and each entry is worth being able to read.
 */
function isPrivateV4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 192 && b === 0) return true; // 192.0.0/24 and 192.0.2/24 reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateV6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0];
  if (value === '::1' || value === '::') return true; // loopback, unspecified
  if (value.startsWith('fe80')) return true; // link-local
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique-local
  if (value.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:169.254.169.254) reaches the same places by another name.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(address);
  if (family === 6) return isPrivateV6(address);
  return true; // not an address we can reason about — refuse rather than guess
}

/**
 * `host` matches an allow-list entry exactly, or is a subdomain of one written
 * with a leading dot.
 *
 * `.twiliocdn.com` matches `media.twiliocdn.com` and not `nottwiliocdn.com` —
 * the leading dot is what makes suffix matching safe. An entry without one is
 * an exact host and nothing else.
 */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const target = host.toLowerCase();
  return allowed.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    return entry.startsWith('.') ? target.endsWith(entry) : target === entry;
  });
}

/**
 * Throws unless `raw` is an https URL, on an allowed host, resolving only to
 * public addresses. Returns the parsed URL so the caller cannot accidentally
 * fetch a different string than the one that was checked.
 */
export async function assertFetchableUrl(raw: string, allowed: readonly string[]): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('recording URL is not a URL');
  }

  // https only. http would expose the credential in `mediaHeaders()` on the
  // wire, and every supported vendor serves media over TLS.
  if (url.protocol !== 'https:') {
    throw new BlockedUrlError(`recording URL must be https, got ${url.protocol.replace(':', '')}`);
  }

  if (allowed.length === 0) {
    throw new BlockedUrlError('no recording host allow-list is configured; refusing to fetch');
  }
  if (!hostAllowed(url.hostname, allowed)) {
    throw new BlockedUrlError(`recording host ${url.hostname} is not in the allow-list`);
  }

  // A literal address that passed the allow-list still has to be public — an
  // operator who put an IP in the list should not thereby open the metadata
  // service.
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new BlockedUrlError(`recording host ${url.hostname} is a private address`);
    }
    return url;
  }

  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BlockedUrlError(`recording host ${url.hostname} does not resolve`);
  }
  if (addresses.length === 0) {
    throw new BlockedUrlError(`recording host ${url.hostname} resolved to nothing`);
  }
  // *Every* address, not the first: a host that resolves to one public and one
  // private address is a host that can be connected to privately.
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedUrlError(`recording host ${url.hostname} resolves to the private address ${address}`);
    }
  }
  return url;
}
