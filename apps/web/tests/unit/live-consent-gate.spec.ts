import { describe, it, expect } from 'vitest';
import {
  DEMO_CONSENT_BY,
  isDemoConsent,
  consentAuthorisesLiveAudio,
} from '@/lib/integrations/telephony/consent';
import { coachableUtterance } from '@/lib/ai/liveCoach';
import { hintIsStale, HINT_FRESH_MS } from '@/lib/integrations/telephony/liveAudio';

const real = {
  consentGiven: true,
  withdrawnAt: null,
  consentedBy: 'clz0000000000000000000000',
};

describe('consent that may authorise real call audio', () => {
  it('admits a row a person recorded', () => {
    expect(consentAuthorisesLiveAudio(real)).toBe(true);
  });

  it('refuses the row the demo simulation writes', () => {
    // The hazard: pressing "Start simulated call" on a real lead's call left
    // consent on file, and the next real dial asked the provider to fork the
    // conversation without anyone having agreed to it.
    const demo = { ...real, consentedBy: DEMO_CONSENT_BY };
    expect(isDemoConsent(demo)).toBe(true);
    expect(consentAuthorisesLiveAudio(demo)).toBe(false);
  });

  it('refuses demo rows already in the database, whatever the wording after the prefix', () => {
    // Why the predicate is a prefix match: this is what makes the fix
    // retroactive, with no migration and no backfill.
    const older = { ...real, consentedBy: 'Demo simulation — assumed at session start' };
    expect(consentAuthorisesLiveAudio(older)).toBe(false);
  });

  it('refuses a missing row, a withdrawn row and a declined row', () => {
    expect(consentAuthorisesLiveAudio(null)).toBe(false);
    expect(consentAuthorisesLiveAudio({ ...real, withdrawnAt: new Date() })).toBe(false);
    expect(consentAuthorisesLiveAudio({ ...real, consentGiven: false })).toBe(false);
  });

  it('admits a demo row once a person has granted consent for the real call', () => {
    // POST /calls/:id/consent overwrites consentedBy with the actor id, which
    // is the upgrade path. Without it, a call the demo touched could never be
    // coached again — the regression the gate would otherwise introduce.
    const upgraded = { ...real, consentedBy: 'clz1111111111111111111111' };
    expect(consentAuthorisesLiveAudio(upgraded)).toBe(true);
  });
});

describe('ringback must not produce sales hints', () => {
  it('refuses to coach on what the Customer track carries before a human speaks', () => {
    // <Start><Stream> runs before <Dial>, so this track is ringback first.
    for (const noise of ['', '  ', '.', 'ring', 'hello?', '...']) {
      expect(coachableUtterance(noise)).toBe(false);
    }
  });

  it('coaches on a real objection', () => {
    expect(coachableUtterance('The upfront payment is too high.')).toBe(true);
  });
});

describe('stale hints are marked', () => {
  const now = 1_000_000_000_000;

  it('a hint that just arrived is current', () => {
    expect(hintIsStale(now - 1_000, now)).toBe(false);
  });

  it('a hint older than the window is out of date', () => {
    expect(hintIsStale(now - HINT_FRESH_MS - 1, now)).toBe(true);
  });

  it('tolerates a model hint arriving three customer turns late by design', () => {
    expect(hintIsStale(now - 30_000, now)).toBe(false);
  });

  it('treats an unstamped hint as stale rather than claiming freshness it cannot measure', () => {
    expect(hintIsStale(undefined, now)).toBe(true);
    expect(hintIsStale(Number.NaN, now)).toBe(true);
  });
});
