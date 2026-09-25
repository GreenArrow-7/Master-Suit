import { describe, expect, it } from 'vitest';
import { proposalLink } from '@/lib/proposals/proposalLink';
import { listingImageLink } from '@/lib/inventory/listingImageLink';

/**
 * The token, on its own.
 *
 * `publicLink` is already covered where it was written; what is worth proving
 * here is the thing a new caller gets wrong — that this link is domain
 * separated from the ones beside it. A proposal token that also opened a
 * listing image, or an RSVP, would turn one client's shortlist into a key for
 * somebody else's flow.
 */
describe('proposalLink', () => {
  const tenantId = 'tenant_abc';
  const proposalId = 'prop_123';

  it('round-trips the tenant and the record', () => {
    expect(proposalLink.verify(proposalLink.token(tenantId, proposalId))).toEqual({
      tenantId,
      recordId: proposalId,
    });
  });

  it('carries the tenant, so the public lookup is scoped like an authenticated one', () => {
    expect(proposalLink.token(tenantId, proposalId).startsWith(`${tenantId}.${proposalId}.`)).toBe(true);
  });

  it('refuses a token minted for another purpose', () => {
    expect(proposalLink.verify(listingImageLink.token(tenantId, proposalId))).toBeNull();
    expect(listingImageLink.verify(proposalLink.token(tenantId, proposalId))).toBeNull();
  });

  it('refuses a token whose record id has been swapped', () => {
    const [tenant, , signature] = proposalLink.token(tenantId, proposalId).split('.');
    expect(proposalLink.verify(`${tenant}.prop_999.${signature}`)).toBeNull();
  });

  it('refuses a token whose tenant has been swapped', () => {
    const [, record, signature] = proposalLink.token(tenantId, proposalId).split('.');
    expect(proposalLink.verify(`tenant_xyz.${record}.${signature}`)).toBeNull();
  });

  it('never throws on rubbish', () => {
    for (const rubbish of ['', '.', 'a.b', 'a.b.c', '....', 'a.b.c.d']) {
      expect(proposalLink.verify(rubbish)).toBeNull();
    }
  });

  it('points at /p', () => {
    expect(proposalLink.url(tenantId, proposalId)).toContain('/p/');
  });
});
