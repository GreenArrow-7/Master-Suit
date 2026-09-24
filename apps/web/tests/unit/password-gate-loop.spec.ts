import { describe, expect, it } from 'vitest';
import { config } from '../../src/proxy';
import { needsPasswordChangeRedirect } from '../../src/lib/security/redirect';

/**
 * The forced-password gate blanked the application: the security screen
 * redirected to itself and the router gave up with nothing rendered. It took
 * two faults, one on each side of the `x-pathname` header, so both are held
 * here.
 */
describe('forced-password gate cannot redirect the security screen to itself', () => {
  it('the proxy runs on prefetches, so x-pathname is always stamped', () => {
    // A `missing` clause naming the prefetch headers is exactly what excluded
    // them; matchers are objects or plain strings, and a plain string excludes
    // nothing.
    for (const entry of config.matcher) {
      expect(typeof entry === 'string' || !('missing' in entry)).toBe(true);
    }
  });

  it('does not redirect when it cannot tell where the request is', () => {
    expect(needsPasswordChangeRedirect(null)).toBe(false);
    expect(needsPasswordChangeRedirect(undefined)).toBe(false);
    expect(needsPasswordChangeRedirect('')).toBe(false);
  });

  it('does not redirect a request already on either security screen', () => {
    expect(needsPasswordChangeRedirect('/acme/profile/security')).toBe(false);
    expect(needsPasswordChangeRedirect('/acme/people/security')).toBe(false);
  });

  it('still sends every other screen to the security screen', () => {
    expect(needsPasswordChangeRedirect('/acme/dashboard')).toBe(true);
    expect(needsPasswordChangeRedirect('/acme/sales/leads')).toBe(true);
  });

  /**
   * The suffix test alone answered false on paths that end in exactly what it
   * looks for, because a query, a fragment or a trailing slash is still part of
   * the string. Each of these would have redirected the security screen to
   * itself.
   */
  it('recognises the security screen through a query, a fragment or a trailing slash', () => {
    expect(needsPasswordChangeRedirect('/acme/profile/security/')).toBe(false);
    expect(needsPasswordChangeRedirect('/acme/profile/security?_rsc=abc123')).toBe(false);
    expect(needsPasswordChangeRedirect('/acme/profile/security#top')).toBe(false);
    expect(needsPasswordChangeRedirect('/acme/people/security///')).toBe(false);
  });

  /**
   * The clause that cannot be reasoned wrong. Whatever the suffix test makes of
   * a path, sending a request to the page it is already serving is an infinite
   * loop — the router follows it, receives the same answer, and renders nothing.
   * This is what production did, on a path nothing else here reproduces.
   */
  it('never redirects a request to the page it is already on', () => {
    const target = '/acme/profile/security';
    expect(needsPasswordChangeRedirect('/acme/profile/security', target)).toBe(false);
    expect(needsPasswordChangeRedirect('/acme/profile/security/', target)).toBe(false);
    expect(needsPasswordChangeRedirect('/acme/profile/security?_rsc=abc', target)).toBe(false);
    // A different screen is still sent there — the guard is about self-redirects,
    // not about weakening the gate.
    expect(needsPasswordChangeRedirect('/acme/dashboard', target)).toBe(true);
  });

  it('is unchanged when no target is supplied', () => {
    expect(needsPasswordChangeRedirect('/acme/dashboard')).toBe(true);
    expect(needsPasswordChangeRedirect('/acme/profile/security')).toBe(false);
  });
});
