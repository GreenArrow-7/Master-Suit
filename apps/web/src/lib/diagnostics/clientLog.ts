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

export const DIAGNOSTIC_KEY = 'lf.diagnostics.v1';

/** Enough to cover a journey, small enough never to matter. */
export const MAX_ENTRIES = 40;

const MAX_MESSAGE = 200;

export type DiagnosticKind = 'error' | 'rejection' | 'blank-screen' | 'navigation' | 'request-failed';

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

/** A thrown value can be anything at all, so it is coerced and clipped. */
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
  const withoutUrls = raw.replace(/https?:\/\/[^\s"')]+/g, (url) => redactPath(url));
  return withoutUrls.length > MAX_MESSAGE ? `${withoutUrls.slice(0, MAX_MESSAGE)}…` : withoutUrls;
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
export function readEntries(storage: Pick<Storage, 'getItem'> | undefined): DiagnosticEntry[] {
  try {
    const raw = storage?.getItem(DIAGNOSTIC_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagnosticEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeEntries(storage: Pick<Storage, 'setItem'> | undefined, entries: readonly DiagnosticEntry[]): void {
  try {
    storage?.setItem(DIAGNOSTIC_KEY, JSON.stringify(entries));
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
