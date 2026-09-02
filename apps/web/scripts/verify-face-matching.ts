/**
 * Scores the face engine against real photographs, using the application's own
 * client and matching code.
 *
 * Usage:
 *   npx tsx scripts/verify-face-matching.ts <same-a> <same-b> <different-person>
 *
 * Two photographs of one person and one of somebody else. The first two must
 * differ in head pose — the liveness section needs a turn to score.
 *
 * ── Why this is a script and not a test ────────────────────────────────────
 *
 * `tests/hr/attendance.spec.ts` already pins the *policy*: the cosine maths,
 * the template round trip, the challenge directions, the spread rule. It does
 * that with synthetic vectors, so it runs in CI in milliseconds and it is the
 * right place for those rules to live.
 *
 * What synthetic vectors cannot answer is whether the *engine* separates real
 * people — whether two photographs of one face actually score above
 * FACE_MATCH_THRESHOLD and two faces below it. That needs the sidecar running,
 * its 275 MB of ONNX graphs downloaded, and photographs of real people, none of
 * which belong in CI. So it is a script an operator runs against a deployment,
 * and the numbers it prints are the evidence.
 *
 * Exits non-zero if the engine fails to separate the two people, if the
 * challenge accepts a movement that did not happen, or if a substituted face
 * gets through.
 */
import { readFileSync } from 'node:fs';

import { env } from '@/lib/env';
import {
  DIRECTIONS,
  analyse,
  bestMatch,
  cosine,
  engineHealth,
  enrolmentSpread,
  toBytes,
  verifyLiveness,
  type Detection,
} from '@/services/hr/face';

const failures: string[] = [];
const check = (condition: boolean, description: string) => {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${description}`);
  if (!condition) failures.push(description);
};

const frame = (path: string) => readFileSync(path).toString('base64');

const describe = (name: string, detection: Detection) =>
  detection.ok
    ? `${name}: det=${detection.detScore!.toFixed(3)} area=${detection.bboxAreaRatio!.toFixed(3)} ` +
      `blur=${detection.blurScore!.toFixed(0)} yaw=${detection.yaw!.toFixed(1)} ` +
      `pitch=${detection.pitch!.toFixed(1)} dims=${detection.embedding!.length}`
    : `${name}: rejected — ${detection.error}`;

async function main() {
  const [sameA, sameB, other] = process.argv.slice(2);
  if (!sameA || !sameB || !other) {
    console.error(
      'Usage: npx tsx scripts/verify-face-matching.ts <same-a> <same-b> <different-person>\n' +
        'Two photographs of one person in different head poses, and one of somebody else.',
    );
    return 2;
  }

  console.log(`engine     ${env.FACE_SERVICE_URL || '(FACE_SERVICE_URL unset)'}`);
  const health = await engineHealth();
  console.log(`health     ready=${health.ready} — ${health.detail}`);
  if (!health.ready) {
    console.error('\nThe engine is not ready, so nothing below can be scored. Nothing was verified.');
    return 1;
  }
  console.log(`threshold  FACE_MATCH_THRESHOLD=${env.FACE_MATCH_THRESHOLD}\n`);

  const [neutral, turned, stranger] = await analyse([frame(sameA), frame(sameB), frame(other)]);
  console.log(describe(sameA, neutral!));
  console.log(describe(sameB, turned!));
  console.log(describe(other, stranger!));
  if (!neutral!.ok || !turned!.ok || !stranger!.ok) {
    console.error('\nAt least one photograph failed frame quality, so matching cannot be scored.');
    return 1;
  }

  const same = cosine(neutral!.embedding!, turned!.embedding!);
  const different = cosine(neutral!.embedding!, stranger!.embedding!);
  console.log('\nmatching');
  console.log(`  same person       cosine ${same.toFixed(4)}`);
  console.log(`  different person  cosine ${different.toFixed(4)}`);
  check(same >= env.FACE_MATCH_THRESHOLD, 'the same person scores at or above the threshold');
  check(different < env.FACE_MATCH_THRESHOLD, 'a different person scores below the threshold');

  // Through the stored representation, which is what a check-in actually compares against.
  const enrolled = [toBytes(neutral!.embedding!)];
  check(
    bestMatch(turned!.embedding!, enrolled) >= env.FACE_MATCH_THRESHOLD,
    'the match survives the round trip through the stored template bytes',
  );
  check(
    bestMatch(stranger!.embedding!, enrolled) < env.FACE_MATCH_THRESHOLD,
    'a stranger is refused against the stored template',
  );
  console.log(
    `  enrolment spread across the two poses: ${enrolmentSpread([neutral!.embedding!, turned!.embedding!]).toFixed(4)}`,
  );

  console.log('\nliveness');
  const results = DIRECTIONS.map((direction) => ({
    direction,
    result: verifyLiveness([neutral!, turned!], direction),
  }));
  for (const { direction, result } of results) {
    console.log(`  ${direction.padEnd(6)} passed=${result.passed} score=${result.score} — ${result.reason}`);
  }
  check(
    results.some(({ result }) => result.passed),
    'the movement between the two photographs satisfies a challenge',
  );
  check(
    results.some(({ result }) => !result.passed && /movement not detected/i.test(result.reason)),
    'a challenge the head did not answer is refused',
  );
  check(
    !verifyLiveness([neutral!, stranger!], DIRECTIONS[0]!).passed,
    'a second face substituted mid-challenge is refused',
  );
  check(!verifyLiveness([neutral!], DIRECTIONS[0]!).passed, 'a single frame is refused');

  console.log(
    failures.length === 0
      ? '\nface matching: all checks passed.'
      : `\nface matching: ${failures.length} check(s) failed.`,
  );
  return failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nfailed: ${(error as Error).message}`);
    process.exit(1);
  },
);
