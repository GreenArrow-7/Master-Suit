/**
 * A "Call" button that opens the device's dialler.
 *
 * Lifted out of gridCells.tsx so the call list and the call detail dial through
 * one definition. The sanitising below is the part worth not having twice:
 * `tel:` takes digits, an optional leading `+`, and the DTMF separators `,`
 * (pause) and `;` (wait) that an extension needs. Everything a person types for
 * legibility — spaces, brackets, dashes — is stripped, because a handset given
 * `+971 (50) 123-4567` may refuse the whole string.
 *
 * Its own file rather than an export from gridCells.tsx: that module pulls in
 * FollowUpRowActions, a client component, and the call detail has no use for it.
 */

/** The `tel:` target, or null when there is no number worth offering. */
export function dialable(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  const cleaned = value.replace(/[^+\d,;]/g, '').replace(/(?!^)\+/g, '');
  return /\d/.test(cleaned) ? cleaned : null;
}

/**
 * Nothing is rendered without a number: a dead button that silently does
 * nothing is worse than an obvious blank.
 */
export default function CallLink({ number, className }: { number: unknown; className?: string }) {
  const target = dialable(number);
  if (!target) return null;
  return (
    <a
      className={className ?? 'lf-btn lf-btn--secondary lf-btn--sm'}
      href={`tel:${target}`}
      style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
      // The number is not in the visible label, so the control has to say who it
      // dials for anyone using a screen reader.
      aria-label={`Call ${typeof number === 'string' ? number.trim() : ''}`}
    >
      Call
    </a>
  );
}
