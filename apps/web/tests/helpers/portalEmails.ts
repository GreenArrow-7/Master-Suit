/**
 * Portal notification emails as a mail service forwards them to a "Portal
 * emails" lead source (audit row M6-12): the provider-neutral JSON `from`,
 * `to`, `subject`, `text`, `html`, `messageId`.
 *
 * Synthetic: the layouts follow the lead emails Property Finder, Bayut and
 * dubizzle send an agency (labelled lines, or an HTML table), but every name,
 * number, address and reference here is invented. Numbers are in the +971 50
 * 000 range, addresses at example.com.
 */
export interface InboundMail {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  messageId: string;
}

const TO = 'leads@agency-inbox.example.com';

/** Plain text, the client's message on the lines after its label. */
export const PROPERTY_FINDER: InboundMail = {
  from: 'Property Finder <leads@propertyfinder.ae>',
  to: TO,
  subject: 'New email lead on Property Finder: 2 bedroom apartment in Marina Gate 1 (Ref: PF-MG-20451)',
  messageId: '<pf-20451.1760342400@mail.propertyfinder.ae>',
  text: [
    'Dear Agent,',
    '',
    'You have received a new email lead through Property Finder.',
    '',
    'Lead details',
    'Name: Aisha Rahman',
    'Email: Aisha.Rahman@example.com',
    'Phone: +971 50 000 1201',
    '',
    'Property: 2 bedroom apartment for sale in Marina Gate 1, Dubai Marina',
    'Reference: PF-MG-20451',
    '',
    'Message:',
    'Hello, is this apartment still available?',
    'I would like to arrange a viewing this weekend.',
    '',
    'Reply to this lead from your Property Finder Expert dashboard.',
    '',
    'Property Finder FZ LLC, Dubai, United Arab Emirates',
  ].join('\n'),
};

/** Spaced colons, "Client …" labels, and a footer that names dubizzle: the sender is still Bayut. */
export const BAYUT: InboundMail = {
  from: 'Bayut <no-reply@bayut.com>',
  to: TO,
  subject: 'Bayut | New enquiry on your listing BY-88213',
  messageId: '<by-88213.1760343000@notifications.bayut.com>',
  text: [
    'Hi Agent,',
    '',
    'Great news! A user is interested in your property listed on Bayut.',
    '',
    'Client Name : Omar Haddad',
    'Client Phone : 055 000 3302',
    'Client Email : omar.haddad@example.com',
    'Reference No : BY-88213',
    'Property Title : Spacious 4BR Villa | Arabian Ranches 2',
    "Message : Is the villa still available? I'd like to arrange a viewing.",
    '',
    'Please respond to the client as soon as possible.',
    '',
    'Bayut.com is part of dubizzle Group.',
  ].join('\n'),
};

/** HTML only, a table of label and value cells, with entities. */
export const DUBIZZLE: InboundMail = {
  from: 'dubizzle <noreply@dubizzle.com>',
  to: TO,
  subject: 'Someone is interested in your ad: 1 Bed | Lake View | JLT Cluster D',
  messageId: '<dz-7764123.1760343600@mailer.dubizzle.com>',
  html: [
    '<html><head><style>td { font-family: Arial; color: #333; }</style></head><body>',
    '<p>Hi there,</p><p>You have a new reply to your ad on dubizzle.</p>',
    '<table cellpadding="4">',
    '<tr><td style="color:#666">Name:</td><td><b>Priya Nair</b></td></tr>',
    '<tr><td style="color:#666">Mobile:</td><td>+971&nbsp;52&nbsp;000&nbsp;4403</td></tr>',
    '<tr><td style="color:#666">Email:</td><td>priya.nair&#64;example.com</td></tr>',
    '<tr><td style="color:#666">Ad ID:</td><td>DZ-7764123</td></tr>',
    '<tr><td style="color:#666">Message:</td><td>Hi, is this still available to rent from November? Thanks &amp; regards</td></tr>',
    '</table>',
    '<p>Reply quickly to improve your chances.<br>The dubizzle team</p>',
    '</body></html>',
  ].join(''),
};

/** From nobody the parser knows, with labelled lines all the same: kept, never a lead. */
export const NOT_A_PORTAL: InboundMail = {
  from: 'Market Digest <news@realestate-digest.example.com>',
  to: TO,
  subject: 'Your weekly market report',
  messageId: '<digest-2041@realestate-digest.example.com>',
  text: ['Weekly report', 'Name: Dubai Marina', 'Phone: 04 000 0000', 'Email: news@realestate-digest.example.com'].join(
    '\n',
  ),
};

