import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PropertyType } from '@prisma/client';

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
  /** The same, as a requirement on the lead (M6-29); null when it states nothing it wants. */
  requirement: RequirementDraft | null;
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

const DETAILS: [label: string, field: keyof Wants, keys: string[]][] = [
  ['Purpose', 'purpose', ['purpose', 'offeringtype', 'listingtype', 'transactiontype', 'realtorhelpgoal']],
  ['Type', 'type', ['propertytype', 'category', 'subcategory']],
  [
    'Area',
    'area',
    ['location', 'locationname', 'community', 'propertycommunity', 'neighbourhood', 'preferredlocation', 'city'],
  ],
  ['Bedrooms', 'bedrooms', ['bedrooms', 'numberofbedrooms']],
  ['Budget', 'budget', ['budget', 'pricerange', 'price', 'budgetmax', 'pricemax']],
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

/** What an enquiry said it wants, as the sender worded it. */
export type Wants = Partial<Record<'purpose' | 'type' | 'area' | 'bedrooms' | 'budget', string | null>>;

/** A ClientRequirement's searchable half, from an enquiry. */
export interface RequirementDraft {
  purpose: 'BUY' | 'RENT';
  propertyTypes: PropertyType[];
  subType: string | null;
  locations: string[];
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
}

const TYPES: [RegExp, PropertyType][] = [
  [/apartment|flat/, 'APARTMENT'],
  [/villa/, 'VILLA'],
  [/town ?house/, 'TOWNHOUSE'],
  [/penthouse/, 'PENTHOUSE'],
  [/plot|land/, 'PLOT'],
  [/office/, 'OFFICE'],
  [/retail|shop/, 'RETAIL'],
  [/warehouse/, 'WAREHOUSE'],
];
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6 };

/**
 * "AED 3,500,000", "60k - 80k", "1.5M": every amount in it, in order. One above
 * the composer's ceiling (1e12) is not a budget and is left out: the budget
 * columns overflow near 1e16, and a failed insert would lose the whole enquiry.
 */
const amounts = (text: string) =>
  [...text.toLowerCase().matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|mn|k|m)?\b/g)]
    .map(([, n, unit]) => Math.round(Number(n!.replace(/,/g, '')) * (unit ? SCALE[unit]! : 1)))
    .filter((amount) => amount <= 1e12);

/**
 * An enquiry's wants as a requirement (M6-29), or null when it states none or
 * is an owner wanting to sell. Purpose "Rent", "Lease" or Property Finder's
 * RR/CR is renting; anything else, or none, is buying. A type the catalogue has
 * no word for (Duplex, Hotel Apartment) is kept as the sub-type. One amount is
 * the ceiling; two are the band. "Studio" is no bedrooms, "3+" three or more.
 */
export function requirementFrom(wants: Wants): RequirementDraft | null {
  const purposeText = wants.purpose?.trim().toLowerCase() ?? '';
  if (/\bsell/.test(purposeText)) return null;
  const purpose = /^(r|c)r$|rent|lease/.test(purposeText) ? 'RENT' : 'BUY';

  const typeText = wants.type?.trim() ?? '';
  const propertyTypes = TYPES.filter(([word]) => word.test(typeText.toLowerCase())).map(([, type]) => type);
  const plain =
    propertyTypes.length === 1 && typeText.toLowerCase().replace(/[^a-z]/g, '') === propertyTypes[0]!.toLowerCase();
  const subType = typeText && !plain && !/^(residential|commercial)$/i.test(typeText) ? typeText.slice(0, 80) : null;

  const locations = (wants.area ?? '')
    .split(/[,;|]/)
    .map((place) => place.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);

  const bedText = wants.bedrooms?.trim().toLowerCase() ?? '';
  const beds = (bedText.match(/\d+/g) ?? []).map(Number).filter((n) => n <= 50);
  const [bedroomsMin, bedroomsMax] = /studio/.test(bedText)
    ? [0, 0]
    : beds.length >= 2
      ? [Math.min(beds[0]!, beds[1]!), Math.max(beds[0]!, beds[1]!)]
      : beds.length === 1
        ? [beds[0]!, /\+|more|min/.test(bedText) ? null : beds[0]!]
        : [null, null];

  const money = amounts(wants.budget ?? '');
  const [budgetMin, budgetMax] =
    money.length >= 2 ? [Math.min(money[0]!, money[1]!), Math.max(money[0]!, money[1]!)] : [null, money[0] ?? null];

  const wanted = propertyTypes.length || subType || locations.length || bedroomsMin != null || budgetMax != null;
  return wanted ? { purpose, propertyTypes, subType, locations, bedroomsMin, bedroomsMax, budgetMin, budgetMax } : null;
}

