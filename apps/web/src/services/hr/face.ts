/**
 * Face matching and challenge-response liveness.
 *
 * The sidecar in `apps/face` does detection, embedding and pose. Everything
 * below is policy and lives here, next to the rest of the HR rules: what counts
 * as a match, whether the head actually moved the way the server asked, whether
 * enrolment samples vary enough. Ported from the original HRMS
 * `app/services/face.py`.
 *
 * Two things worth defending, both carried over deliberately:
 *
 * 1. The frame is processed server-side. If the browser computes the embedding,
 *    a punch is just a vector in a JSON body — capture it once and you can
 *    replay it from a beach forever.
 * 2. The server picks the challenge direction. A client-chosen challenge is not
 *    a challenge: the attacker always picks the one they recorded earlier.
 *
 * This is NOT certified presentation-attack detection. It stops a held-up
 * photo, a static screen and a face swapped between frames. It will not reliably
 * stop a good video replay on a good screen. If you need a real guarantee, buy
 * an iBeta Level 1/2 SDK and put it behind this same interface.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { redis } from '@/lib/redis';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

export type Direction = 'left' | 'right' | 'up';

export const DIRECTIONS: Direction[] = ['left', 'right', 'up'];

export const INSTRUCTIONS: Record<Direction, string> = {
  left: 'Turn your head slowly to your left.',
  right: 'Turn your head slowly to your right.',
  up: 'Tilt your head slowly upwards.',
};

/** Defaults only; the workspace HR policy supplies the live values. */
export const CHALLENGE_TTL_SECONDS = 90;

export interface LivenessPolicy {
  livenessYawDegrees: number;
  livenessPitchDegrees: number;
  livenessSamePersonThreshold: number;
}

export interface QualityPolicy {
  minDetectionScore: number;
  minFaceAreaRatio: number;
  minBlurScore: number;
}

const DEFAULT_LIVENESS: LivenessPolicy = {
  livenessYawDegrees: 12,
  livenessPitchDegrees: 10,
  livenessSamePersonThreshold: 0.4,
};

/** No engine, no attendance. A 503 naming what is missing, never a wave-through. */
export const EngineUnavailable = (detail: string) => new AppError(503, 'face-engine-unavailable', detail);

export interface Detection {
  ok: boolean;
  error?: string;
  embedding?: number[];
  detScore?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  bboxAreaRatio?: number;
  blurScore?: number;
}

// ── Sidecar client ─────────────────────────────────────────────────────────

