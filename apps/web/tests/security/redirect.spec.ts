/**
 * A redirect target is only "relative" if it cannot leave this origin.
 *
 * The Meta connect flow accepted a `returnTo` from the caller, carried it
 * through Facebook in server-side state, and redirected to it on the way back.
 * Both ends guarded it with `startsWith('/')` — and both were wrong the same
 * way: `//evil.example` starts with a slash, and `new URL('//evil.example',
 * APP_URL)` resolves to `https://evil.example/`. The origin is gone.
 *
 * That is an open redirect wearing a relative path, and it is worth more than a
 * usual one: the link the victim clicks is the application's own domain, and
 * the hop through Facebook makes the chain look like a legitimate OAuth return.
 */
import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '@/lib/security/redirect';

/** What the callers actually do with the result. */
const resolve = (value: string) => new URL(safeReturnTo(value), 'https://app.example.test').href;

describe('REDIR-001: safeReturnTo keeps a redirect on this origin', () => {
  it('keeps ordinary in-app paths', () => {
    expect(safeReturnTo('/manath-homes/admin/integrations')).toBe('/manath-homes/admin/integrations');
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/a?b=c#d')).toBe('/a?b=c#d');
  });

  it('refuses protocol-relative URLs — the bypass that defeated startsWith("/")', () => {
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example/path')).toBe('/');
    // and the resolved form is what actually matters
    expect(resolve('//evil.example')).toBe('https://app.example.test/');
  });

  it('refuses the backslash variant, which several parsers normalise to //', () => {
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo('/\\/evil.example')).toBe('/');
  });

  it('refuses absolute URLs and non-http schemes', () => {
    for (const hostile of [
      'https://evil.example',
      'http://evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:someone@evil.example',
    ]) {
      expect(safeReturnTo(hostile), hostile).toBe('/');
    }
  });

  it('refuses anything that is not a path at all', () => {
    expect(safeReturnTo('')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo('evil.example')).toBe('/');
  });

  it('never leaves the origin, whatever it is handed', () => {
    const inputs = [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '///evil.example',
      '//user:pass@evil.example',
      '/legit/path',
    ];
    for (const input of inputs) {
      expect(new URL(safeReturnTo(input), 'https://app.example.test').origin, input).toBe('https://app.example.test');
    }
  });
});
