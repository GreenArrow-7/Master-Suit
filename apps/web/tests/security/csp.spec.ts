import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import proxy from '@/proxy';

/**
 * The Content-Security-Policy, as the middleware emits it.
 *
 * It used to be a fixed header in next.config.ts, which cannot carry a nonce —
 * so production ran with `script-src 'unsafe-inline'`, the one directive whose
 * absence makes the rest of the policy worth having. With it, an injected
 * `<script>` simply runs.
 */
function policy(nodeEnv: 'development' | 'production'): Record<string, string> {
  const original = process.env.NODE_ENV;
  // The middleware reads NODE_ENV at call time, so both branches are reachable.
  // `process.env` rejects defineProperty; plain assignment is the way in.
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  try {
    const response = proxy(new NextRequest('https://example.test/login'));
    const header = response.headers.get('content-security-policy') ?? '';
    return Object.fromEntries(
      header.split('; ').map((directive) => {
        const [name, ...rest] = directive.split(' ');
        return [name, rest.join(' ')];
      }),
    );
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = original;
  }
}

describe('Content-Security-Policy', () => {
  /**
   * No nonce, and no `strict-dynamic`.
   *
   * Both were tried. Next 16.2.12 does not stamp nonces onto its script tags in
   * a production build, and a nonce in the policy makes browsers ignore
   * `'unsafe-inline'` while `strict-dynamic` disables `'self'` — so every script
   * on every page was blocked. Asserted here so the combination cannot come back
   * without someone first proving the framework propagates it.
   */
  it('carries no nonce, because the framework does not propagate one', () => {
    expect(policy('production')['script-src']).not.toMatch(/'nonce-/);
    expect(policy('production')['script-src']).not.toContain("'strict-dynamic'");
  });

  it('drops unsafe-eval in production but keeps unsafe-inline', () => {
    const scriptSrc = policy('production')['script-src'];
    // The honest state: weaker than intended, and recorded as such.
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");
  });

  it('allows eval in development only, for React Refresh', () => {
    expect(policy('development')['script-src']).toContain("'unsafe-eval'");
  });

  it('upgrades insecure requests in production only', () => {
    expect(Object.keys(policy('production'))).toContain('upgrade-insecure-requests');
    // On localhost there is no TLS to upgrade to; the directive would break
    // every asset request.
    expect(Object.keys(policy('development'))).not.toContain('upgrade-insecure-requests');
  });

  it('keeps the directives that do not depend on the nonce', () => {
    const production = policy('production');
    expect(production['default-src']).toBe("'self'");
    expect(production['frame-ancestors']).toBe("'none'");
    expect(production['object-src']).toBe("'none'");
    expect(production['base-uri']).toBe("'self'");
    expect(production['form-action']).toBe("'self'");
    // Inline styles are not an execution vector, and this codebase uses the
    // `style` prop throughout.
    expect(production['style-src']).toContain("'unsafe-inline'");
  });
});