/**
 * A Property Finder lead email an agent forwarded by hand: their own note and
 * signature (two numbers of theirs) above the quoted original. Each call is a
 * different client under the same signature.
 */
export const forwardedByAgent = (client: { name: string; phone: string; email: string; ref: string }): InboundMail => ({
  from: 'Sara Khan <sara.khan@agency-inbox.example.com>',
  to: TO,
  subject: `Fwd: New email lead on Property Finder (Ref: ${client.ref})`,
  messageId: `<fwd-${client.ref}@agency-inbox.example.com>`,
  text: [
    'Please call this one today.',
    '',
    'Sara Khan | Senior Consultant',
    'Mobile: +971 55 000 9901',
    'Tel: +971 4 000 9900',
    '',
    '---------- Forwarded message ---------',
    'From: Property Finder <leads@propertyfinder.ae>',
    'Date: Sun, 12 Oct 2026 at 10:15',
    `Subject: New email lead on Property Finder (Ref: ${client.ref})`,
    'To: <sara.khan@agency-inbox.example.com>',
    '',
    'Lead details',
    `Name: ${client.name}`,
    `Email: ${client.email}`,
    `Phone: ${client.phone}`,
    '',
    `Reference: ${client.ref}`,
    'Message: Is it still available?',
  ].join('\n'),
});

/** The listing's agent named above the client, under the same bare labels, and the portal's own number below. */
export const BAYUT_AGENT_FIRST: InboundMail = {
  from: 'Bayut <no-reply@bayut.com>',
  to: TO,
  subject: 'Bayut | New enquiry on your listing BY-90410',
  messageId: '<by-90410.1760344000@notifications.bayut.com>',
  text: [
    'Hi Agent,',
    '',
    'Listing agent: Sara Khan',
    'Phone: +971 4 000 9900',
    'Email: sara.khan@agency-inbox.example.com',
    '',
    'Name: Layla Ahmed',
    'Phone: 055 000 3320',
    'Email: layla.ahmed@example.com',
    'Reference: BY-90410',
    'Message: Can I see it on Friday?',
    '',
    'Bayut support',
    'WhatsApp: 800 000 0000',
  ].join('\n'),
};

/** HTML only, as a template engine prints it: indented, one tag per line. */
export const DUBIZZLE_PRETTY: InboundMail = {
  from: 'dubizzle <noreply@dubizzle.com>',
  to: TO,
  subject: 'Someone is interested in your ad: Studio | Sports City',
  messageId: '<dz-7764200.1760344200@mailer.dubizzle.com>',
  html: `<html>
  <body>
    <p>
      You have a new reply to your ad on dubizzle.
    </p>
    <table>
      <tr>
        <td>Name:</td>
        <td>Karim Nasser</td>
      </tr>
      <tr>
        <td>Mobile:</td>
        <td>+971 52 000 4410</td>
      </tr>
      <tr>
        <td>Email:</td>
        <td>karim.nasser@example.com</td>
      </tr>
    </table>
  </body>
</html>`,
};

/** A text part that only points at the HTML one, where the lead is. */
export const PF_STUB_TEXT: InboundMail = {
  from: 'Property Finder <leads@propertyfinder.ae>',
  to: TO,
  subject: 'New email lead on Property Finder (Ref: PF-DH-40020)',
  messageId: '<pf-40020.1760344400@mail.propertyfinder.ae>',
  text: 'Your email client cannot display this message. Please view it in HTML.',
  html: '<table><tr><td>Name</td><td>Noura Salem</td></tr><tr><td>Phone</td><td>+971 50 000 1240</td></tr></table>',
};

/** Names Bayut in its body only, with a phone and an address all the same: nobody's lead. */
export const MENTIONS_A_PORTAL: InboundMail = {
  from: 'Market Digest <news@realestate-digest.example.com>',
  to: TO,
  subject: 'This week in Dubai property',
  messageId: '<digest-2042@realestate-digest.example.com>',
  text: [
    'Listings on Bayut rose 4% this week.',
    'Phone: 04 000 0001',
    'Email: news@realestate-digest.example.com',
  ].join('\n'),
};

/** A Property Finder email that is not an enquiry: nobody to contact, so kept unread too. */
export const PORTAL_NOTICE: InboundMail = {
  from: 'Property Finder <no-reply@propertyfinder.ae>',
  to: TO,
  subject: 'Your listing PF-MG-20451 has been approved',
  messageId: '<pf-approved-20451@mail.propertyfinder.ae>',
  text: ['Dear Agent,', '', 'Your listing is now live.', 'Reference: PF-MG-20451', 'Status: Published'].join('\n'),
};
