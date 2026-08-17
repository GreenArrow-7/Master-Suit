import { describe, it, expect, afterAll, vi } from 'vitest';

/**
 * Hoisted above the imports on purpose: `lib/env.ts` validates and freezes the
 * environment the moment it is imported, so setting these in `beforeAll` would
 * be too late and the flow would read an unconfigured deployment.
 */
vi.hoisted(() => {
  process.env.META_APP_ID = 'test-app-id';
  process.env.META_APP_SECRET = 'test-app-secret-must-never-leak';
});

import { redis } from '@/lib/redis';
import { beginMetaOAuth, consumeMetaOAuthState, metaRedirectUri, META_SCOPES } from '@/services/meta/oauth';

/**
 * The security properties of the connect flow.
 *
 * The token exchange itself needs a real Meta app and is not covered here — see
 * the handoff. What *is* covered is everything an attacker touches: the state
 * handle, its single use, and the fact that the app secret never appears in
 * anything the browser is given.
 */
afterAll(async () => {
  await redis.quit().catch(() => {});
});

const state = { tenantId: 'tenant-a', actorId: 'user-1', returnTo: '/w/admin/integrations/meta' };
const handleFrom = (url: string) => new URL(url).searchParams.get('state')!;

describe('meta oauth', () => {
  it('sends the browser to Facebook with everything the dialog needs', async () => {
    const url = await beginMetaOAuth(state);
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://www.facebook.com');
    expect(parsed.pathname).toMatch(/^\/v\d+\.\d+\/dialog\/oauth$/);
    expect(parsed.searchParams.get('client_id')).toBe('test-app-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(metaRedirectUri());
    expect(parsed.searchParams.get('scope')).toBe(META_SCOPES.join(','));
  });

  /**
   * The whole point of the server-side store. A signed blob in the URL could be
   * decoded, and anything the browser can read is something a support ticket
   * screenshot can leak.
   */
  it('never puts the app secret, the tenant or the user in the URL', async () => {
    const url = await beginMetaOAuth(state);
    expect(url).not.toContain('test-app-secret-must-never-leak');
    expect(url).not.toContain('tenant-a');
    expect(url).not.toContain('user-1');
  });

  it('hands back an opaque handle, not the state itself', async () => {
    const handle = handleFrom(await beginMetaOAuth(state));
    expect(handle.length).toBeGreaterThan(32);
    expect(() => JSON.parse(Buffer.from(handle, 'base64url').toString())).toThrow();
  });

  it('resolves the handle to the workspace that started the flow', async () => {
    const handle = handleFrom(await beginMetaOAuth(state));
    expect(await consumeMetaOAuthState(handle)).toEqual(state);
  });

  /**
   * Single use, atomically. A replayed callback arriving alongside the genuine
   * one must not also succeed, which is why this uses GETDEL rather than a read
   * followed by a delete.
   */
  it('spends the handle on first use', async () => {
    const handle = handleFrom(await beginMetaOAuth(state));
    expect(await consumeMetaOAuthState(handle)).not.toBeNull();
    expect(await consumeMetaOAuthState(handle)).toBeNull();
  });

  it('refuses a handle nobody issued', async () => {
    expect(await consumeMetaOAuthState('a-made-up-handle')).toBeNull();
    expect(await consumeMetaOAuthState('')).toBeNull();
    // A long value is rejected outright rather than turned into a huge Redis key.
    expect(await consumeMetaOAuthState('x'.repeat(5000))).toBeNull();
  });

  it('gives every flow its own handle', async () => {
    const [a, b] = await Promise.all([beginMetaOAuth(state), beginMetaOAuth(state)]);
    expect(handleFrom(a)).not.toBe(handleFrom(b));
  });

  it('expires the handle rather than leaving it live for ever', async () => {
    const handle = handleFrom(await beginMetaOAuth(state));
    const ttl = await redis.ttl(`meta:oauth:${handle}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('asks only for permissions the product actually uses', () => {
    // Every scope here is one App Review will ask about, so an unused one is a
    // question to answer for a feature that does not exist.
    expect([...META_SCOPES]).toEqual([
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_engagement',
      'pages_messaging',
      'instagram_basic',
      'instagram_manage_comments',
      'pages_manage_metadata',
      'leads_retrieval',
    ]);
  });

  it('uses one fixed callback URL, since Meta matches it exactly', () => {
    expect(metaRedirectUri()).toMatch(/^https?:\/\/.+\/api\/v1\/integrations\/meta\/callback$/);
    expect(metaRedirectUri()).not.toContain('//api');
  });
});
