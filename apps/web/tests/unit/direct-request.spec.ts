import { describe, expect, it } from 'vitest';
import { isDirectLocalRequest } from '@/lib/security/directRequest';

/**
 * The development outbox is served only to this machine. A dev tunnel or port
 * forward reaches the same server with forwarding headers naming the real client
 * and host; those must be refused, while direct local calls and the local TLS
 * relay the browser suite uses keep working.
 */
const request = (headers: Record<string, string>) =>
  new Request('http://127.0.0.1:3100/api/v1/dev/outbox', { headers });

describe('isDirectLocalRequest', () => {
  it.each([
    ['direct on 127.0.0.1', { host: '127.0.0.1:3100' }],
    ['direct on localhost', { host: 'localhost:3100' }],
    ['direct on IPv6 loopback', { host: '[::1]:3100' }],
    [
      'through the local TLS relay',
      { host: '127.0.0.1:3443', 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' },
    ],
  ])('allows a request made %s', (_name, headers) => {
    expect(isDirectLocalRequest(request(headers))).toBe(true);
  });

  it.each([
    ['a tunnel host', { host: '15bqsq8n-3100.aue.devtunnels.ms' }],
    [
      'a tunnel that rewrites Host but forwards the real one',
      { host: 'localhost:3100', 'x-forwarded-host': '15bqsq8n-3100.aue.devtunnels.ms' },
    ],
    ['a forwarded client address', { host: 'localhost:3100', 'x-forwarded-for': '203.0.113.9' }],
    ['a chain with one outside hop', { host: 'localhost:3100', 'x-forwarded-for': '203.0.113.9, 127.0.0.1' }],
    ['a Forwarded header', { host: 'localhost:3100', forwarded: 'for=127.0.0.1;host=localhost' }],
    ['an unparseable Host', { host: 'not a host' }],
    ['no Host', {}],
  ])('refuses %s', (_name, headers) => {
    expect(isDirectLocalRequest(request(headers))).toBe(false);
  });
});
