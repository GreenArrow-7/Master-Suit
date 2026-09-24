import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toString as qrToString } from 'qrcode';

/**
 * The entry pass on an invitee's RSVP page.
 *
 * Two things can go wrong here and neither shows up as an error:
 *
 *   1. The QR encodes the wrong thing, or encodes something the holder should
 *      not be handed. It must carry the RSVP URL — the address already in that
 *      visitor's own address bar — and nothing else.
 *   2. The pass is drawn for somebody it does not belong to. A pass shown to a
 *      guest who has not confirmed, or for a webinar with no door, is worse
 *      than no pass: it looks official and it is not.
 *
 * The encoder itself is exercised for real rather than mocked, because the only
 * interesting question about a QR library is whether it produces a scannable
 * symbol from this input, and a mock cannot answer that.
 */
const web = path.join(__dirname, '..', '..');

describe('the QR encoder produces a usable symbol', () => {
  it('renders inline SVG with a viewBox, so it scales on a phone', async () => {
    const svg = await qrToString('https://app.example.test/rsvp/t.e.st', { type: 'svg', margin: 1 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox=');
    // No width/height attributes to fight the container's box.
    expect(svg).toContain('<path');
  });

  it('a longer value produces a denser symbol rather than failing', async () => {
    const short = await qrToString('https://a.test/rsvp/x', { type: 'svg', margin: 1 });
    const long = await qrToString(`https://a.test/rsvp/${'c'.repeat(200)}`, { type: 'svg', margin: 1 });
    const sizeOf = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
    expect(sizeOf(long)).toBeGreaterThan(sizeOf(short));
  });

  /** Dark-on-dark is the one rendering that no scanner can read. */
  it('is drawn dark on a light field', async () => {
    const svg = await qrToString('https://a.test/rsvp/x', {
      type: 'svg',
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
    expect(svg).toContain('#ffffff');
    expect(svg).toContain('#000000');
  });
});

describe('the pass is only drawn when it means something', () => {
  const page = readFileSync(path.join(web, 'src', 'app', 'rsvp', '[token]', 'page.tsx'), 'utf8');

  it('requires a confirmed RSVP and a physical event', () => {
    const gate = /const showPass =([^;]+);/.exec(page);
    expect(gate, 'showPass gate not found').not.toBeNull();
    expect(gate![1]).toContain("rsvpStatus === 'CONFIRMED'");
    expect(gate![1]).toContain("eventType === 'PHYSICAL'");
    // Both, not either: a confirmed webinar guest has no door to show it at.
    expect(gate![1]).toContain('&&');
  });

  it('renders the QR only behind that gate', () => {
    expect(page).toMatch(/\{showPass && \(/);
    const qrAt = page.indexOf('<QrCode');
    const gateAt = page.indexOf('{showPass && (');
    expect(qrAt).toBeGreaterThan(gateAt);
  });

  /**
   * It encodes the RSVP URL built from the invitation's own ids. Encoding
   * anything else — a raw invitee id, a tenant id, an internal path — would
   * either not work at the door or hand the holder something they were not
   * given.
   */
  it('encodes the invitee’s own RSVP URL', () => {
    expect(page).toContain('rsvpUrl(invitation.tenantId, invitation.inviteeId)');
  });

  it('gives the code a text alternative', () => {
    // A QR with no label is a blank box to a screen reader.
    expect(page).toMatch(/<QrCode[^>]*label=/s);
  });
});

describe('the component keeps the code readable', () => {
  const component = readFileSync(path.join(web, 'src', 'components', 'ui', 'QrCode.tsx'), 'utf8');

  it('renders on the server, shipping no encoder to the browser', () => {
    expect(component).not.toContain("'use client'");
  });

  /**
   * The white field is set on the wrapper rather than inherited. A themed
   * surface rendering the symbol on dark is unscannable, and dark mode is
   * exactly where that would happen.
   */
  it('pins a light background instead of inheriting the surface', () => {
    expect(component).toContain("background: '#ffffff'");
  });
});

/**
 * The invitation has to be answerable, or the pass is the only thing that works.
 *
 * `ANSWERABLE` read `['SCHEDULED', 'LIVE']` against `EventStatus`, which is
 * `DRAFT | PUBLISHED | CANCELLED | COMPLETED`. Both borrowed values belong to
 * Call status, so the comparison never matched, `answerable` was false for every
 * invitation ever issued, and the public page told every recipient the
 * invitation was not open for replies. The public RSVP flow was dead and nothing
 * raised an error, because a string compared against the wrong vocabulary fails
 * silently.
 *
 * Read from source rather than imported: `ANSWERABLE` is module-private and
 * should stay that way. What matters is that every value in it is a real
 * `EventStatus`, which is the property that failed.
 */
describe('invitations are answerable in states that exist', () => {
  const rsvp = readFileSync(path.join(web, 'src', 'lib', 'events', 'rsvp.ts'), 'utf8');
  const schema = readFileSync(path.join(web, 'prisma', 'schema.prisma'), 'utf8');

  const eventStatuses = (() => {
    const block = /enum EventStatus \{([^}]*)\}/.exec(schema);
    return block![1]!
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
  })();

  it('finds a non-trivial enum to check against', () => {
    expect(eventStatuses).toContain('PUBLISHED');
    expect(eventStatuses).toContain('DRAFT');
  });

  it('every answerable state is a real EventStatus', () => {
    const declared = /const ANSWERABLE:[^=]*=\s*\[([^\]]*)\]/.exec(rsvp);
    expect(declared, 'ANSWERABLE not found').not.toBeNull();
    const values = [...declared![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);

    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(eventStatuses, `${value} is not an EventStatus`).toContain(value);
    }
    // The two Call-status values that broke it.
    expect(values).not.toContain('SCHEDULED');
    expect(values).not.toContain('LIVE');
  });

  /** Typed, so the next wrong value is a compile error rather than dead code. */
  it('is typed against the enum rather than string[]', () => {
    expect(rsvp).toMatch(/const ANSWERABLE: EventStatus\[\]/);
  });

  it('does not let a finished or cancelled event be answered', () => {
    const declared = /const ANSWERABLE:[^=]*=\s*\[([^\]]*)\]/.exec(rsvp);
    const values = [...declared![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    for (const over of ['CANCELLED', 'COMPLETED', 'DRAFT']) {
      expect(values).not.toContain(over);
    }
  });
});
