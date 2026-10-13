import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Lead sources that post enquiries to `/api/v1/webhooks/leads/{webhookKey}`:
 * the property portals and Google Ads lead forms. Ported from the standalone
 * Lead Eagle's intake adapters.
 *
 * The portals deliver to approved partners only, so their exact payloads arrive
 * with the partner agreement. Until then the parser reads the field names those
 * portals and Lead Eagle's adapters use, at any depth and in either case style,
 * and keeps whatever else was sent on the stored event for a replay.
 */
export const LEAD_SOURCES = {
  property_finder: { label: 'Property Finder', source: 'MARKETPLACE' },
  bayut: { label: 'Bayut', source: 'MARKETPLACE' },
  dubizzle: { label: 'Dubizzle', source: 'MARKETPLACE' },
  google_ads: { label: 'Google Ads lead forms', source: 'AD_LEAD_FORM' },
  // Any sender without an adapter of its own: a website, a CRM, Zapier (M6-08).
  custom_webhook: { label: 'Custom webhook', source: 'WEBHOOK' },
  // The portals' lead emails, posted by the workspace's mail service (M6-12). A
  // lead takes its portal's source and entry (`parsePortalEmail`), never this one.
  inbound_email: { label: 'Portal emails', source: 'EMAIL_PARSER' },
} as const;

export type LeadSourceKey = keyof typeof LEAD_SOURCES;

export const isLeadSource = (provider: string): provider is LeadSourceKey => Object.hasOwn(LEAD_SOURCES, provider);

/**
 * The portals sign the exact bytes with HMAC-SHA256 and the shared secret, in
 * hex, optionally prefixed `sha256=`. Google cannot sign: it puts the key the
 * advertiser typed into Google Ads in the body as `google_key`.
 */
export function verifyDelivery(
  provider: LeadSourceKey,
  secret: string | undefined,
  raw: string,
  payload: Record<string, unknown>,
  signature: string | null,
): boolean {
  if (!secret) return false;
  if (provider === 'google_ads') return same(Buffer.from(String(payload.google_key ?? '')), Buffer.from(secret));
  const given = Buffer.from((signature ?? '').trim().replace(/^sha256=/i, ''), 'hex');
  return same(given, createHmac('sha256', secret).update(raw, 'utf8').digest());
}

/** Length first: timingSafeEqual throws on a mismatch, and the throw is itself a timing signal. */
const same = (a: Buffer, b: Buffer) => a.length > 0 && a.length === b.length && timingSafeEqual(a, b);

/** What an enquiry says, whichever source sent it. */
export interface Enquiry {
  /** The sender's own id for the lead, when it names one. */
  externalId: string | null;
  fullName: string | null;
  email: string | null;
  phones: string[];
  message: string | null;
  /** The listing or ad it came from, for `sourceDetail`. */
  reference: string | null;
  /** What the form asked — purpose, type, area, budget — as the sender worded it. */
  details: string[];
  /** Google's "Send test data" button. Accepted, never a lead. */
  isTest: boolean;
}

/** `lead_id`, `leadId` and `Lead-ID` are one key here. */
const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Sub-objects about somebody or something other than the enquirer. Their
 * contact fields are read only under their prefix (`agentname`, `agentphone`),
 * never as the bare `name` or `phone`: an agent's number taken for the client's
 * would attach every enquiry that agent handles to one lead.
 */
const CONTACT = /name|phone|mobile|email|whatsapp|contactnumber/;
const NOT_THE_CLIENT = new Set([
  'agent',
  'agents',
  'broker',
  'user',
  'assignee',
  'assignedto',
  'owner',
  'listing',
  'property',
  'project',
  'company',
  'advertiser',
  'account',
]);

/**
 * Every scalar in the payload by its key, outer values first, so an envelope's
 * `{ data: { client: { name } } }` and a flat `{ name }` read the same. A
 * nested value is also kept under its parent's prefix (`clientname`). Google's
 * `user_column_data` rows become keys named by their `column_id`.
 */
function flatten(value: unknown, into = new Map<string, string>(), depth = 0, parent = '', generic = true) {
  if (depth > 4 || !value || typeof value !== 'object') return into;
  const put = (k: string, v: unknown) => {
    const text = v == null ? '' : String(v).trim();
    const bare = key(k);
    for (const name of [(generic || !CONTACT.test(bare)) && bare, parent && parent + bare]) {
      if (text && name && !into.has(name)) into.set(name, text);
    }
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      const row = item as { column_id?: unknown; string_value?: unknown };
      if (typeof row?.column_id === 'string') put(row.column_id, row.string_value);
      else flatten(item, into, depth + 1, parent, generic);
    }
    return into;
  }
  const nested: [string, unknown][] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v && typeof v === 'object') nested.push([key(k), v]);
    else put(k, v);
  }
  for (const [k, v] of nested) flatten(v, into, depth + 1, k, generic && !NOT_THE_CLIENT.has(k));
  return into;
}

