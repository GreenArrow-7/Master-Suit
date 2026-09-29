import { describe, expect, it } from 'vitest';
import { problemsWith, renderFeed, type FeedListing, type PortalKey } from '@/lib/inventory/portalFeed';

/**
 * What a portal will refuse.
 *
 * This is the half of syndication that has to be right, because the failure is
 * silent: a portal that receives a listing without a permit number does not
 * tell the brokerage, it drops it — or worse, accepts it and a compliance
 * letter arrives. So the rules live in one tested function and the screen
 * shows exactly what it decided.
 */

const NOW = new Date('2026-09-25T09:00:00.000Z');

const complete: FeedListing = {
  id: 'l1',
  reference: 'ME-0001',
  title: 'Two bedroom with a marina view',
  description: 'A bright two bedroom on a high floor with an open marina view, a fitted kitchen and covered parking.',
  listingType: 'SALE',
  status: 'ACTIVE',
  propertyType: 'APARTMENT',
  bedrooms: 2,
  bathrooms: 2,
  areaSqft: 1240,
  price: 2_150_000,
  currency: 'AED',
  rentFrequency: null,
  address: 'Marina Gate 1',
  latitude: 25.08,
  longitude: 55.14,
  amenityKeys: ['parking', 'pool'],
  permitNumber: '7129834',
  permitExpiry: new Date('2027-01-01T00:00:00.000Z'),
  mandateExpires: new Date('2027-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-20T08:00:00.000Z'),
  micromarket: { name: 'Dubai Marina' },
  owner: { fullName: 'Imran Sheikh', email: 'imran@example.test', phone: '+971501112233' },
  media: [
    { id: 'm1', storageKey: 'a.jpg', externalUrl: null },
    { id: 'm2', storageKey: null, externalUrl: 'https://cdn.example.test/b.jpg' },
  ],
};

const without = (over: Partial<FeedListing>): FeedListing => ({ ...complete, ...over });
const PORTALS: PortalKey[] = ['PROPERTY_FINDER', 'BAYUT', 'DUBIZZLE'];

describe('a listing that is ready', () => {
  it('has nothing wrong with it on any portal', () => {
    for (const portal of [...PORTALS, 'WEBSITE' as PortalKey]) {
      expect(problemsWith(complete, portal, NOW)).toHaveLength(0);
    }
  });
});

describe('what a portal refuses', () => {
  it('a listing with no advertising permit, and says why it matters', () => {
    const problems = problemsWith(without({ permitNumber: null }), 'PROPERTY_FINDER', NOW).join(' ');
    expect(problems).toMatch(/permit number/);
    // "Invalid" teaches nobody anything; the consequence is the useful part.
    expect(problems).toMatch(/compliance/);
  });

  it('a permit that has run out, separately from one that was never entered', () => {
    const expired = without({ permitExpiry: new Date('2026-01-01T00:00:00.000Z') });
    const problems = problemsWith(expired, 'BAYUT', NOW).join(' ');
    // The fix is a renewal rather than an entry, so it reads differently.
    expect(problems).toMatch(/permit has expired/);
    expect(problems).not.toMatch(/no permit number/);
  });

  it('a listing whose mandate has lapsed', () => {
    const lapsed = without({ mandateExpires: new Date('2026-08-01T00:00:00.000Z') });
    expect(problemsWith(lapsed, 'BAYUT', NOW).join(' ')).toMatch(/mandate has lapsed/);
  });

  it('a listing with fewer than two photographs', () => {
    const one = without({ media: [{ id: 'm1', storageKey: 'a.jpg', externalUrl: null }] });
    expect(problemsWith(one, 'BAYUT', NOW).join(' ')).toMatch(/at least two photographs/);
    expect(problemsWith(without({ media: [] }), 'BAYUT', NOW).join(' ')).toMatch(/no photographs/);
  });

  it('a media row with neither a stored file nor a URL, which cannot be fetched', () => {
    const unusable = without({
      media: [
        { id: 'm1', storageKey: null, externalUrl: null },
        { id: 'm2', storageKey: null, externalUrl: null },
      ],
    });
    expect(problemsWith(unusable, 'BAYUT', NOW).join(' ')).toMatch(/no photographs/);
  });

  it('a rent with no period', () => {
    const rent = without({ listingType: 'RENT', rentFrequency: null });
    // The reason matters: this is the mistake that makes a listing look twelve
    // times cheaper than it is.
    expect(problemsWith(rent, 'BAYUT', NOW).join(' ')).toMatch(/twelve times wrong/);
  });

  it('a listing that is not active, and names the state it is in', () => {
    expect(problemsWith(without({ status: 'DRAFT' }), 'WEBSITE', NOW).join(' ')).toMatch(/draft, not active/);
    expect(problemsWith(without({ status: 'UNDER_OFFER' }), 'BAYUT', NOW).join(' ')).toMatch(/under offer, not active/);
  });

  it('a listing with no price, or a nonsensical one', () => {
    expect(problemsWith(without({ price: null }), 'WEBSITE', NOW).join(' ')).toMatch(/no price/);
    expect(problemsWith(without({ price: 0 }), 'WEBSITE', NOW).join(' ')).toMatch(/no price/);
  });

  it('a description too thin to be read', () => {
    expect(problemsWith(without({ description: 'Nice flat.' }), 'BAYUT', NOW).join(' ')).toMatch(
      /description is too short/,
    );
  });
});

