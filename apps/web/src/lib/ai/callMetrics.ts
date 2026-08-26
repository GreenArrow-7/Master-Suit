/**
 * The two things about a call that are measured rather than inferred.
 *
 * Both could have been asked of the model in the same request that produces the
 * summary, and both are deliberately not:
 *
 *   * A talk-to-listen ratio is arithmetic over the transcript. A model returns
 *     a plausible number for it, a manager reads that number as a measurement,
 *     and there is no way to tell the two apart after the fact.
 *   * An objection playbook is a list the workspace wrote itself. Finding its
 *     own phrases in its own transcripts should give the same answer every time,
 *     including on a deployment with no model key at all — which is exactly the
 *     configuration the module has to run in for development.
 *
 * Everything here is pure. tests/unit/call-metrics.spec.ts is the check.
 */

export interface TranscriptLine {
  /** As written in the transcript: "Agent", "Client", "Speaker 0", or "". */
  speaker: string;
  text: string;
  lower: string;
  /** Which side of the conversation, once the speaker label is classified. */
  side: 'REP' | 'OTHER' | 'UNKNOWN';
}

const REP_LABEL = /\b(agent|rep|sales|advis|consult|exec|broker|me|caller|host)\b/i;
const OTHER_LABEL = /\b(client|customer|prospect|lead|buyer|caller2|guest|them)\b/i;

/**
 * Splits a transcript into attributed lines.
 *
 * Accepts the three shapes that actually arrive: `Agent: ...`, `[00:12] Agent:
 * ...`, and unlabelled prose. An unlabelled line keeps `side: 'UNKNOWN'` rather
 * than being guessed at — a wrong attribution is worse than a missing one, and
 * `talkToListen` refuses to answer at all when nothing is attributed.
 */
export function parseTranscript(transcript: string): TranscriptLine[] {
  return transcript
    .split('\n')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(?:\[[\d:.]+\]\s*)?([A-Za-z][A-Za-z0-9 .\-_]{0,30}):\s*(.+)$/);
      const speaker = match ? match[1].trim() : '';
      const text = match ? match[2] : raw;
      return { speaker, text, lower: text.toLowerCase(), side: classify(speaker) };
    });
}

function classify(speaker: string): TranscriptLine['side'] {
  if (!speaker) return 'UNKNOWN';
  if (REP_LABEL.test(speaker)) return 'REP';
  if (OTHER_LABEL.test(speaker)) return 'OTHER';
  return 'UNKNOWN';
}

/**
 * Diarised segments, as the transcription providers hand them over.
 *
 * `speaker` is whatever the vendor calls the channel — Deepgram numbers them
 * from 0, Google returns a speakerTag. Neither knows which one is the employee.
 */
export interface DiarisedSegment {
  speaker: string;
  text: string;
  startSec?: number;
}

/**
 * Renders diarised segments as a speaker-prefixed transcript.
 *
 * On a two-party call the side that speaks first is taken to be the rep, which
 * is true for the outbound calls this module is aimed at and wrong for an
 * inbound one that opens with the customer.
 *
 * ponytail: first-speaker-is-the-rep heuristic. The honest fix is asking the
 * vendor for channel-separated audio (both legs recorded on their own channel),
 * which every provider here supports and none of them is currently configured
 * for — switch when a workspace disputes a ratio.
 */
export function segmentsToTranscript(segments: readonly DiarisedSegment[], direction = 'OUTBOUND'): string {
  if (segments.length === 0) return '';
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  const first = segments[0].speaker;
  const repSpeaker = direction === 'INBOUND' && speakers.length > 1 ? speakers.find((s) => s !== first)! : first;
  return segments.map((s) => `${s.speaker === repSpeaker ? 'Agent' : 'Client'}: ${s.text}`).join('\n');
}

export interface TalkRatio {
  /** Share of spoken words that were the rep's, 0–1. Null when unattributable. */
  ratio: number | null;
  repWords: number;
  otherWords: number;
}