const DETAILS: [label: string, keys: string[]][] = [
  ['Purpose', ['purpose', 'offeringtype', 'listingtype', 'transactiontype', 'realtorhelpgoal']],
  ['Type', ['propertytype', 'category', 'subcategory']],
  [
    'Area',
    ['location', 'locationname', 'community', 'propertycommunity', 'neighbourhood', 'preferredlocation', 'city'],
  ],
  ['Bedrooms', ['bedrooms', 'numberofbedrooms']],
  ['Budget', ['budget', 'pricerange', 'price', 'budgetmax', 'pricemax']],
];

/**
 * The lead fields an administrator may map a sender's field to (M6-20), each
 * with the parser key it is read as. A mapped field is read from the sender's
 * field alone: each key is the first one its field reads, and a mapped name
 * (full, or first and last) or phone also sets aside every other guess.
 */
export const MAPPABLE_FIELDS = {
  fullName: { label: 'Full name', key: 'clientname' },
  firstName: { label: 'First name', key: 'firstname' },
  lastName: { label: 'Last name', key: 'lastname' },
  phone: { label: 'Phone', key: 'clientphone' },
  email: { label: 'Email', key: 'clientemail' },
  message: { label: 'Message', key: 'message' },
  reference: { label: 'Reference (source detail)', key: 'listingreference' },
  purpose: { label: 'Purpose', key: 'purpose' },
  propertyType: { label: 'Property type', key: 'propertytype' },
  area: { label: 'Area', key: 'location' },
  bedrooms: { label: 'Bedrooms', key: 'bedrooms' },
  budget: { label: 'Budget', key: 'budget' },
} as const;

export type MappableField = keyof typeof MAPPABLE_FIELDS;
/**
 * `{ senderKey: leadField }`. A nested sender field is `parent.field`; a deeper
 * one is read by its last two names (`data.client.phone` as `client.phone`),
 * the way the payload is flattened.
 */
export type FieldMap = Record<string, MappableField>;

/** The map stored in a connection's settings, or none. */
export const fieldMapOf = (metadata: unknown): FieldMap =>
  ((metadata as { fieldMap?: FieldMap } | null)?.fieldMap ?? {}) as FieldMap;

export function parseEnquiry(payload: Record<string, unknown>, fieldMap: FieldMap = {}): Enquiry {
  const flat = flatten(payload);
  // Applied before anything is read. `parent.field` is the flattened `parentfield`.
  const mapped = new Set<MappableField>();
  for (const [sender, field] of Object.entries(fieldMap)) {
    const value = flat.get(key(sender.split('.').slice(-2).join('')));
    if (value && Object.hasOwn(MAPPABLE_FIELDS, field)) {
      flat.set(MAPPABLE_FIELDS[field].key, value);
      mapped.add(field);
    }
  }
  const get = (...keys: string[]) => keys.map((k) => flat.get(k)).find(Boolean) ?? null;

  const first = get('firstname');
  const last = get('lastname');
  // A mapped first or last name is the client's, over a guessed `name` (the form's, the campaign's).
  const byParts = !mapped.has('fullName') && (mapped.has('firstName') || mapped.has('lastName'));
  const guessedPhones = [
    'clientphone',
    'clientmobile',
    'contactphone',
    'contactmobile',
    'customerphone',
    'customermobile',
    'phone',
    'mobile',
    'phonenumber',
    'contactnumber',
    'whatsapp',
    'workphone',
  ]
    .map((k) => flat.get(k))
    .filter((p): p is string => !!p);
  // A mapped number is the client's; any other the body carries is not (an office, an agent).
  const phones = mapped.has('phone') ? [flat.get(MAPPABLE_FIELDS.phone.key)!] : guessedPhones;

  return {
    // Only keys that name the lead itself. A bare `id` or `reference` may be the
    // listing's once the envelope is flattened, and two enquiries about one
    // listing sharing an id would drop the second as a retry.
    externalId: get('leadid', 'leaduuid'),
    fullName:
      (byParts ? null : get('clientname', 'contactname', 'customername', 'fullname', 'name')) ??
      ([first, last].filter(Boolean).join(' ') || null),
    email:
      get('clientemail', 'contactemail', 'customeremail', 'email', 'emailaddress', 'workemail')?.toLowerCase() ?? null,
    phones: [...new Set(phones)],
    message: get('message', 'comments', 'comment', 'enquiry', 'inquiry', 'notes'),
    // `source_detail` is the Custom webhook's documented name for it.
    reference: get('listingreference', 'propertyreference', 'referencenumber', 'listingid', 'formid', 'sourcedetail'),
    details: DETAILS.flatMap(([label, keys]) => {
      const v = get(...keys);
      return v ? [`${label}: ${v}`] : [];
    }),
    isTest: flat.get('istest') === 'true',
  };
}

