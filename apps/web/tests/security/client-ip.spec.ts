/**
 * P1-2 — who the client actually is.
 *
 * `X-Forwarded-For` is a list the *client* can start. The old implementation
 * had two states, both wrong:
 *
 *   - trust disabled (the default): return null, so every request on the
 *     platform shared one rate-limit bucket keyed `unknown` and every audit row
 *     recorded `unknown`;
 *   - trust enabled: return `split(',')[0]`, the leftmost entry — precisely the
 *     one an attacker controls.
 *
 * The chain is now walked from the right, discarding hops we recognise as ours.
 */
import { describe, expect, it } from 'vitest';
import { clientIp } from '@/lib/auth/session';
import { parseCidrList, parseIp, inCidr, isInAny } from '@/lib/security/cidr';

const TRUSTED = parseCidrList('10.0.0.0/8, 172.16.0.0/12, 2001:db8::/32');
const NONE = parseCidrList('');

const request = (headers: Record<string, string>) => new Request('http://localhost', { headers });

describe('clientIp', () => {
  it('ignores every forwarded header when no proxy is configured', () => {
    // This assertion used to expect '198.51.100.7' — the `x-real-ip` header —
    // which is not "ignoring forwarded headers" at all: it is believing one. Any
    // client could set it and so choose its own rate-limit identity, and rotate
    // it to make the login limiter irrelevant. With nothing declared in front of
    // the server, there is no trustworthy answer and null is the honest one.
    const req = request({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '198.51.100.7' });
    expect(clientIp(req, NONE)).toBeNull();
  });

  it('cannot be steered by a client picking its own identity', () => {
    const first = request({ 'x-real-ip': '198.51.100.7' });
    const second = request({ 'x-real-ip': '198.51.100.8' });
    // Two requests, two claimed identities, one bucket — the attacker gains
    // nothing by rotating the header.
    expect(clientIp(first, NONE)).toBe(clientIp(second, NONE));
  });

  it('takes the leftmost untrusted hop when proxies are declared', () => {
    // Only a declared proxy can reach this branch. If the application is also
    // reachable directly, both headers are attacker-supplied and no code here
    // can tell — that is a network requirement, documented in docs/05-SECURITY.md.
    const req = request({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '198.51.100.7' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('skips a malformed entry rather than making it a rate-limit key', () => {
    const req = request({ 'x-forwarded-for': '203.0.113.10, not-an-ip, 10.0.0.9' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('refuses a header that is entirely malformed', () => {
    const req = request({ 'x-forwarded-for': 'drop table users; --', 'x-real-ip': '<script>' });
    expect(clientIp(req, TRUSTED)).toBeNull();
  });

  it('strips a port from an IPv4 entry', () => {
    const req = request({ 'x-forwarded-for': '203.0.113.10:44321, 10.0.0.9' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('handles a bracketed IPv6 entry with a port', () => {
    const req = request({ 'x-forwarded-for': '[2606:4700::1]:443, 10.0.0.9' });
    expect(clientIp(req, TRUSTED)).toBe('2606:4700::1');
  });

  it('recognises a trusted IPv6 proxy and looks past it', () => {
    const req = request({ 'x-forwarded-for': '2606:4700::1, 2001:db8::5' });
    expect(clientIp(req, TRUSTED)).toBe('2606:4700::1');
  });

  it('returns null when there is no address information at all', () => {
    expect(clientIp(request({}), TRUSTED)).toBeNull();
    expect(clientIp(request({}), NONE)).toBeNull();
  });

  it('returns the client when the request came through one trusted proxy', () => {
    const req = request({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '10.0.0.5' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('walks past every trusted hop, not just the last', () => {
    const req = request({ 'x-forwarded-for': '203.0.113.10, 10.0.0.9, 172.16.4.4', 'x-real-ip': '10.0.0.5' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('refuses a spoofed prefix — an attacker cannot prepend a fake client', () => {
    // The attacker sends `X-Forwarded-For: 1.2.3.4` from a real client address.
    // The proxy appends the true address, so the rightmost untrusted entry is
    // the truth and the injected one is ignored.
    const req = request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.10', 'x-real-ip': '10.0.0.5' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('falls back to the socket address when the whole chain is ours', () => {
    const req = request({ 'x-forwarded-for': '10.0.0.9, 172.16.4.4', 'x-real-ip': '10.0.0.5' });
    expect(clientIp(req, TRUSTED)).toBe('10.0.0.5');
  });

  it('handles IPv6 proxies and clients', () => {
    const req = request({ 'x-forwarded-for': '2606:4700::1111, 2001:db8::99', 'x-real-ip': '2001:db8::1' });
    expect(clientIp(req, TRUSTED)).toBe('2606:4700::1111');
  });

  it('treats an IPv4-mapped IPv6 socket address as its IPv4 form', () => {
    const req = request({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '::ffff:10.0.0.5' });
    expect(clientIp(req, TRUSTED)).toBe('203.0.113.10');
  });

  it('returns null when there is no address at all', () => {
    expect(clientIp(request({}), TRUSTED)).toBeNull();
  });
});

describe('CIDR matching', () => {
  it('matches on prefix bits, not string prefixes', () => {
    const ten = parseCidrList('10.0.0.0/8')[0];
    expect(isInAny('10.255.255.255', [ten])).toBe(true);
    // The bug a `startsWith('10.')` check would have: neither of these is in 10/8.
    expect(isInAny('100.64.0.1', [ten])).toBe(false);
    expect(isInAny('110.0.0.1', [ten])).toBe(false);
  });

  it('honours a non-byte-aligned prefix', () => {
    const twelve = parseCidrList('172.16.0.0/12')[0];
    expect(isInAny('172.16.0.1', [twelve])).toBe(true);
    expect(isInAny('172.31.255.254', [twelve])).toBe(true);
    expect(isInAny('172.32.0.1', [twelve])).toBe(false);
    expect(isInAny('172.15.255.255', [twelve])).toBe(false);
  });

  it('never matches across address families', () => {
    const v4 = parseCidrList('0.0.0.0/0')[0];
    const v6 = parseCidrList('::/0')[0];
    expect(isInAny('2001:db8::1', [v4])).toBe(false);
    expect(isInAny('10.0.0.1', [v6])).toBe(false);
  });

  it('rejects malformed addresses rather than guessing', () => {
    // Leading zeros are the classic parser-differential: 010.0.0.1 is octal to
    // some resolvers and decimal to others.
    for (const bad of ['010.0.0.1', '1.2.3', '1.2.3.4.5', '256.0.0.1', '', 'localhost', '1.2.3.-1']) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it('parses IPv6 shorthand correctly', () => {
    expect(parseIp('::1')).not.toBeNull();
    expect(parseIp('2001:db8::')).not.toBeNull();
    expect(parseIp('fe80::1%eth0')).not.toBeNull();
    expect(parseIp('::ffff:192.0.2.1')).toEqual(parseIp('192.0.2.1'));
    expect(parseIp('1::2::3')).toBeNull();
    expect(parseIp('12345::')).toBeNull();
  });

  it('treats a bare address as a full-length prefix', () => {
    const single = parseCidrList('10.1.2.3')[0];
    expect(single.prefix).toBe(32);
    expect(inCidr(parseIp('10.1.2.3')!, single)).toBe(true);
    expect(inCidr(parseIp('10.1.2.4')!, single)).toBe(false);
  });

  it('refuses an impossible prefix length', () => {
    expect(() => parseCidrList('10.0.0.0/33')).toThrow();
    expect(() => parseCidrList('2001:db8::/129')).toThrow();
    expect(() => parseCidrList('nonsense/8')).toThrow();
  });
});
