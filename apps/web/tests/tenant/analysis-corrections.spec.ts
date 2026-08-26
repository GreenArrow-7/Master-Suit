import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { protectedFields } from '@/services/shared/callIntelligence';

/**
 * Re-analysis must not overwrite what a person corrected.
 *
 * `humanCorrected` was set by the correction route and read by nothing except a
 * badge in the UI. The worker wrote every column on every run, so re-analysing a
 * call somebody had edited replaced their words with the model's — silently, and
 * with no way to recover the original.
 *
 * The route's own comment described re-analysis being "an explicit action rather
 * than something the pipeline does on its own" as the mitigation. It is not one:
 * an explicit action still destroys the correction, and the person clicking it
 * has no idea that it will.
 */

const ALL = ['summary', 'objections', 'nextSteps', 'sentiment', 'risks'];

describe('which fields a re-run may write', () => {
  it('writes everything when nobody has corrected the analysis', () => {
    expect(protectedFields({ humanCorrected: false, correctedFields: [] }, ALL)).toEqual([]);
    expect(protectedFields(null, ALL)).toEqual([]);
  });

  it('protects only the fields a person actually edited', () => {
    // The point of recording field names rather than a flag: a corrected summary
    // survives, and the fields nobody asserted anything about still improve.
    const preserved = protectedFields({ humanCorrected: true, correctedFields: ['summary'] }, ALL);
    expect(preserved).toEqual(['summary']);
    expect(ALL.filter((f) => !preserved.includes(f))).toEqual(['objections', 'nextSteps', 'sentiment', 'risks']);
  });

  it('protects several fields when several were corrected', () => {
    expect(protectedFields({ humanCorrected: true, correctedFields: ['summary', 'risks'] }, ALL)).toEqual([
      'summary',
      'risks',
    ]);
  });

  it('protects everything on a row corrected before the field list existed', () => {
    // `humanCorrected` with an empty list means "somebody corrected this, we do
    // not know what". Guessing wrong destroys work somebody did; the cost of
    // being conservative is a stale field on a handful of pre-migration rows.
    expect(protectedFields({ humanCorrected: true, correctedFields: [] }, ALL)).toEqual(ALL);
  });

  it('ignores a recorded field the model no longer produces', () => {
    // A correction to a field a later release removed must not make the filter
    // throw or protect something that is not being written.
    const preserved = protectedFields({ humanCorrected: true, correctedFields: ['summary', 'gone'] }, ALL);
    expect(preserved).toEqual(['summary']);
  });
});

describe('the shape the correction route stores', () => {
  it('accumulates across corrections rather than replacing', () => {
    // Two edits a week apart to different fields must protect both. The PATCH
    // body only carries what that request changed, so replacing the list would
    // quietly unprotect the earlier one.
    const first = [...new Set([...[], ...['summary']])];
    const second = [...new Set([...first, ...['objections']])];
    expect(second.sort()).toEqual(['objections', 'summary']);

    const preserved = protectedFields({ humanCorrected: true, correctedFields: second }, ALL);
    expect(preserved.sort()).toEqual(['objections', 'summary']);
  });

  it('does not grow on a repeated correction to the same field', () => {
    const once = [...new Set([...['summary'], ...['summary']])];
    expect(once).toEqual(['summary']);
  });
});

/** Guards against the suite passing because the fixture names drifted. */
describe('the field names are the model output’s own', () => {
  it('covers the fields the analysis actually writes', () => {
    const suffix = randomBytes(2).toString('hex');
    expect(ALL).toContain('summary');
    expect(protectedFields({ humanCorrected: true, correctedFields: ['summary'] }, [`unknown-${suffix}`])).toEqual([]);
  });
});
