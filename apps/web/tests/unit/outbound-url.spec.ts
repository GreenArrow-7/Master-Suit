/**
 * The media worker fetches a URL a telephony vendor put in a webhook.
 *
 * That webhook is signed for Twilio and Plivo. Exotel and Knowlarity cannot
 * sign at all — they are authenticated by an unguessable URL key — and the
 * process doing the fetching is the worker, inside the Compose network, where
 * `postgres:5432`, `minio:9000`, the face engine and (on a cloud host) the
 * metadata service on 169.254.169.254 all live.
 *
 * These are mostly tests of things that must be *refused*. A guard whose only
 * test is that it lets the right URL through is a guard nobody has checked.
 */
import { describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

const { assertFetchableUrl, hostAllowed, isPrivateAddress } = await import('@/lib/security/outboundUrl');

const ALLOWED = ['api.twilio.com', '.twiliocdn.com'];
const publicly = (address = '93.184.216.34') => lookup.mockResolvedValue([{ address, family: 4 }]);

describe('isPrivateAddress', () => {
  const cases: [string, boolean][] = [
    ['93.184.216.34', false],
    ['8.8.8.8', false],
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false], // just outside 172.16/12 — the classic off-by-one
    ['192.168.1.1', true],
    ['169.254.169.254', true], // cloud metadata
    ['100.64.0.1', true], // carrier NAT
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['::ffff:169.254.169.254', true], // the metadata service by another name
    ['2606:2800:220:1:248:1893:25c8:1946', false],
    ['not-an-address', true], // cannot reason about it, so refuse
  ];
  for (const [address, expected] of cases) {
    it(`${address} is ${expected ? 'private' : 'public'}`, () => {
      expect(isPrivateAddress(address)).toBe(expected);
    });
  }
});

describe('hostAllowed', () => {
  it('matches an exact entry', () => {
    expect(hostAllowed('api.twilio.com', ALLOWED)).toBe(true);
  });

  it('matches a subdomain of a dotted entry', () => {
    expect(hostAllowed('media.twiliocdn.com', ALLOWED)).toBe(true);
  });

  it('does not let a suffix entry match a lookalike domain', () => {
    // The leading dot is the whole point: without it, `twiliocdn.com` would
    // match `eviltwiliocdn.com` by suffix.
    expect(hostAllowed('eviltwiliocdn.com', ALLOWED)).toBe(false);
    expect(hostAllowed('nottwiliocdn.com', ALLOWED)).toBe(false);
  });

  it('does not match a host that merely contains an entry', () => {
    expect(hostAllowed('api.twilio.com.evil.test', ALLOWED)).toBe(false);
  });

  it('is case-insensitive, as host names are', () => {
    expect(hostAllowed('API.Twilio.COM', ALLOWED)).toBe(true);
  });
});

describe('assertFetchableUrl', () => {
  it('allows a vendor URL that resolves publicly', async () => {
    publicly();
    const url = await assertFetchableUrl('https://api.twilio.com/rec/abc.mp3', ALLOWED);
    expect(url.hostname).toBe('api.twilio.com');
  });

  it('refuses http, which would put the media credential on the wire', async () => {
    publicly();
    await expect(assertFetchableUrl('http://api.twilio.com/x', ALLOWED)).rejects.toThrow(/must be https/);
  });

  it('refuses a host that is not on the list', async () => {
    publicly();
    await expect(assertFetchableUrl('https://evil.test/x', ALLOWED)).rejects.toThrow(/not in the allow-list/);
  });

  it('refuses everything when no allow-list is configured', async () => {
    // Fails closed. An empty list is a misconfiguration, and treating it as
    // "allow anything" is how this guard would quietly stop existing.
    publicly();
    await expect(assertFetchableUrl('https://api.twilio.com/x', [])).rejects.toThrow(/no recording host allow-list/);
  });

  it('refuses an allowed host that resolves to a private address', async () => {
    // The attack this exists for: a DNS record the attacker controls on a host
    // somebody widened the allow-list to include.
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertFetchableUrl('https://api.twilio.com/x', ALLOWED)).rejects.toThrow(/169\.254\.169\.254/);
  });

  it('refuses when only one of several records is private', async () => {
    // Checking the first record only would pass this, and the connection could
    // still be made to the second.
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(assertFetchableUrl('https://api.twilio.com/x', ALLOWED)).rejects.toThrow(/10\.0\.0\.5/);
  });

  it('refuses a private literal address even if the list contains it', async () => {
    await expect(assertFetchableUrl('https://127.0.0.1/x', ['127.0.0.1'])).rejects.toThrow(/private address/);
  });

  it('refuses a host that does not resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertFetchableUrl('https://api.twilio.com/x', ALLOWED)).rejects.toThrow(/does not resolve/);
  });

  it('refuses a host that resolves to nothing', async () => {
    lookup.mockResolvedValue([]);
    await expect(assertFetchableUrl('https://api.twilio.com/x', ALLOWED)).rejects.toThrow(/resolved to nothing/);
  });

  it('refuses something that is not a URL at all', async () => {
    await expect(assertFetchableUrl('not a url', ALLOWED)).rejects.toThrow(/not a URL/);
  });
});
