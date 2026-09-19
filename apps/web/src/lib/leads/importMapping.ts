import { normalizePhone } from '@/services/leads/normalizePhone';

/**
 * Pure logic behind the lead import screen: which spreadsheet column is which lead
 * field, and whether a row can become a lead. Kept free of React and of the network so
 * the rules can be tested with a table of rows.
 */
export const LEAD_FIELDS = ['fullName', 'phone', 'email', 'company', 'jobTitle', 'city', 'country', 'notes'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
/** A column can map to a field, be folded into notes as "Header: value", or be skipped. */
export type ColumnTarget = LeadField | 'notes+' | 'skip';

export const FIELD_LABELS: Record<LeadField, string> = {
  fullName: 'Full name',
  phone: 'Phone / mobile',
  email: 'Email',
  company: 'Company',
  jobTitle: 'Job title',
  city: 'City / location',
  country: 'Country',
  notes: 'Notes',
};

/** Header spellings seen in customer files, already normalised (lowercase, alphanumeric only). */
const SYNONYMS: Record<LeadField, string[]> = {
  fullName: [
    'fullname',
    'name',
    'leadname',
    'customername',
    'clientname',
    'contactname',
    'contact',
    'customer',
    'client',
    'firstname',
  ],
  phone: [
    'phone',
    'mobile',
    'mobilenumber',
    'mobileno',
    'phonenumber',
    'contactnumber',
    'contactno',
    'tel',
    'telephone',
    'whatsapp',
    'cell',
  ],
  email: ['email', 'emailaddress', 'emailid', 'mail'],
  company: ['company', 'companyname', 'organisation', 'organization', 'employer', 'business'],
  jobTitle: ['jobtitle', 'title', 'designation', 'position', 'role'],
  city: ['city', 'location', 'area', 'emirate', 'town'],
  country: ['country', 'nationality'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments', 'description'],
};

const normalise = (header: string) =>
  header
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Best-effort target for each header; a field is claimed at most once, first column wins. */
export function detectColumns(headers: string[]): ColumnTarget[] {
  const taken = new Set<LeadField>();
  return headers.map((header) => {
    const key = normalise(header);
    if (!key) return 'skip';
    for (const field of LEAD_FIELDS) {
      if (taken.has(field)) continue;
      if (SYNONYMS[field].includes(key)) {
        taken.add(field);
        return field;
      }
    }
    return 'notes+';
  });
}

export type PreparedRow = {
  /** 1-based line in the source file, header counted as line 1. */
  line: number;
  values: Partial<Record<LeadField, string>>;
  /** First problem found; a row with a problem is not sent. */
  problem?: string;
  /** Another row in the same file shares this phone or email. */
  duplicateOf?: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Applies a mapping to raw rows: blank rows are dropped, mandatory and format rules are
 * checked, and in-file duplicates (same phone or email as an earlier row) are marked so
 * the person can see them before anything is created.
 */
export function prepareRows(rows: string[][], headers: string[], mapping: ColumnTarget[]): PreparedRow[] {
  const seen = new Map<string, number>();
  const out: PreparedRow[] = [];
  rows.forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((cell) => !String(cell ?? '').trim())) return;

    const values: Partial<Record<LeadField, string>> = {};
    const extra: string[] = [];
    mapping.forEach((target, column) => {
      const value = String(cells[column] ?? '').trim();
      if (!value || target === 'skip') return;
      if (target === 'notes+') extra.push(`${headers[column]?.trim() || `Column ${column + 1}`}: ${value}`);
      else if (target === 'notes') values.notes = values.notes ? `${values.notes}\n${value}` : value;
      else values[target] = value;
    });
    if (extra.length) values.notes = [values.notes, ...extra].filter(Boolean).join('\n');

    const row: PreparedRow = { line, values };
    if (!values.fullName) row.problem = 'Full name is missing';
    else if (values.email && !EMAIL.test(values.email)) row.problem = `Invalid email "${values.email}"`;
    else if (values.phone && !normalizePhone(values.phone)) row.problem = `Invalid phone "${values.phone}"`;
    else if (values.notes && values.notes.length > 5000) row.problem = 'Notes longer than 5000 characters';

    if (!row.problem) {
      const keys = [
        values.phone && `p:${normalizePhone(values.phone)}`,
        values.email && `e:${values.email.toLowerCase()}`,
      ].filter(Boolean) as string[];
      const earlier = keys.map((k) => seen.get(k)).find((v) => v !== undefined);
      if (earlier !== undefined) row.duplicateOf = earlier;
      else keys.forEach((k) => seen.set(k, line));
    }
    out.push(row);
  });
  return out;
}
