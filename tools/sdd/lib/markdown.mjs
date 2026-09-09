/**
 * Line-oriented artefact parsing.
 *
 * Treats every artefact as untrusted input (SPEC-0001/SEC-001, SEC-005).
 * All patterns are anchored, bounded and free of nested quantifiers, and are
 * applied to single lines so no pattern ever sees an unbounded string. There
 * is no eval, no Function, no dynamic import and no shell.
 */

/** Identifier prefixes defined by docs/sdd/IDENTIFIER_STANDARD.md. */
export const ID_PREFIXES = [
  'FR', 'NFR', 'SEC', 'DATA', 'OBS', 'AC', 'CL', 'AD',
  'TH', 'CTRL', 'UT', 'IT', 'E2E', 'ST', 'PT', 'REG',
  'TASK', 'CHG', 'CONV',
];

export const REQUIREMENT_PREFIXES = ['FR', 'NFR', 'SEC', 'DATA', 'OBS'];
export const TEST_PREFIXES = ['UT', 'IT', 'E2E', 'ST', 'PT', 'REG'];

const PREFIX_GROUP = ID_PREFIXES.join('|');

/** Any in-spec identifier appearing anywhere on a line. */
const ANY_ID = new RegExp(`\\b(${PREFIX_GROUP})-([0-9]{3})\\b`, 'g');

/** An identifier declared by a heading or a list bullet, not a table cell. */
const DECLARATION = new RegExp(`^(?:#{1,6}[ \\t]+|[-*][ \\t]+)\`?(${PREFIX_GROUP})-([0-9]{3})\`?`);

/** Fully-qualified cross-specification reference. */
const QUALIFIED = new RegExp(`\\b(SPEC-[0-9]{4})/((?:${PREFIX_GROUP})-[0-9]{3})\\b`, 'g');

/** Evidence-conflict identifier. */
const EVC = /\bEVC-([0-9]{3})\b/g;

/** A repository document path inside backticks. */
const DOC_REF = /`([A-Za-z0-9._][A-Za-z0-9._/-]{2,150}\.(?:md|json|mjs|ts|yml))`/g;

const MAX_LINE = 4000;

/** Split into lines, tolerating CRLF and a BOM, and bounding line length. */
export function toLines(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return clean.split(/\r?\n/).map((line) => (line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line));
}

function collect(lines, regex, map) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(lines[i])) !== null) {
      out.push({ ...map(m), line: i + 1 });
      if (m.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return out;
}

/** Every identifier mentioned anywhere, as `PREFIX-NNN` strings. */
export function allIds(text) {
  const lines = toLines(text);
  const found = collect(lines, ANY_ID, (m) => ({ id: `${m[1]}-${m[2]}`, prefix: m[1] }));
  return found;
}

/** Identifiers declared by a heading or bullet. Table rows do not declare. */
export function declaredIds(text) {
  const lines = toLines(text);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = DECLARATION.exec(lines[i]);
    if (m) out.push({ id: `${m[1]}-${m[2]}`, prefix: m[1], line: i + 1 });
  }
  return out;
}

export function qualifiedRefs(text) {
  return collect(toLines(text), QUALIFIED, (m) => ({ specId: m[1], localId: m[2], ref: `${m[1]}/${m[2]}` }));
}

export function evcRefs(text) {
  return collect(toLines(text), EVC, (m) => ({ id: `EVC-${m[1]}` }));
}

export function docRefs(text) {
  return collect(toLines(text), DOC_REF, (m) => ({ path: m[1] }));
}

/** Value of a `| Field | Value |` metadata row, matched case-insensitively. */
export function metadataValue(text, field) {
  const wanted = field.toLowerCase();
  for (const line of toLines(text)) {
    if (line.charAt(0) !== '|') continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 3) continue;
    const key = cells[1].replace(/`/g, '').toLowerCase();
    if (key === wanted) return cells[2].replace(/`/g, '').trim();
  }
  return null;
}

/**
 * Split a document into sections keyed by the identifier their heading
 * declares, so a task or threat can be inspected in isolation.
 */
export function sectionsById(text) {
  const lines = toLines(text);
  const sections = new Map();
  let currentId = null;
  let buffer = [];
  for (const line of lines) {
    const heading = /^#{1,6}[ \t]+/.test(line);
    if (heading) {
      if (currentId) sections.set(currentId, buffer.join('\n'));
      const m = DECLARATION.exec(line);
      currentId = m ? `${m[1]}-${m[2]}` : null;
      buffer = [];
    } else if (currentId) {
      buffer.push(line);
    }
  }
  if (currentId) sections.set(currentId, buffer.join('\n'));
  return sections;
}

/** Lines of a Markdown table body, as arrays of trimmed cells. */
export function tableRows(text) {
  const rows = [];
  for (const line of toLines(text)) {
    if (line.charAt(0) !== '|') continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}
