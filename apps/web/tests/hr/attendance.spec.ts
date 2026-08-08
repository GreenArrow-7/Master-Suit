import { describe, expect, it } from 'vitest';
import { haversineM, insideGeofence, withinTimeWindow, zonedParts } from '@/services/hr/rules';
import {
  bestMatch,
  cosine,
  enrolmentSpread,
  fromBytes,
  toBytes,
  verifyLiveness,
  type Detection,
} from '@/services/hr/face';
import { candidateAssignments } from '@/services/hr/attendance';

/**
 * The decisions that let someone through the door. Everything here is pure —
 * the sidecar's detections are supplied as fixtures — so the thresholds are
 * pinned without a camera, a model or a database.
 */
describe('geofence', () => {
  // Two points about 111 m apart: one ten-thousandth of a degree of latitude.
  const office = { lat: 25.2048, lon: 55.2708 };

  it('measures distance on the ground, not in degrees', () => {
    expect(haversineM(office.lat, office.lon, office.lat, office.lon)).toBe(0);
    expect(haversineM(office.lat, office.lon, office.lat + 0.001, office.lon)).toBeCloseTo(111, 0);
  });

  it('accepts someone inside the radius and refuses someone outside it', () => {
    expect(insideGeofence(120, 150)).toBe(true);
    expect(insideGeofence(200, 150)).toBe(false);
  });

  it('subtracts GPS accuracy so a genuine employee at the edge is not refused by sensor noise', () => {
    expect(insideGeofence(180, 150, 0)).toBe(false);
    expect(insideGeofence(180, 150, 40)).toBe(true);
  });
});

describe('opening hours', () => {
  it('accepts a time inside the window and refuses one outside', () => {
    expect(withinTimeWindow('08:00', '18:00', 9 * 60)).toBe(true);
    expect(withinTimeWindow('08:00', '18:00', 19 * 60)).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    expect(withinTimeWindow('22:00', '06:00', 23 * 60)).toBe(true);
    expect(withinTimeWindow('22:00', '06:00', 2 * 60)).toBe(true);
    expect(withinTimeWindow('22:00', '06:00', 12 * 60)).toBe(false);
  });

  it('treats an unset window as always open', () => {
    expect(withinTimeWindow(null, '18:00', 23 * 60)).toBe(true);
  });

  it('reads the clock in the workspace timezone, not the server one', () => {
    // 22:30 UTC is 02:30 the next day in Dubai — a different day and hour.
    const at = new Date('2026-08-04T22:30:00.000Z');
    expect(zonedParts(at, 'UTC')).toEqual({ weekday: 2, minutes: 22 * 60 + 30 });
    expect(zonedParts(at, 'Asia/Dubai')).toEqual({ weekday: 3, minutes: 2 * 60 + 30 });
  });
});

describe('candidate assignments', () => {
  const at = new Date('2026-08-04T06:00:00.000Z'); // 10:00 Tuesday in Dubai
  const location = {
    status: 'ACTIVE',
    effectiveFrom: null,
    effectiveTo: null,
    workingDays: [1, 2, 3, 4, 5],
    openingTime: '08:00',
    closingTime: '18:00',
  };
  const assignment = {
    status: 'ACTIVE',
    effectiveFrom: null,
    effectiveTo: null,
    checkInAllowed: true,
    checkOutAllowed: true,
    allowedDays: [],
    allowedStartTime: null,
    allowedEndTime: null,
    locationId: 'loc',
    checkoutRule: 'SAME_LOCATION',
    location,
  };
  const run = (overrides: Record<string, unknown> = {}, action: 'CHECK_IN' | 'CHECK_OUT' = 'CHECK_IN') =>
    candidateAssignments([{ ...assignment, ...overrides } as never], action, at, 'Asia/Dubai');

  it('accepts an active assignment inside its days and hours', () => {
    expect(run()).toHaveLength(1);
  });

  it('refuses a revoked assignment', () => {
    expect(run({ status: 'REVOKED' })).toHaveLength(0);
  });

  it('refuses a location still in draft', () => {
    expect(run({ location: { ...location, status: 'DRAFT' } })).toHaveLength(0);
  });

  it('refuses a day the location does not work', () => {
    expect(run({ location: { ...location, workingDays: [0, 6] } })).toHaveLength(0);
  });

  it('refuses an assignment whose window has expired', () => {
    expect(run({ effectiveTo: new Date('2026-07-01T00:00:00.000Z') })).toHaveLength(0);
  });

  it('honours check-in and check-out being separately disabled', () => {
    expect(run({ checkOutAllowed: false }, 'CHECK_OUT')).toHaveLength(0);
    expect(run({ checkOutAllowed: false }, 'CHECK_IN')).toHaveLength(1);
  });

  it('lets the assignment override the location hours', () => {
    expect(run({ allowedStartTime: '12:00', allowedEndTime: '14:00' })).toHaveLength(0);
  });
});

describe('face templates', () => {
  it('survives the round trip through stored bytes', () => {
    const vector = [0.1, -0.25, 0.5, 0.75];
    expect(Array.from(fromBytes(toBytes(vector)))).toEqual(vector.map((v) => Math.fround(v)));
  });

  it('scores an identical vector as 1 and an orthogonal one as 0', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('takes the best of the enrolled templates, not the first', () => {
    const templates = [toBytes([0, 1, 0]), toBytes([0.9, 0.1, 0])];
    expect(bestMatch([1, 0, 0], templates)).toBeCloseTo(cosine([1, 0, 0], [0.9, 0.1, 0]), 5);
  });

  it('reports four shots of one pose as no spread', () => {
    const same = [
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ];
    expect(enrolmentSpread(same)).toBeCloseTo(0, 6);
    expect(
      enrolmentSpread([
        [1, 0, 0],
        [0.8, 0.6, 0],
      ]),
    ).toBeGreaterThan(0.1);
  });
});

describe('challenge-response liveness', () => {
  const face = (over: Partial<Detection> = {}): Detection => ({
    ok: true,
    embedding: [1, 0, 0],
    detScore: 0.9,
    yaw: 0,
    pitch: 0,
    roll: 0,
    bboxAreaRatio: 0.2,
    blurScore: 200,
    ...over,
  });

  it('passes when the head turned the way the server asked', () => {
    const result = verifyLiveness([face(), face({ yaw: 20 })], 'left');
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('refuses when the head did not move far enough', () => {
    expect(verifyLiveness([face(), face({ yaw: 4 })], 'left').passed).toBe(false);
  });

  it('refuses a turn in the opposite direction to the one requested', () => {
    // This is the whole point of the server picking: a recorded left turn must
    // not satisfy a challenge that asked for right.
    expect(verifyLiveness([face(), face({ yaw: 20 })], 'right').passed).toBe(false);
  });

  it('refuses when the face changed between frames', () => {
    const swapped = verifyLiveness([face(), face({ yaw: 20, embedding: [0, 1, 0] })], 'left');
    expect(swapped.passed).toBe(false);
    expect(swapped.reason).toMatch(/face changed/i);
  });

  it('passes an upward tilt for the up challenge', () => {
    expect(verifyLiveness([face(), face({ pitch: -15 })], 'up').passed).toBe(true);
  });

  it('surfaces the frame-level failure rather than a generic message', () => {
    const result = verifyLiveness([face({ ok: false, error: 'No face found in the frame.' }), face()], 'left');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('No face found in the frame.');
  });

  it('needs at least a neutral frame and a moved one', () => {
    expect(verifyLiveness([face()], 'left').passed).toBe(false);
  });
});