/** The client's number, by the keys a sender may give it under, the likeliest first. */
const PHONE_KEYS = [
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
];

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
  const wants: Wants = Object.fromEntries(DETAILS.map(([, field, keys]) => [field, get(...keys)]));

  const first = get('firstname');
  const last = get('lastname');
  // A mapped first or last name is the client's, over a guessed `name` (the form's, the campaign's).
  const byParts = !mapped.has('fullName') && (mapped.has('firstName') || mapped.has('lastName'));
  const guessedPhones = PHONE_KEYS.map((k) => flat.get(k)).filter((p): p is string => !!p);
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
    details: DETAILS.flatMap(([label, field]) => (wants[field] ? [`${label}: ${wants[field]}`] : [])),
    requirement: requirementFrom(wants),
    isTest: flat.get('istest') === 'true',
  };
}

/**
 * The portals whose lead emails a Portal emails source reads (M6-12), each as it
 * names itself in a sender or a subject.
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

/**
 * `Label: value`, or a table row's `Label` cell then its value; the label starts
 * with a letter. The value is trimmed after, not by the pattern: a lazy value
 * before `\s*$` is quadratic on a long run of spaces.
 */
const LINE = /^[\s>*•-]*(\p{L}[\p{L}\d .#/&()'’-]{0,40}?)\s*(?:[:：]|\t)(.*)$/u;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Somebody the email names besides the client: a label or heading about them opens a block of theirs. */
const PARTY = /^(?:(?:listing|your|the) )?(?:agents?|broker|agency|owner|landlord|advertiser)\b/i;
/** A label or heading about the client, which closes such a block. */
const CLIENT = /^(?:client|contact|customer|lead|enquirer|enquiry|buyer|tenant|user|sender)\b/i;

/**
 * The HTML part as lines: its cells split by a tab, its rows by a line. The
 * source's own line breaks and indents go first, as a browser drops them: kept,
 * a pretty-printed `<td>Priya Nair</td>` reads as a label of its own.
 */
function htmlText(html: string): string {
  return withoutBlocks(html)
    .replace(/\s+/g, ' ')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d|table)\s*>/gi, '\n')
    .replace(/<[^<>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/** `<style>`, `<script>` and `<head>` with what is in them, in one pass: a lazy regex is quadratic on unclosed ones. */
function withoutBlocks(html: string): string {
  const lower = html.toLowerCase();
  const open = /<(style|script|head)\b/gi;
  let out = '';
  let at = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const close = lower.indexOf(`</${m[1]!.toLowerCase()}`, open.lastIndex);
    // No closing tag after this one means none after any later one either.
    if (close < 0) break;
    out += html.slice(at, m.index);
    at = lower.indexOf('>', close) + 1 || html.length;
    open.lastIndex = at;
  }
  return out + html.slice(at);
}

const HEADER = /^[>\s*]*(from|sent|date|to|cc|subject|reply-to)\s*:/i;

/**
 * A forwarded email's original: from its quoted header (a run of `From:` …
 * `Subject:` lines) on, and the sender that header names. The forwarder's note
 * and signature above it are theirs, not the client's.
 */
function original(lines: string[]): { lines: string[]; sender: string } {
  let found: { start: number; sender: string } | null = null;
  let run: { start: number; sender: string | null; subject: boolean } | null = null;
  for (let i = 0; i <= lines.length; i++) {
    const header = i < lines.length ? HEADER.exec(lines[i]!) : null;
    if (header) {
      run ??= { start: i, sender: null, subject: false };
      const name = header[1]!.toLowerCase();
      if (name === 'from') run.sender ??= lines[i]!.slice(header[0].length);
      if (name === 'subject') run.subject = true;
      continue;
    }
    if (run?.sender != null && run.subject) found = { start: run.start, sender: run.sender };
    run = null;
  }
  return found ? { lines: lines.slice(found.start), sender: found.sender } : { lines, sender: '' };
}

/**
 * Every `Label: value` line, first of each label kept. A label whose value is
 * on the lines after it (a message) reads them up to a blank line or the next
 * label. Labels in somebody else's block (an agent's) are skipped when they
 * would be read as the client's name, number or address, and of the numbers
 * only one is kept: the first under a client label, else the first in the email
 * (a footer's comes after). An agent's or an office's number read as a second
 * number of the client's would join every enquiry that carries it to one lead.
 * `keep` is the field map's labels, kept whatever they are.
 */
function labelled(lines: string[], keep: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const numbers: [label: string, value: string][] = [];
  let theirs = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      theirs = false;
      continue;
    }
    const match = LINE.exec(lines[i]!);
    // A label, or a short line on its own: a heading ("Agent details").
    const label = match ? match[1]!.trim() : line.length <= 40 ? line : '';
    if (PARTY.test(label)) theirs = true;
    else if (CLIENT.test(label)) theirs = false;
    if (!match) continue;

    let value = match[2]!.replace(/\s+/g, ' ').trim();
    if (!value) {
      const rest: string[] = [];
      while (i + 1 < lines.length && !lines[i + 1]!.trim()) i++;
      while (i + 1 < lines.length && lines[i + 1]!.trim() && !LINE.test(lines[i + 1]!)) rest.push(lines[++i]!.trim());
      value = rest.join(' ');
    }
    if (!value) continue;
    const name = key(label);
    const alias = MAIL_LABELS[name];
    if (!keep.has(name)) {
      if (theirs && CONTACT.test(alias ?? name)) continue;
      if (PHONE_KEYS.includes(alias ?? name)) {
        numbers.push([label, value]);
        continue;
      }
    }
    if (!Object.hasOwn(out, label)) out[label] = value;
    if (alias && !Object.hasOwn(out, alias)) out[alias] = value;
  }
  const [label, value] = numbers.find(([l]) => /^(client|contact|customer)/.test(key(l))) ?? numbers[0] ?? [];
  if (label && value) {
    out[label] = value;
    const alias = MAIL_LABELS[key(label)];
    if (alias) out[alias] = value;
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
 * The portal is the one the sender names, else the sender a forwarded email
 * quotes, else the subject; never the body alone (a newsletter names portals
 * too). The text part is read, else the HTML one. Null for an email no portal
 * sent, or one that gives no number or address to reach anybody at: the
 * delivery is kept unread rather than guessed into a lead.
 */
export function parsePortalEmail(payload: Record<string, unknown>, fieldMap: FieldMap = {}) {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  // An email's subject is a line; one longer is not an email's.
  const subject = text(payload.subject).slice(0, 998);
  const keep = new Set(Object.keys(fieldMap).map((sender) => key(sender.split('.').slice(-2).join(''))));
  for (const body of [text(payload.text), htmlText(text(payload.html))]) {
    const { lines, sender } = original(body.split(/\r?\n/));
    const portal = [text(payload.from), sender, subject].map(portalNamedIn).find(Boolean);
    if (!portal) continue;
    const enquiry = parseEnquiry(labelled(lines, keep), fieldMap);
    if (!enquiry.phones.length && !enquiry.email) continue;
    // `Ref: PF-1`, `Reference no. 88`; not the "ref" of "refurbished".
    const subjectRef = /\bref(?:erence)?\b(?:\s*(?:no|number)\b)?\.?[\s:#]*([a-z0-9][\w/-]{2,})/i.exec(subject)?.[1];
    return {
      portal,
      enquiry: {
        ...enquiry,
        // One number: an email names one client.
        phones: enquiry.phones.slice(0, 1),
        externalId: emailIdOf(payload),
        reference: enquiry.reference ?? subjectRef ?? null,
        isTest: false,
      },
    };
  }
  return null;
}