/**
 * The portals whose lead emails a Portal emails source reads (M6-12), each as it
 * names itself in a sender's address, a subject or a body.
 */
const PORTAL_MAIL: [LeadSourceKey, RegExp][] = [
  ['property_finder', /property ?finder/i],
  ['bayut', /bayut/i],
  ['dubizzle', /dubizzle/i],
];

/** The portal a text names first, if any. */
const portalNamedIn = (text: string) =>
  PORTAL_MAIL.map(([kind, name]) => [kind, text.search(name)] as const)
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])[0]?.[0];

/** Email labels the parser's keys word differently, by `key()`. */
const MAIL_LABELS: Record<string, string> = {
  reference: 'listingreference',
  ref: 'listingreference',
  refno: 'listingreference',
  referenceno: 'listingreference',
  listingref: 'listingreference',
  propertyref: 'listingreference',
  propertyid: 'listingreference',
  adid: 'listingreference',
  adref: 'listingreference',
  telephone: 'phone',
  tel: 'phone',
  phoneno: 'phone',
  mobileno: 'phone',
  mobilenumber: 'mobile',
  leadname: 'clientname',
};

/** `Label: value`, or a table row's `Label` cell then its value; the label starts with a letter. */
const LINE = /^[\s>*•-]*(\p{L}[\p{L}\d .#/&()'’-]{0,40}?)\s*(?:[:：]|\t)\s*(.*?)\s*$/u;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The body as lines: the text part, else the HTML with its cells split by a tab and its rows by a line. */
function mailText(text: unknown, html: unknown): string {
  if (typeof text === 'string' && text.trim()) return text;
  if (typeof html !== 'string') return '';
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/**
 * Every `Label: value` line, first of each label kept. A label whose value is
 * on the lines after it (a message) reads them up to a blank line or the next
 * label.
 */
function labelled(body: string): Record<string, string> {
  const lines = body.split(/\r?\n/);
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const match = LINE.exec(lines[i]!);
    if (!match) continue;
    let value = match[2]!.replace(/\s+/g, ' ').trim();
    if (!value) {
      const rest: string[] = [];
      while (i + 1 < lines.length && !lines[i + 1]!.trim()) i++;
      while (i + 1 < lines.length && lines[i + 1]!.trim() && !LINE.test(lines[i + 1]!)) rest.push(lines[++i]!.trim());
      value = rest.join(' ');
    }
    const label = match[1]!.trim();
    if (!value) continue;
    if (!Object.hasOwn(out, label)) out[label] = value;
    const alias = MAIL_LABELS[key(label)];
    if (alias && !Object.hasOwn(out, alias)) out[alias] = value;
  }
  return out;
}

/** An email's own id, which a second copy of it repeats: the receiver's idempotency key. */
export const emailIdOf = (payload: Record<string, unknown>) =>
  typeof payload.messageId === 'string' ? payload.messageId.trim().slice(0, 200) || null : null;

/**
 * A portal's lead email, as the workspace's mail service posts it:
 * `{ from, to, subject, text, html, messageId }` (M6-12). Ported from the
 * standalone Lead Eagle's EMAIL_PARSER, which reads the `Label: value` lines a
 * portal's notification carries; here those lines go through `parseEnquiry`,
 * so the source's field map names a label the parser does not know.
 *
 * The portal is the first one named by the sender, else the subject, else the
 * body (the earliest mention: a forwarded email quotes its sender at the top,
 * and Bayut's footer names dubizzle). Null for an email no portal sent, or one
 * that gives no number or address to reach anybody at: the delivery is kept
 * unread rather than guessed into a lead.
 */
export function parsePortalEmail(payload: Record<string, unknown>, fieldMap: FieldMap = {}) {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const body = mailText(payload.text, payload.html);
  const subject = text(payload.subject);
  const portal = [text(payload.from), subject, body].map(portalNamedIn).find(Boolean);
  if (!portal) return null;
  const enquiry = parseEnquiry(labelled(body), fieldMap);
  if (!enquiry.phones.length && !enquiry.email) return null;
  // `Ref: PF-1`, `Reference no. 88`; not the "ref" of "refurbished".
  const subjectRef = /\bref(?:erence)?\b(?:\s*(?:no|number)\b)?\.?\s*[:#]?\s*([a-z0-9][\w/-]{2,})/i.exec(subject)?.[1];
  return {
    portal,
    enquiry: {
      ...enquiry,
      externalId: emailIdOf(payload),
      reference: enquiry.reference ?? subjectRef ?? null,
      isTest: false,
    },
  };
}