describe('the brokerage’s own website', () => {
  it('is lenient, because it is theirs', () => {
    const thin = without({
      permitNumber: null,
      micromarket: null,
      description: 'Short.',
      mandateExpires: new Date('2020-01-01T00:00:00.000Z'),
      media: [{ id: 'm1', storageKey: 'a.jpg', externalUrl: null }],
    });
    // One photograph and no permit is still worth showing on your own site.
    // The rules that matter there are the ones that make the page broken.
    expect(problemsWith(thin, 'WEBSITE', NOW)).toHaveLength(0);
    expect(problemsWith(thin, 'PROPERTY_FINDER', NOW).length).toBeGreaterThan(2);
  });
});

describe('the document itself', () => {
  const images = new Map([['l1', ['https://app.test/li/tok1', 'https://cdn.example.test/b.jpg']]]);

  it('carries the listing, the permit and both photographs', () => {
    const feed = renderFeed(
      [complete],
      'BAYUT',
      { name: 'Meridian', licenceNumber: '12345', phone: '+97144000000' },
      images,
      NOW,
    );

    expect(feed.included).toBe(1);
    expect(feed.xml).toContain('<reference_number>ME-0001</reference_number>');
    expect(feed.xml).toContain('<permit_number>7129834</permit_number>');
    expect(feed.xml).toContain('<licence>12345</licence>');
    expect(feed.xml).toContain('https://app.test/li/tok1');
    expect(feed.xml).toContain('https://cdn.example.test/b.jpg');
    // A sale, so no rent period — the tag is absent rather than empty.
    expect(feed.xml).not.toContain('<rent_frequency>');
  });

  it('leaves a refused listing out and says why, rather than shipping it', () => {
    const broken = without({ id: 'l2', permitNumber: null });
    const feed = renderFeed(
      [complete, broken],
      'BAYUT',
      { name: 'Meridian', licenceNumber: null, phone: null },
      images,
      NOW,
    );

    expect(feed.included).toBe(1);
    expect(feed.xml).not.toContain('l2');
    expect(feed.rejected.get('l2')).toMatch(/permit number/);
    // Nothing to say about the agency's licence, so the tag is not emitted
    // empty — a portal reading an empty licence is worse than none.
    expect(feed.xml).not.toContain('<licence>');
  });

  it('escapes what would otherwise break the document', () => {
    const nasty = without({
      title: 'Marina & "Views" <script>',
      description: "It's a 2 bed with a view of the marina and the beach beyond.",
    });
    const feed = renderFeed(
      [nasty],
      'WEBSITE',
      { name: 'A & B Realty', licenceNumber: null, phone: null },
      new Map(),
      NOW,
    );

    expect(feed.xml).toContain('Marina &amp; &quot;Views&quot; &lt;script&gt;');
    expect(feed.xml).toContain('A &amp; B Realty');
    expect(feed.xml).not.toContain('<script>');
  });

  it('is well-formed: every tag closes, in order', () => {
    const feed = renderFeed([complete], 'BAYUT', { name: 'Meridian', licenceNumber: '1', phone: '2' }, images, NOW);

    // Checked by walking the tags rather than with a parser, because adding an
    // XML dependency to the whole product for one assertion is the wrong
    // trade. This catches what actually goes wrong here — an unclosed tag, or
    // content that escaped its element.
    const stack: string[] = [];
    for (const [, closing, name] of feed.xml.matchAll(/<(\/?)([a-z_]+)(?:\s[^>]*)?(\/?)>/gi)) {
      if (closing) {
        expect(stack.pop()).toBe(name);
      } else {
        stack.push(name);
      }
    }
    expect(stack).toHaveLength(0);
    expect(feed.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});
