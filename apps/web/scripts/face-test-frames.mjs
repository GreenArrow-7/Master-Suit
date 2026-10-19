/**
 * Produces the frames `tests/e2e/face-attendance.spec.ts` sends to the face
 * engine, into FACE_TEST_IMAGES (default tests/faces-local/, git-ignored). Face
 * images are never committed — docs/TEST-DATA-POLICY.md.
 *
 * Sources: three public-domain NASA photographs on Wikimedia Commons (works of
 * the US federal government), downloaded once into <dir>/sources/ unless already
 * there. Person A is Ellen Ochoa (two different portraits), person B is Mae
 * Jemison. The engine reads the derived frames as the same person at yaw −11°
 * to +5.5°, which is the ≥ 12° left/right liveness swing; no 2D warp moves its
 * pitch estimate by the 10° an "up" challenge needs, so the spec re-draws "up".
 *
 * Each source is pinned by SHA-256, so CI (the face-e2e job) always tests the
 * same pictures: a file Commons replaces fails here by name instead of moving
 * the scores the spec relies on.
 *
 *   node scripts/face-test-frames.mjs            # from apps/web
 *   FACE_TEST_IMAGES=C:\somewhere node scripts/face-test-frames.mjs
 */
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.FACE_TEST_IMAGES || path.resolve('tests', 'faces-local');
const sources = path.join(dir, 'sources');
mkdirSync(sources, { recursive: true });

/** File:Ellen Ochoa.jpg, File:Ellen Ochoa, official portrait (cropped).jpg, File:Mae Jemison.jpg */
const SOURCES = {
  'ellen-ochoa.jpg': ['e/e8/Ellen_Ochoa.jpg', 'fad48e8e3d1a7e38fa328c2059040fcde95b0cc4b9f6647f48a91274bf8e7928'],
  'ellen-ochoa-portrait.jpg': [
    'a/ac/Ellen_Ochoa%2C_official_portrait_%28cropped%29.jpg',
    '05992260d250a73b6a3a63be7a6797376c91f322939ff56a8c3c1ba54ca14887',
  ],
  'mae-jemison.jpg': ['5/55/Mae_Carol_Jemison.jpg', '7f9c8203cbf9e1304e30eedc2577d245818790f74cb817c45b17fecf7f188776'],
};

/** Wikimedia answers a burst with 429; a cold CI cache is exactly a burst. */
async function download(url) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'youhan-one-face-test-frames/1.0 (development test data)' },
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt === 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${url}: ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
}

async function source(name) {
  const [upload, sha256] = SOURCES[name];
  const file = path.join(sources, name);
  if (!existsSync(file)) {
    writeFileSync(file, await download(`https://upload.wikimedia.org/wikipedia/commons/${upload}`));
    console.log('downloaded', name);
  }
  const bytes = readFileSync(file);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) {
    throw new Error(
      `${file} is not the pinned source (sha256 ${actual}). Delete it and re-run; if Commons replaced the picture, check the spec still passes and update SOURCES.`,
    );
  }
  return sharp(bytes).resize({ width: 640, withoutEnlargement: true }).toBuffer();
}

const jpeg = (image) => image.jpeg({ quality: 85 }).toBuffer();
const grey = { background: '#888' };
const a = await source('ellen-ochoa.jpg');
const b = await source('mae-jemison.jpg');
const frames = {
  'a-straight': await jpeg(sharp(a)),
  'a-mirror': await jpeg(sharp(a).flop()),
  'a-turned-left': await jpeg(
    sharp(a).affine(
      [
        [1, 0.25],
        [0, 1],
      ],
      grey,
    ),
  ),
  'a-turned-right': await jpeg(sharp(a).rotate(8, grey)),
  'a-narrow': await jpeg(
    sharp(a).affine(
      [
        [0.7, 0],
        [0, 1],
      ],
      grey,
    ),
  ),
  'a-portrait-2': await jpeg(sharp(await source('ellen-ochoa-portrait.jpg'))),
  'b-turned-left': await jpeg(
    sharp(b).affine(
      [
        [1, 0.25],
        [0, 1],
      ],
      grey,
    ),
  ),
  'b-turned-right': await jpeg(sharp(b).rotate(8, grey)),
};
for (const [name, buffer] of Object.entries(frames)) writeFileSync(path.join(dir, `${name}.jpg`), buffer);
console.log(`${Object.keys(frames).length} frames in ${dir}`);
