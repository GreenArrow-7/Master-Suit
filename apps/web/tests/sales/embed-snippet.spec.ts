import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import proxy from '@/proxy';
import nextConfig from '../../next.config';

/**
 * The embeddable snippet (audit row M6-07): one script tag on a brokerage's
 * own site frames the workspace's public form. The script itself is static and
 * CSP-safe; the policy lets the public form, and only the public form, be
 * framed by another site. tests/e2e/embed-form.spec.ts runs it in a browser.
 */
const script = readFileSync(path.join(__dirname, '..', '..', 'public', 'embed.js'), 'utf8');

function csp(pathname: string): Record<string, string> {
  vi.stubEnv('NODE_ENV', 'production');
  const header = proxy(new NextRequest(`https://app.example${pathname}`)).headers.get('content-security-policy') ?? '';
  return Object.fromEntries(
    header.split('; ').map((directive) => {
      const [name, ...rest] = directive.split(' ');
      return [name, rest.join(' ')];
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/embed.js', () => {
  it('reads the workspace and form off its own script tag and frames the public form', () => {
    expect(script).toContain('document.currentScript');
    expect(script).toContain('data-workspace');
    expect(script).toContain('data-form');
    expect(script).toMatch(/createElement\(['"]iframe['"]\)/);
    expect(script).toContain('/f/');
    expect(script).toContain('embed=1');
  });

  it('is CSP-safe: nothing is evaluated or written as markup', () => {
    expect(script).not.toMatch(/\beval\(|new Function|document\.write|innerHTML|outerHTML/);
  });

  it('is served cacheable', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === '/embed.js');
    expect(rule?.headers).toContainEqual({ key: 'Cache-Control', value: expect.stringMatching(/max-age=[1-9]/) });
  });
});

describe('framing', () => {
  it('lets any site frame the public form, and nothing else', () => {
    expect(csp('/f/acme/contact')['frame-ancestors']).toBe('*');
    expect(csp('/f/acme/contact?embed=1')['frame-ancestors']).toBe('*');
    for (const elsewhere of ['/l/acme/launch', '/c/acme/stand', '/acme/lead-eagle/forms', '/login', '/f/acme']) {
      expect(csp(elsewhere)['frame-ancestors'], elsewhere).toBe("'none'");
    }
  });
});
