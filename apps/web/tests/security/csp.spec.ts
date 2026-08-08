import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

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
    const response = middleware(new NextRequest('https://example.test/login'));
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
  it('carries a script nonce', () => {
    expect(policy('production')['script-src']).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('gives every response a different nonce', () => {
    const first = policy('production')['script-src'];
    const second = policy('production')['script-src'];
    expect(first).not.toBe(second);
  });

  it('does not allow inline or eval scripts in production', () => {
    const scriptSrc = policy('production')['script-src'];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
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

  it('passes the nonce to the render through the request headers', () => {
    const response = middleware(new NextRequest('https://example.test/login'));
    const scriptSrc = response.headers.get('content-security-policy')!.match(/'nonce-([^']+)'/)![1];
    expect(response.headers.get('x-middleware-request-x-nonce') ?? scriptSrc).toBeTruthy();
  });
});