export async function engineHealth(): Promise<{ ready: boolean; detail: string }> {
  if (!env.FACE_SERVICE_URL) {
    return {
      ready: false,
      detail:
        'FACE_SERVICE_URL is not configured, so face check-in is unavailable. Start the face service (docker compose up face) and set the variable.',
    };
  }
  try {
    const response = await fetch(`${env.FACE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    const body = (await response.json()) as { ready?: boolean; detail?: string };
    return { ready: Boolean(body.ready), detail: body.detail ?? 'The face service did not explain its state.' };
  } catch (error) {
    return {
      ready: false,
      detail: `The face service at ${env.FACE_SERVICE_URL} could not be reached: ${(error as Error).message}`,
    };
  }
}

/** Base64 frames in, one detection per frame out. Never returns partial results. */
export async function analyse(frames: string[], quality?: QualityPolicy): Promise<Detection[]> {
  if (!env.FACE_SERVICE_URL) throw EngineUnavailable((await engineHealth()).detail);

  let response: Response;
  try {
    response = await fetch(`${env.FACE_SERVICE_URL}/analyse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.FACE_SERVICE_TOKEN ? { authorization: `Bearer ${env.FACE_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ frames, quality }),
      signal: AbortSignal.timeout(env.FACE_SERVICE_TIMEOUT_MS),
    });
  } catch (error) {
    throw EngineUnavailable(`The face service could not be reached: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw EngineUnavailable(body.detail ?? `The face service returned ${response.status}.`);
  }
  const body = (await response.json()) as { detections: Detection[] };
  return body.detections;
}

// ── Challenge store ────────────────────────────────────────────────────────

const challengeKey = (nonce: string) => `face:challenge:${nonce}`;

/**
 * Redis rather than process memory: the original's in-process store breaks the
 * moment there is more than one web worker, and Redis is already a dependency.
 */
export async function issueChallenge(tenantId: string, employeeId: string, ttlSeconds = CHALLENGE_TTL_SECONDS) {
  const nonce = randomBytes(24).toString('base64url');
  const direction = DIRECTIONS[randomInt(DIRECTIONS.length)]!;
  await redis.set(challengeKey(nonce), JSON.stringify({ tenantId, employeeId, direction }), 'EX', ttlSeconds);
  return { nonce, direction, instruction: INSTRUCTIONS[direction], expiresInSeconds: ttlSeconds };
}

/** Single use. A replayed nonce is refused even inside its TTL. */
export async function consumeChallenge(tenantId: string, employeeId: string, nonce: string): Promise<Direction> {
  const raw = await redis.getdel(challengeKey(nonce));
  if (!raw)
    throw new AppError(409, 'challenge-expired', 'That check-in attempt expired or was already used. Start again.');
  const challenge = JSON.parse(raw) as { tenantId: string; employeeId: string; direction: Direction };
  if (challenge.tenantId !== tenantId || challenge.employeeId !== employeeId) {
    throw new AppError(409, 'challenge-expired', 'That check-in attempt expired or was already used. Start again.');
  }
  return challenge.direction;
}

// ── Matching ───────────────────────────────────────────────────────────────

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Templates are stored as raw little-endian float32, matching the sidecar's output. */
export const toBytes = (vector: number[]) => Buffer.from(new Float32Array(vector).buffer);
export function fromBytes(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob); // Prisma may hand back a view with a non-zero offset
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/** Highest similarity against any enrolled template. */
export function bestMatch(probe: number[], templates: Uint8Array[]): number {
  let best = 0;
  for (const template of templates) best = Math.max(best, cosine(probe, fromBytes(template)));
  return best;
}

// ── Liveness ───────────────────────────────────────────────────────────────

export interface LivenessResult {
  passed: boolean;
  score: number;
  reason: string;
  embedding?: number[];
}

/**
 * `detections[0]` is the neutral pose, the rest follow the requested movement.
 * Checks run cheapest-failure-first:
 *   1. every frame holds exactly one usable face
 *   2. all frames are the same person
 *   3. the head moved far enough in the direction the server asked for
 *
 * The byte-identical-frames check happens before this, on the raw payload.
 */
export function verifyLiveness(
  detections: Detection[],
  direction: Direction,
  policy: LivenessPolicy = DEFAULT_LIVENESS,
): LivenessResult {
  if (detections.length < 2)
    return { passed: false, score: 0, reason: 'Send at least two frames: one neutral, one after moving.' };

  const failed = detections.find((detection) => !detection.ok);
  if (failed) return { passed: false, score: 0, reason: failed.error ?? 'A frame could not be used.' };

  const base = detections[0]!;
  for (const detection of detections.slice(1)) {
    if (cosine(base.embedding!, detection.embedding!) < policy.livenessSamePersonThreshold) {
      return { passed: false, score: 0, reason: 'The face changed between frames.' };
    }
  }

  const moved = detections[detections.length - 1]!;
  const turned =
    direction === 'left'
      ? moved.yaw! - base.yaw! >= policy.livenessYawDegrees
      : direction === 'right'
        ? base.yaw! - moved.yaw! >= policy.livenessYawDegrees
        : Math.abs(base.pitch! - moved.pitch!) >= policy.livenessPitchDegrees;

  if (!turned) {
    return {
      passed: false,
      score: 0,
      reason: `Head movement not detected. Turn your head ${direction} and hold for a moment.`,
    };
  }

  // Blends detector confidence with sharpness: a printed photo or a phone screen
  // usually loses on sharpness even when it passes the pose check.
  const score = Math.min(1, base.detScore! * 0.6 + Math.min(base.blurScore! / 300, 1) * 0.4);
  return { passed: true, score: Math.round(score * 1000) / 1000, reason: 'ok', embedding: base.embedding };
}

/**
 * Four shots of the identical pose give a brittle template that fails the moment
 * the person tilts their head. This is how much the samples must differ.
 */
export function enrolmentSpread(embeddings: number[][]): number {
  let highest = 0;
  for (let i = 0; i < embeddings.length; i += 1) {
    for (let j = i + 1; j < embeddings.length; j += 1) {
      highest = Math.max(highest, cosine(embeddings[i]!, embeddings[j]!));
    }
  }
  return 1 - highest;
}
