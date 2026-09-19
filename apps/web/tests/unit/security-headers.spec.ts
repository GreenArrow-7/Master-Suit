import { describe, expect, it } from 'vitest';
import config from '../../next.config';

/** Live-call coaching and practice recording capture the microphone on our own origin. */
describe('Permissions-Policy', () => {
  it('allows microphone, camera and geolocation on self only', async () => {
    const groups = await (config.headers as () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>)();
    const policy = groups.flatMap((g) => g.headers).find((h) => h.key === 'Permissions-Policy')?.value ?? '';
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('geolocation=(self)');
  });
});