/**
 * Talk-to-listen, by word count rather than by line count.
 *
 * Lines are a formatting artefact — one provider emits a line per sentence and
 * another a line per speaker turn, and a ratio that changes when the vendor
 * changes is not measuring the conversation.
 *
 * Returns null rather than 0 or 0.5 when no line carries a speaker: an unknown
 * ratio must be absent from the UI, not rendered as a balanced call.
 */
export function talkToListen(transcript: string): TalkRatio {
  let repWords = 0;
  let otherWords = 0;
  for (const line of parseTranscript(transcript)) {
    const words = countWords(line.text);
    if (line.side === 'REP') repWords += words;
    else if (line.side === 'OTHER') otherWords += words;
  }
  const total = repWords + otherWords;
  return { ratio: total === 0 ? null : Math.round((repWords / total) * 1000) / 1000, repWords, otherWords };
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

// ── Objection playbook matching ──────────────────────────────────────────────

export interface PlaybookEntry {
  id: string;
  name: string;
  triggerPhrases: readonly string[];
  recommendedResponses: readonly string[];
}

export interface ObjectionHit {
  objectionId: string;
  /** The trigger phrase that fired, so the finding can be explained. */
  phrase: string;
  snippet: string;
  addressed: boolean;
}

const SNIPPET_MAX = 300;

/**
 * Finds playbook entries in a transcript, and decides whether the rep answered.
 *
 * Detection is exact: the workspace's own trigger phrase, matched
 * case-insensitively with runs of whitespace collapsed, against the customer's
 * lines (or any line when the transcript carries no attribution at all).
 *
 * `addressed` is a heuristic and is documented as one wherever it is shown. A
 * rep is credited when a later line of theirs shares at least two distinctive
 * words with any recommended response. It over-credits a rep who repeats the
 * vocabulary without the substance, and under-credits one who answers well in
 * their own words.
 *
 * ponytail: bag-of-words overlap on `addressed`. Upgrade path is a per-match
 * question to the model during analysis — one extra field on the existing call,
 * so no extra request — once there is a reason to trust it more than this.
 */
export function matchObjections(transcript: string, playbook: readonly PlaybookEntry[]): ObjectionHit[] {
  const lines = parseTranscript(transcript);
  if (lines.length === 0) return [];

  const attributed = lines.some((l) => l.side !== 'UNKNOWN');
  const hits: ObjectionHit[] = [];

  for (const entry of playbook) {
    for (const rawPhrase of entry.triggerPhrases) {
      const phrase = normalise(rawPhrase);
      if (!phrase) continue;

      const index = lines.findIndex(
        (line) => (!attributed || line.side !== 'REP') && normalise(line.lower).includes(phrase),
      );
      if (index === -1) continue;

      hits.push({
        objectionId: entry.id,
        phrase: rawPhrase,
        snippet: truncate(lines[index].text),
        addressed: repAnswered(lines.slice(index + 1), entry.recommendedResponses, attributed),
      });
    }
  }

  return hits;
}

function repAnswered(after: readonly TranscriptLine[], responses: readonly string[], attributed: boolean): boolean {
  const repLines = after.filter((line) => (attributed ? line.side === 'REP' : true));
  if (repLines.length === 0) return false;

  for (const response of responses) {
    const keywords = distinctive(response);
    if (keywords.length === 0) continue;
    const needed = Math.min(2, keywords.length);
    for (const line of repLines) {
      const words = new Set(distinctive(line.lower));
      if (keywords.filter((k) => words.has(k)).length >= needed) return true;
    }
  }
  return false;
}

/**
 * Words worth matching on: four letters or more, and not one of the handful that
 * appear in every sales sentence. Not a full stop-word list — a longer one would
 * need maintaining per language, and the length filter already removes most of
 * what a real stop-word list is for.
 */
const COMMON = new Set([
  'that',
  'this',
  'with',
  'from',
  'they',
  'them',
  'have',
  'been',
  'will',
  'your',
  'what',
  'when',
  'then',
  'than',
  'about',
  'there',
  'their',
  'would',
  'could',
  'should',
  'because',
]);

function distinctive(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !COMMON.has(w)),
    ),
  ];
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

const truncate = (text: string) => (text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1)}…` : text);
