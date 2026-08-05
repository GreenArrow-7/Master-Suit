import { describe, expect, it } from 'vitest';
import { clientIp } from '@/lib/auth/session';

describe('forwarded client IP handling', () => {
  const request = new Request('http://localhost', {
    headers: {
      'x-forwarded-for': '203.0.113.10, 10.0.0.5',
      'x-real-ip': '203.0.113.11',
    },
  });

  it('ignores spoofable forwarding headers on direct requests', () => {
    expect(clientIp(request, false)).toBeNull();
  });

  it('uses the first address after a trusted proxy has overwritten the header', () => {
    expect(clientIp(request, true)).toBe('203.0.113.10');
  });
});
