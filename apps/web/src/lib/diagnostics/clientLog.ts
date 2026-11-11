/**
 * What the browser saw, kept on the device, for a fault nobody can reproduce.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A blank screen was reported on an iPhone after saving a lead. It has not
 * reproduced on a desk: not in Chromium at phone size, not in WebKit against a
 * production build over correct HTTPS, in either navigation timing. Six
 * configurations were eliminated and the fault stayed on the device.
 *
 * Reading a phone's console needs a Mac and a cable. Most people reporting a
 * fault have neither. This records the few facts that would identify the cause
 * — the first error, the navigation that did not arrive, a screen that rendered
 * nothing — into the browser's own storage, so the person who hit it can read
 * them back and send them.
 *
 * ── What it must never do ───────────────────────────────────────────────────
 *
 * It is a diagnostic shipped to production, so it collects the minimum that
 * identifies a defect and nothing that identifies a person:
 *
 *   * **No record contents.** Never a name, number, address or field value.
 *   * **No identifiers in paths.** `/w/sales/leads/cmwb…` becomes
 *     `/w/sales/leads/:id`, so a report says which screen without saying which
 *     customer.
 *   * **No query strings.** They carry filters, search terms and tokens.
 *   * **Messages truncated**, because a thrown value can contain anything.
 *
 * It stays in the browser. Nothing here sends anything anywhere; the person
 * decides what to share, by copying it.
 */

const KEY_PREFIX = 'lf.diagnostics.v1';

/**
 * One log per person per workspace.
 *
 * A single global key would pool two people's faults on a shared phone — a
 * branch tablet, a demo device — and show the second person the first one's
 * screens. The owner is `tenantId:userId`, the same value the offline outbox
 * uses for exactly this, and `forgetOtherOwners` removes anybody else's when
 * somebody signs in, so switching user leaves nothing of the previous one's
 * readable.
 */
export const keyFor = (owner: string) => `${KEY_PREFIX}:${owner}`;

/** Kept for the one test that asserts the prefix; not a storage key itself. */
export const DIAGNOSTIC_KEY = KEY_PREFIX;

/**
 * Everything under this prefix that is not this owner's.
 *
 * The bare prefix counts. It is not a key this code writes — every log is
 * owner-suffixed — but matching only `prefix:` would leave an unsuffixed value
 * sitting there unreadable and uncollectable, which is the one thing a log
 * nobody can see must not do. Found on a test device carrying one from an
 * earlier build of this file.
 */
