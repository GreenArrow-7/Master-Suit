import { describe, expect, it } from 'vitest';
import { isAppUserAgent, isIosAppUserAgent } from '@/lib/mobile/iosApp';

// App Store 3.1.1: purchase paths are hidden only inside the iOS app.
//
// The version suffix moves with every build — it is `MARKETING_VERSION+<run
// number>` now, not a literal — so these samples carry a real one (1.2.0+18,
// the build of 15 October) to prove that matching does not depend on it.
describe('isIosAppUserAgent', () => {
  it.each([
    [
      'iPhone app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YouhanOneApp/1.2.0+18',
      true,
    ],
    [
      'iPad app (reports a Mac)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) YouhanOneApp/1.2.0+18',
      true,
    ],
    [
      'Android app',
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130 Mobile Safari/537.36 YouhanOneApp/1.2.0+18',
      false,
    ],
    [
      'iPhone Safari',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      false,
    ],
    ['desktop browser', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', false],
    ['no header', null, false],
  ])('%s', (_label, ua, expected) => {
    expect(isIosAppUserAgent(ua)).toBe(expected);
  });
});

/**
 * The suffix is version metadata, not part of the match.
 *
 * It was the literal `0.1.0-dev-poc` for every build including 1.2.0, so the
 * server could not tell one build from another. Now it carries
 * `MARKETING_VERSION+<build>`, which means it changes every release — and
 * anything matching on it would break every release.
 */
describe('the app is recognised whatever version it reports', () => {
  const iphone = (suffix: string) =>
    `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YouhanOneApp/${suffix}`;

  it.each(['0.1.0-dev-poc', '1.2.0+18', '1.3.0+41', '2.0.0+local'])('%s', (suffix) => {
    expect(isIosAppUserAgent(iphone(suffix))).toBe(true);
    expect(isAppUserAgent(iphone(suffix))).toBe(true);
  });
});
