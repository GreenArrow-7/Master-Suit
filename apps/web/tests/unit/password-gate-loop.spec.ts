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
});
