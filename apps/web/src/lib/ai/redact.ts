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

// ─────────────────────────────────────────────────────────────────────────────
// Numbers spoken as words
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The gap the rules above cannot see.
 *
 * Every pattern so far matches digits. A transcript is what somebody *said*, and
 * speech-to-text writes a card number read aloud the way it was read:
 *
 *   "it's four two four two, four two four two, four two four two, four two four two"
 *
 * Not one digit in that line, and it is a full card number on its way to a
 * third-party model. The file used to carry a note saying so and inviting
 * somebody to fix it later; a known hole in a redactor is not a note, it is the
 * redactor being wrong.
 *
 * ── Read as digits, not as quantities ───────────────────────────────────────
 *
 * Only the words used when reading a number out one digit at a time. "hundred",
 * "fifty" and "thousand" are deliberately absent: "a hundred and fifty dirhams"
 * is a price, and turning it into digits to test it against Luhn would be
 * inventing a number nobody said.
 */
const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  naught: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/** "double seven" is 77, "triple eight" is 888 — how numbers are read aloud here. */
const REPEATERS: Record<string, number> = { double: 2, triple: 3, treble: 3 };

/**
 * Eight, because that is the shortest thing worth protecting — the PHONE rule's
 * own floor.
 *
 * It is also what keeps "one two three" and "he was number one, two years
 * running" out of it. Nobody reads eight consecutive digit-words aloud by
 * accident.
 */
const MIN_SPOKEN_DIGITS = 8;

interface SpokenRun {
  start: number;
  end: number;
  digits: string;
}

/**
 * Maximal runs of digit-words, with their offsets in the original text.
 *
 * Offsets, because the run is *redacted where it stands* rather than rewritten
 * as digits. Replacing the words with numerals would hand the model a
 * transcript nobody spoke, and redaction must not edit the record it is
 * protecting.
 */
function spokenRuns(input: string): SpokenRun[] {
  const runs: SpokenRun[] = [];
  // Words and the punctuation between them; a spoken number survives commas.
  const token = /[A-Za-z]+/g;
  let current: SpokenRun | null = null;
  let pendingRepeat = 0;
  let match: RegExpExecArray | null;

  const close = () => {
    if (current && current.digits.length >= MIN_SPOKEN_DIGITS) runs.push(current);
    current = null;
    pendingRepeat = 0;
  };

  while ((match = token.exec(input)) !== null) {
    const word = match[0].toLowerCase();
    const digit = DIGIT_WORDS[word];
    const repeat = REPEATERS[word];

    if (repeat) {
      // "double" alone is not a number; it only counts if a digit follows.
      pendingRepeat = repeat;
      if (!current) current = { start: match.index, end: match.index + match[0].length, digits: '' };
      current.end = match.index + match[0].length;
      continue;
    }

    if (digit) {
      if (!current) current = { start: match.index, end: match.index + match[0].length, digits: '' };
      current.digits += digit.repeat(pendingRepeat || 1);
      current.end = match.index + match[0].length;
      pendingRepeat = 0;
      continue;
    }

    // Any other word ends the run. Between two digit-words only whitespace and
    // punctuation are allowed, which is what stops "four" ... two paragraphs
    // later ... "seven" from joining up.
    close();
  }
  close();
  return runs;
}

/** The same classification the digit rules apply, against a spoken run. */
function labelFor(digits: string): string | null {
  if (digits.length >= 13 && digits.length <= 19 && isLuhnValid(digits)) return 'CARD';
  if (digits.length >= 8 && digits.length <= 15) return 'PHONE';
  if (digits.length >= 9) return 'NUMBER';
  return null;
}

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

  // After the digit rules, and on the already-substituted text: a placeholder
  // contains no digit-words, so it cannot be caught up in a run — and running
  // this first would let a spoken run swallow the digits of a real card that the
  // Luhn rule was about to catch properly.
  //
  // Applied back to front so an earlier replacement does not shift the offsets
  // of a later one.
  const runs = spokenRuns(text);
  for (const run of runs.reverse()) {
    const label = labelFor(run.digits);
    if (!label) continue;
    counts[label] = (counts[label] ?? 0) + 1;
    text = `${text.slice(0, run.start)}[REDACTED_${label}]${text.slice(run.end)}`;
  }

  return { text, counts };
}
