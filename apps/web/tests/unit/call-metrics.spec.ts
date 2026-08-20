/**
 * The measured half of conversation intelligence: pure functions, no database.
 *
 * These are the numbers a manager acts on (talk ratio) and the findings a rep
 * is coached against (playbook matches), so the edge cases matter more than the
 * happy path: unattributed transcripts must refuse to answer, not answer 0.5.
 */
import { describe, it, expect } from 'vitest';
import { matchObjections, parseTranscript, segmentsToTranscript, talkToListen } from '@/lib/ai/callMetrics';

const TRANSCRIPT = [
  'Agent: Good morning, thanks for taking the call today.',
  'Client: Sure. Honestly it sounds too expensive for us.',
  'Agent: Fair concern. The payment plan spreads the cost over three years, so the monthly figure is lower.',
  'Client: Alright, send me the plan.',
].join('\n');

describe('parseTranscript', () => {
  it('attributes labelled lines and leaves prose unknown', () => {
    const lines = parseTranscript('Agent: hello\n[00:12] Client: hi\njust some prose');
    expect(lines.map((l) => l.side)).toEqual(['REP', 'OTHER', 'UNKNOWN']);
  });
});

describe('talkToListen', () => {
  it('measures by words, not lines', () => {
    const { ratio, repWords, otherWords } = talkToListen(TRANSCRIPT);
    expect(repWords).toBeGreaterThan(otherWords); // the agent rambles above
    expect(ratio).toBeCloseTo(repWords / (repWords + otherWords), 3);
  });

  it('refuses to answer for an unattributed transcript', () => {
    expect(talkToListen('no speakers here at all').ratio).toBeNull();
  });
});

describe('segmentsToTranscript', () => {
  it('labels the first speaker as the rep on an outbound call', () => {
    const text = segmentsToTranscript(
      [
        { speaker: '0', text: 'Hello, calling from Manath.' },
        { speaker: '1', text: 'Hi.' },
      ],
      'OUTBOUND',
    );
    expect(text).toBe('Agent: Hello, calling from Manath.\nClient: Hi.');
  });

  it('flips the assumption for inbound calls', () => {
    const text = segmentsToTranscript(
      [
        { speaker: '0', text: 'Hi, I saw your listing.' },
        { speaker: '1', text: 'Thanks for calling.' },
      ],
      'INBOUND',
    );
    expect(text.startsWith('Client:')).toBe(true);
  });
});

describe('matchObjections', () => {
  const playbook = [
    {
      id: 'obj_price',
      name: 'Too expensive',
      triggerPhrases: ['too expensive', 'over budget'],
      recommendedResponses: ['Explain the payment plan and the monthly figure over three years.'],
    },
    {
      id: 'obj_timing',
      name: 'Bad timing',
      triggerPhrases: ['call me next quarter'],
      recommendedResponses: ['Book a specific follow-up date.'],
    },
  ];

  it('finds the trigger in the customer line and credits the rep answer', () => {
    const hits = matchObjections(TRANSCRIPT, playbook);
    expect(hits).toHaveLength(1);
    expect(hits[0].objectionId).toBe('obj_price');
    expect(hits[0].phrase).toBe('too expensive');
    // The agent's reply shares 'payment', 'plan', 'monthly', 'figure' with the
    // recommended response — comfortably over the two-word bar.
    expect(hits[0].addressed).toBe(true);
  });

  it('does not match trigger phrases spoken by the rep', () => {
    const hits = matchObjections('Agent: some say it is too expensive, but…\nClient: go on.', playbook);
    expect(hits).toHaveLength(0);
  });

  it('marks an ignored objection as unaddressed', () => {
    const hits = matchObjections('Client: this is too expensive.\nAgent: anyway, the tower has a gym.', playbook);
    expect(hits).toHaveLength(1);
    expect(hits[0].addressed).toBe(false);
  });

  it('returns nothing for an empty transcript or playbook', () => {
    expect(matchObjections('', playbook)).toHaveLength(0);
    expect(matchObjections(TRANSCRIPT, [])).toHaveLength(0);
  });
});
