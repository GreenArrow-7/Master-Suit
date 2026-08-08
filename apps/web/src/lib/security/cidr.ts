/**
 * CIDR membership for IPv4 and IPv6.
 *
 * Written out rather than string-matched: `startsWith('10.')` also matches
 * `10.0.0.1.evil.com` and `100.64.0.1`, and a regex over dotted quads cannot
 * express a prefix length at all. Getting this wrong means an attacker's
 * `X-Forwarded-For` is believed, which is the whole point of the check.
 *
 * IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is normalised to its v4 form first,
 * because that is how a dual-stack Node server reports an IPv4 client.
 */

export interface Cidr {
  /** Big-endian address bytes: 4 for v4, 16 for v6. */
  bytes: Uint8Array;
  prefix: number;
}

const V4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Parses a bare address. Returns null for anything malformed. */
export function parseIp(value: string): Uint8Array | null {
  const ip = value.trim().toLowerCase();
  if (!ip) return null;

  const mapped = V4_MAPPED.exec(ip);
  if (mapped) return parseIpv4(mapped[1]);
  if (ip.includes(':')) return parseIpv6(ip);
  return parseIpv4(ip);
}

function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    // Reject '', '01', '+1', ' 1' and anything non-numeric: a lenient parser
    // here is how 010.0.0.1 gets read two different ways by two components.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseIpv6(value: string): Uint8Array | null {
  // Strip a zone index (`fe80::1%eth0`); it is not part of the address.
  const address = value.split('%')[0];
  const halves = address.split('::');
  if (halves.length > 2) return null;

  const expand = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (group.includes('.')) {
        // Trailing dotted-quad form, e.g. ::ffff:192.0.2.1
        const v4 = parseIpv4(group);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];
  if (!head || !tail) return null;

  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;

  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  if (groups.length !== 8) return null;

  const out = new Uint8Array(16);
  groups.forEach((group, i) => {
    out[i * 2] = group >> 8;
    out[i * 2 + 1] = group & 0xff;
  });
  return out;
}

/** `10.0.0.0/8` → a comparable range. Throws on anything it cannot parse. */
export function parseCidr(value: string): Cidr {
  const [address, prefixPart] = value.trim().split('/');
  const bytes = parseIp(address);
  if (!bytes) throw new Error(`Not an IP address: ${value}`);

  const maxPrefix = bytes.length * 8;
  const prefix = prefixPart === undefined ? maxPrefix : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new Error(`Not a valid prefix length for ${address}: /${prefixPart}`);
  }
  return { bytes, prefix };
}

export function parseCidrList(value: string): Cidr[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseCidr);
}

/** True when `ip` falls inside `cidr`. Address families must match. */
export function inCidr(ip: Uint8Array, cidr: Cidr): boolean {
  if (ip.length !== cidr.bytes.length) return false;

  const wholeBytes = cidr.prefix >> 3;
  for (let i = 0; i < wholeBytes; i++) {
    if (ip[i] !== cidr.bytes[i]) return false;
  }
  const remainingBits = cidr.prefix & 7;
  if (remainingBits === 0) return true;

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (ip[wholeBytes] & mask) === (cidr.bytes[wholeBytes] & mask);
}

export function isInAny(value: string, cidrs: readonly Cidr[]): boolean {
  const ip = parseIp(value);
  if (!ip) return false;
  return cidrs.some((cidr) => inCidr(ip, cidr));
}