export function forgetOtherOwners(storage: Storage | undefined, keep: string): void {
  try {
    if (!storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const ours = key === KEY_PREFIX || key?.startsWith(`${KEY_PREFIX}:`);
      if (key && ours && key !== keep) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Absent or blocked storage: nothing to forget and nothing worth breaking.
  }
}

/** Enough to cover a journey, small enough never to matter. */
export const MAX_ENTRIES = 40;

const MAX_MESSAGE = 200;

export type DiagnosticKind =
  'error' | 'rejection' | 'blank-screen' | 'stuck-skeleton' | 'navigation' | 'request-failed';

export interface DiagnosticEntry {
  /** ISO, to the second: enough to correlate with a server log, no more. */
  at: string;
  kind: DiagnosticKind;
  /** The screen, with identifiers removed. */
  path: string;
  detail: string;
}

/**
 * A path segment that is a record id rather than a screen name.
 *
 * cuid (`cmwbq1qcz00n07shzjd67tdor`), cuid2, uuid and long hex all appear as
 * ids here. A segment that is mostly digits is one too — `/leads/12345`.
 */
function isIdentifier(segment: string): boolean {
  if (segment.length >= 20 && /^[a-z0-9]+$/i.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^\d+$/.test(segment)) return true;
  return false;
}

/**
 * `/manath-homes/sales/leads/cmwb…?tab=notes` → `/manath-homes/sales/leads/:id`
 *
 * The workspace slug is kept: it names a customer's workspace, which whoever
 * reads the report already knows, and without it two reports cannot be told
 * apart.
 */
export function redactPath(input: string): string {
  let path = input;
  try {
    // Absolute or relative; only the path survives either way.
    path = new URL(input, 'http://x.invalid').pathname;
  } catch {
    path = input.split('?')[0] ?? input;
  }
  return path
    .split('/')
    .map((segment) => (isIdentifier(segment) ? ':id' : segment))
    .join('/');
}

/**
 * Patterns that must never reach the log, whatever threw them.
 *
 * Redacting identifiers out of paths is not enough: an arbitrary error message
 * can carry anything the code happened to interpolate — a bearer token from a
 * failed request, the email of the account, a phone number from a lead that
 * failed validation. Each is removed by shape, before truncation, because
 * truncation would otherwise keep the first 200 characters of a secret.
 *
 * Deliberately aggressive. A redacted message that says slightly less is a
 * cost; a token in a log a person is invited to copy and paste is not.
 */
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Authorization headers and anything named like a credential.
  [/\b(bearer|basic)\s+[\w._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  [/\b(api[_-]?key|secret|password|passwd|token|session|otp|pin)\b\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  // A JWT is three base64url runs separated by dots.
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-jwt]'],
  // Contact details, which are lead data as much as account data.
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]'],
  [/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]'],
];

/** A thrown value can be anything at all, so it is coerced, scrubbed and clipped. */
export function redactMessage(value: unknown): string {
  const raw =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value) ?? String(value);
            } catch {
              return String(value);
            }
          })();
  // A URL inside a message carries the same identifiers a path does.
  let clean = raw.replace(/https?:\/\/[^\s"')]+/g, (url) => redactPath(url));
  // Then the things a path redactor cannot see. Order matters: scrub before
  // truncating, or the first 200 characters of a token survive.
  for (const [pattern, replacement] of SECRET_PATTERNS) clean = clean.replace(pattern, replacement);
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

/** Oldest dropped first, so a long session cannot grow without bound. */
export function appendEntry(existing: readonly DiagnosticEntry[], entry: DiagnosticEntry): DiagnosticEntry[] {
  return [...existing, entry].slice(-MAX_ENTRIES);
}

/**
 * Storage is wrapped because it is not always there: a private window, cleared
 * site data, or a WebView with storage disabled all throw rather than return
 * nothing. A diagnostic that breaks the page it is diagnosing is worse than no
 * diagnostic.
 */
export function readEntries(storage: Pick<Storage, 'getItem'> | undefined, key: string): DiagnosticEntry[] {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagnosticEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeEntries(
  storage: Pick<Storage, 'setItem'> | undefined,
  key: string,
  entries: readonly DiagnosticEntry[],
): void {
  try {
    storage?.setItem(key, JSON.stringify(entries));
  } catch {
    // Full, blocked or absent. Nothing to do and nothing worth breaking.
  }
}

/** One entry, with everything sensitive already removed. */
export function makeEntry(
  kind: DiagnosticKind,
  path: string,
  detail: unknown,
  now: Date = new Date(),
): DiagnosticEntry {
  return {
    at: `${now.toISOString().slice(0, 19)}Z`,
    kind,
    path: redactPath(path),
    detail: redactMessage(detail),
  };
}

/** The report a person copies out: plain text, nothing to interpret. */
export function formatReport(entries: readonly DiagnosticEntry[], build: string): string {
  if (entries.length === 0) return `YOUHAN ONE diagnostics — build ${build}\n(nothing recorded)`;
  const lines = entries.map((e) => `${e.at}  ${e.kind.padEnd(14)} ${e.path}  ${e.detail}`);
  return [`YOUHAN ONE diagnostics — build ${build}`, `${entries.length} event(s), oldest first`, '', ...lines].join(
    '\n',
  );
}
