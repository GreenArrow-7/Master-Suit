/**
 * Is this comment a sales enquiry?
 *
 * Deterministic and dependency-free on purpose. AI enrichment comes later and
 * on top; if Gemini is unavailable the comment still ingests, still scores,
 * still routes and still converts (§21). A qualification layer that needs a
 * model to be up is a qualification layer that fails during an outage, which is
 * exactly when a viral post is producing comments.
 *
 * Signals rather than a keyword list. "price" alone is weak — "what's the price"
 * and "price 🔥" are different comments — so the score comes from what the
 * commenter is *doing*: asking to be contacted, asking about money, asking about
 * availability. Each signal that fires records why, because a bare 91 is not
 * something a salesperson can act on or disagree with (§20).
 */

export type Intent = 'HIGH' | 'MEDIUM' | 'LOW' | 'IRRELEVANT' | 'SPAM';

export interface Qualification {
  intent: Intent;
  /** 0–100. Only meaningful alongside `reasons`. */
  score: number;
  reasons: string[];
}

interface Signal {
  /** Shown to a salesperson, so it reads as a sentence about the customer. */
  reason: string;
  weight: number;
  test: RegExp;
}

/**
 * Word-boundary matched. Substring matching turns "nice" into a hit on
 * "expensive" and "book" into a hit on "facebook", which is how keyword
 * qualifiers earn their reputation.
 */
const SIGNALS: Signal[] = [
  { reason: 'asked to be contacted', weight: 40, test: /\b(call|contact|reach|whatsapp|dm|message)\s*(me|us)?\b/i },
  { reason: 'asked about price', weight: 35, test: /\b(price|pricing|cost|how much|kitna|kam)\b/i },
  {
    reason: 'asked about payment terms',
    weight: 35,
    test: /\b(payment plan|instal?lment|mortgage|down ?payment|finance|financing)\b/i,
  },
  { reason: 'said they are interested', weight: 30, test: /\b(interested|i want|i need|looking for|keen)\b/i },
  {
    reason: 'asked for details',
    weight: 25,
    test: /\b(details|brochure|floor ?plan|catalogue|more info|information)\b/i,
  },
  {
    reason: 'asked about availability',
    weight: 25,
    test: /\b(available|availability|still (on|there)|in stock|any left)\b/i,
  },
  {
    reason: 'asked to book or visit',
    weight: 30,
    test: /\b(book|booking|viewing|visit|site visit|appointment|tour)\b/i,
  },
  { reason: 'named a unit type', weight: 20, test: /\b(\d\s?(bed|bhk|br)\b|studio|penthouse|villa|townhouse)\b/i },
  { reason: 'asked about location', weight: 15, test: /\b(location|where|address|area|community)\b/i },
  {
    reason: 'asked about handover or completion',
    weight: 15,
    test: /\b(handover|completion|ready|possession|delivery date)\b/i,
  },
  { reason: 'asked about size or layout', weight: 12, test: /\b(size|sq ?ft|square feet|layout|area size)\b/i },
  { reason: 'asked about investment return', weight: 15, test: /\b(roi|rental yield|return|investment|resale)\b/i },
  { reason: 'left contact details', weight: 30, test: /(\+?\d[\d\s-]{7,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)/ },
];

/** Obvious noise. Deliberately narrow — over-eager spam detection loses customers. */
const SPAM = [
  {
    reason: 'looks like promotion',
    test: /\b(follow me|check my|click here|earn \$|crypto|forex|investment scheme|whatsapp \+\d{6,})\b/i,
  },
  { reason: 'repeated character spam', test: /(.)\1{9,}/ },
];

/** Nothing but emoji, punctuation or whitespace. */
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s\p{P}]+$/u;

/**
 * Praise, with or without a noun: "Nice", "Beautiful project", "Amazing work".
 *
 * Written as a word check rather than one clever regex — the regex version used
 * unicode property escapes and an optional trailing noun, and was the kind of
 * thing nobody can debug at 3am. This strips emoji and punctuation, then asks
 * whether every remaining word is praise.
 *
 * Scored LOW rather than IRRELEVANT: not an enquiry, but positive engagement,
 * and marketing legitimately wants to know which post attracted it. Neither
 * reaches the CRM.
 */
const PRAISE = new Set([
  'nice',
  'great',
  'good',
  'wow',
  'amazing',
  'beautiful',
  'lovely',
  'congrats',
  'congratulations',
  'super',
  'excellent',
  'perfect',
  'ok',
  'okay',
  'thanks',
  'thank',
  'you',
  'project',
  'work',
  'place',
  'one',
  'job',
  'design',
  'building',
  'development',
  'view',
  'so',
]);

function isPleasantry(comment: string): boolean {
  const words = comment
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => PRAISE.has(word));
}

export function qualifyComment(text: string): Qualification {
  const comment = (text ?? '').trim();
  if (!comment) return { intent: 'IRRELEVANT', score: 0, reasons: ['comment had no text'] };

  for (const rule of SPAM) {
    if (rule.test.test(comment)) return { intent: 'SPAM', score: 0, reasons: [rule.reason] };
  }

  // "🔥🔥🔥" and "Beautiful project" are engagement, not enquiries. They are
  // captured — they still tell marketing the post landed — but they must never
  // reach the CRM, which is the whole reason Layer 1 exists.
  if (EMOJI_ONLY.test(comment)) {
    return { intent: 'IRRELEVANT', score: 0, reasons: ['emoji only, no enquiry'] };
  }
  if (isPleasantry(comment)) {
    return { intent: 'LOW', score: 5, reasons: ['general praise, no question asked'] };
  }

  const hits = SIGNALS.filter((signal) => signal.test.test(comment));
  const reasons = hits.map((h) => h.reason);
  const raw = hits.reduce((sum, h) => sum + h.weight, 0);

  // A direct question is weak on its own but corroborating alongside a signal.
  const asksSomething = /\?/.test(comment) || /\b(what|when|where|how|which|can|could|is|are|do|does)\b/i.test(comment);
  const score = Math.min(100, raw + (asksSomething && hits.length > 0 ? 10 : 0));

  if (score === 0) {
    return {
      intent: asksSomething ? 'LOW' : 'IRRELEVANT',
      score,
      reasons: [asksSomething ? 'asked something, but not about buying' : 'no enquiry signals'],
    };
  }
  if (score >= 60) return { intent: 'HIGH', score, reasons };
  if (score >= 25) return { intent: 'MEDIUM', score, reasons };
  return { intent: 'LOW', score, reasons };
}
