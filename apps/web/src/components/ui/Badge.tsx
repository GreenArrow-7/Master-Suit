export type Tone = 'slate' | 'wine' | 'brass' | 'viridian' | 'vermillion';

/** Semantic mapping lives here so a status never picks its own colour ad hoc. */
const STATUS_TONE: Record<string, Tone> = {
  // lead + opportunity
  NEW: 'slate', OPEN: 'slate', ATTEMPTED: 'slate', CONTACTED: 'wine',
  INTERESTED: 'wine', QUALIFIED: 'wine', NEGOTIATION: 'wine',
  DOCUMENTS_PENDING: 'brass', PROPOSAL_SENT: 'brass', APPLICATION_STARTED: 'brass',
  CONVERTED: 'viridian', WON: 'viridian', VERIFIED: 'viridian',
  NOT_INTERESTED: 'slate', DUPLICATE: 'slate', INVALID: 'slate',
  DISQUALIFIED: 'vermillion', LOST: 'vermillion', REJECTED: 'vermillion',
  // sla
  ON_TRACK: 'slate', AT_RISK: 'brass', BREACHED: 'vermillion', MET: 'viridian', PAUSED: 'slate',
  // priority
  LOW: 'slate', MEDIUM: 'slate', HIGH: 'brass', URGENT: 'vermillion',
};

export function toneFor(value: string): Tone {
  return STATUS_TONE[value.toUpperCase().replace(/[\s-]/g, '_')] ?? 'slate';
}

export default function Badge({ children, tone, value }: { children?: React.ReactNode; tone?: Tone; value?: string }) {
  const label = children ?? value?.replace(/_/g, ' ').toLowerCase();
  return <span className="lf-badge" data-tone={tone ?? (value ? toneFor(value) : 'slate')}>{label}</span>;
}
