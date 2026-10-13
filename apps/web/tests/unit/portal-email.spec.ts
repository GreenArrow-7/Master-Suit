import { describe, expect, it } from 'vitest';
import { parsePortalEmail } from '@/lib/integrations/leadSources';
import {
  BAYUT,
  BAYUT_AGENT_FIRST,
  DUBIZZLE_PRETTY,
  forwardedByAgent,
  MENTIONS_A_PORTAL,
  PF_STUB_TEXT,
  type InboundMail,
} from '../helpers/portalEmails';

/**
 * The portal-email parser (audit row M6-12) on the layouts that are not a
 * portal's own clean notification: a forwarded email, an agent named above the
 * client, a pretty-printed or stub-text HTML email, a mention that is not the
 * sender, and a body built to make it slow.
 */
const parse = (mail: InboundMail | Record<string, unknown>) =>
  parsePortalEmail(mail as unknown as Record<string, unknown>);

describe('parsePortalEmail', () => {
  it('reads the client from a forwarded email, not the forwarder’s signature above it', () => {
    const parsed = parse(
      forwardedByAgent({ name: 'Hamad Saeed', phone: '+971 50 000 1230', email: 'hamad@example.com', ref: 'PF-JV-1' }),
    );
    expect(parsed?.portal).toBe('property_finder');
    expect(parsed?.enquiry).toMatchObject({
      fullName: 'Hamad Saeed',
      email: 'hamad@example.com',
      phones: ['+971 50 000 1230'],
      reference: 'PF-JV-1',
    });
  });

  it('knows a forwarded email’s portal by the sender it quotes', () => {
    const mail = forwardedByAgent({ name: 'Rania Aziz', phone: '050 000 1231', email: 'rania@example.com', ref: 'X' });
    const parsed = parse({ ...mail, subject: 'Fwd: have a look' });
    expect(parsed?.portal).toBe('property_finder');
  });

  it('skips the listing agent named above the client, and keeps one number', () => {
    const parsed = parse(BAYUT_AGENT_FIRST);
    expect(parsed?.enquiry).toMatchObject({
      fullName: 'Layla Ahmed',
      email: 'layla.ahmed@example.com',
      phones: ['055 000 3320'],
      reference: 'BY-90410',
    });
  });

  it('keeps a client label’s number over a bare one, and only that one', () => {
    const parsed = parse({ ...BAYUT, text: `Phone: 04 000 9900\n${BAYUT.text}` });
    expect(parsed?.enquiry.phones).toEqual(['055 000 3302']);
  });

  it('reads a pretty-printed HTML table, name and all', () => {
    expect(parse(DUBIZZLE_PRETTY)?.enquiry).toMatchObject({
      fullName: 'Karim Nasser',
      email: 'karim.nasser@example.com',
      phones: ['+971 52 000 4410'],
    });
  });

  it('reads the HTML when the text part names nobody', () => {
    expect(parse(PF_STUB_TEXT)?.enquiry).toMatchObject({
      fullName: 'Noura Salem',
      phones: ['+971 50 000 1240'],
      reference: 'PF-DH-40020',
    });
  });

  it('takes a portal named only in the body for nobody’s lead', () => {
    expect(parse(MENTIONS_A_PORTAL)).toBeNull();
  });

  it('knows the portal by the subject when the sender is the agency’s own mailbox', () => {
    const parsed = parse({
      from: 'Leads <leads@agency-inbox.example.com>',
      subject: 'New email lead on Property Finder (Ref: PF-SU-77)',
      text: 'Name: Omar Ali\nPhone: 050 000 1250',
      messageId: '<subject-only@example.com>',
    });
    expect(parsed).toMatchObject({ portal: 'property_finder', enquiry: { reference: 'PF-SU-77' } });
  });

  it('reads a 256 KB body built to be slow in well under a second', () => {
    const big = 256 * 1024;
    const mails: Record<string, string>[] = [
      { text: `Message: a${' '.repeat(big)}b` },
      { text: `Name${' '.repeat(big)}x` },
      { text: 'From: x\nSent: y\n'.repeat(big / 16) },
      { html: '<'.repeat(big) },
      { html: '<style'.repeat(big / 6) },
      { html: `<br${' '.repeat(big)}x` },
      { text: 'x', html: `<td>Name</td>${'<td>'.repeat(big / 4)}` },
      { text: 'Phone: 050 000 1260', subject: `Ref${' '.repeat(big)}!` },
    ];
    for (const mail of mails) {
      const started = performance.now();
      parse({ from: 'Bayut <no-reply@bayut.com>', subject: 'Bayut | New enquiry', messageId: 'x', ...mail });
      expect(performance.now() - started).toBeLessThan(1000);
    }
  }, 300_000);
});
