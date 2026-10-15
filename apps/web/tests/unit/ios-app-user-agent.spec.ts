import { describe, expect, it } from 'vitest';
import { isIosAppUserAgent } from '@/lib/mobile/iosApp';

// App Store 3.1.1: purchase paths are hidden only inside the iOS app.
describe('isIosAppUserAgent', () => {
  it.each([
    ['iPhone app', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YouhanOneApp/0.1.0-dev-poc', true],
    ['iPad app (reports a Mac)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) YouhanOneApp/0.1.0-dev-poc', true],
    ['Android app', 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130 Mobile Safari/537.36 YouhanOneApp/0.1.0-dev-poc', false],
    ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', false],
    ['desktop browser', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', false],
    ['no header', null, false],
  ])('%s', (_label, ua, expected) => {
    expect(isIosAppUserAgent(ua)).toBe(expected);
  });
});
