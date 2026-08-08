/**
 * Redaction at the AI trust boundary.
 *
 * A transcript is a verbatim recording of someone reading their card number
 * aloud to close a sale. Everything here is stripped before the text leaves the
 * deployment for a third-party model, and the redaction is not reversible — the
 * original stays in the Transcript row, which is access-controlled and covered
 * by the retention job.
 *
 * Placeholders are typed (`[REDACTED_CARD]`, not `***`) so the model still sees
 * that a card was discussed and can summarise the fact without holding the
 * digits.
 */

export interface RedactionReport {
  text: string;
  /** Count per category, for the AI request log. Never contains the values. */
  counts: Record<string, number>;
}

/**
 * Luhn check, so a 16-digit order reference or a quoted price survives while a
 * real card number does not. Cheap enough to be worth the precision.
 */
function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

type Rule = {
  label: string;
  pattern: RegExp;
  /** Return false to leave the match alone. */
  when?: (match: string) => boolean;
};

const RULES: Rule[] = [
  // Secrets first: an API key can otherwise be eaten by the generic digit rule
  // and leak its prefix.
  {
    label: 'SECRET',
    pattern: /\b(?:sk|pk|rk|api|key|token|bearer)[-_ ]?[A-Za-z0-9_-]{16,}\b/gi,
  },
  {
    label: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // 13–19 digits, optionally spaced or hyphenated in groups, that pass Luhn.
  {
    label: 'CARD',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    when: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && isLuhnValid(digits);
    },
  },
  // The digit lookarounds matter: without them this matches a 13-digit window
  // *inside* a longer account number and redacts only part of it, leaving the
  // leading digits in the prompt.
  {
    label: 'PHONE',
    pattern: /(?<!\d)\+?\d[\d ()-]{5,18}\d(?!\d)/g,
    when: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15;
    },
  },
  // Whatever is left that is a long unbroken digit run: bank accounts, national
  // ids, policy numbers. Currency amounts are shorter than this.
  {
    label: 'NUMBER',
    pattern: /\b\d{9,}\b/g,
  },
];

/**
 * ponytail: regex redaction, so it catches numbers spoken as digits but not
 * ones a transcriber wrote out in words ("four one two seven..."). Add a
 * number-word normalisation pass if real transcripts show that shape.
 */
export function redact(input: string): RedactionReport {
  const counts: Record<string, number> = {};
  let text = input;

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match) => {
      if (rule.when && !rule.when(match)) return match;
      counts[rule.label] = (counts[rule.label] ?? 0) + 1;
      return `[REDACTED_${rule.label}]`;
    });
  }

  return { text, counts };
}
