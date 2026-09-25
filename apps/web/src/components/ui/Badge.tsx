/**
 * `wine` stays in the type for the handful of callers that still pass it; the
 * stylesheet draws it as neutral, because a status is never the brand colour.
 */
export type Tone = 'slate' | 'wine' | 'brass' | 'viridian' | 'vermillion' | 'info';

/**
 * Semantic mapping lives here so a status never picks its own colour ad hoc.
 * CONTACTED / INTERESTED / QUALIFIED / NEGOTIATION carry no entry on purpose:
 * mid-funnel is neutral, not a signal.
 */
const STATUS_TONE: Record<string, Tone> = {
  // lead + opportunity
  NEW: 'slate',
  OPEN: 'slate',
  ATTEMPTED: 'slate',
  DOCUMENTS_PENDING: 'brass',
  PROPOSAL_SENT: 'brass',
  APPLICATION_STARTED: 'brass',
  CONVERTED: 'viridian',
  WON: 'viridian',
  VERIFIED: 'viridian',
  NOT_INTERESTED: 'slate',
  DUPLICATE: 'slate',
  INVALID: 'slate',
  DISQUALIFIED: 'vermillion',
  LOST: 'vermillion',
  REJECTED: 'vermillion',
  // sla
  ON_TRACK: 'slate',
  AT_RISK: 'brass',
  BREACHED: 'vermillion',
  MET: 'viridian',
  PAUSED: 'slate',
  // priority
  LOW: 'slate',
  MEDIUM: 'slate',
  HIGH: 'brass',
  URGENT: 'vermillion',
};

/**
 * The nearest semantic tone for a tenant-chosen hex (LeadStage.color), so a
 * custom stage is not silently grey. Greys stay neutral; violet is the ONE AI
 * ink and never a status, so it falls to neutral too.
 */
export function toneFromColor(hex: string): Tone {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 'slate';
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join('') : match[1]!;
  const n = parseInt(digits, 16);
  const r = n >> 16;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (max === 0 || delta / max < 0.35) return 'slate';
  const hue = 60 * (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
  if (hue < 25 || hue >= 330) return 'vermillion';
  if (hue < 70) return 'brass';
  if (hue < 190) return 'viridian';
  if (hue < 275) return 'info';
  return 'slate';
}

export function toneFor(value: string, color?: string): Tone {
  return STATUS_TONE[value.toUpperCase().replace(/[\s-]/g, '_')] ?? (color ? toneFromColor(color) : 'slate');
}

/** `QUALIFIED` → "Qualified", `AT_RISK` → "At risk". Sentence case, never caps. */
export function labelFor(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function Badge({
  children,
  tone,
  value,
  color,
}: {
  children?: React.ReactNode;
  tone?: Tone;
  value?: string;
  /** A record's own hex, consulted only when `value` has no semantic entry. */
  color?: string;
}) {
  const label = children ?? (value ? labelFor(value) : undefined);
  return (
    <span className="lf-badge" data-tone={tone ?? (value ? toneFor(value, color) : 'slate')}>
      {label}
    </span>
  );
}
