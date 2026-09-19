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
 *   node scripts/face-test-frames.mjs            # from apps/web
 *   FACE_TEST_IMAGES=C:\somewhere node scripts/face-test-frames.mjs
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.FACE_TEST_IMAGES || path.resolve('tests', 'faces-local');
const sources = path.join(dir, 'sources');
mkdirSync(sources, { recursive: true });

const SOURCES = {
  'ellen-ochoa.jpg': 'Ellen Ochoa.jpg',
  'ellen-ochoa-portrait.jpg': 'Ellen Ochoa, official portrait (cropped).jpg',
  'mae-jemison.jpg': 'Mae Jemison.jpg',
};

async function source(name) {
  const file = path.join(sources, name);
  if (!existsSync(file)) {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(SOURCES[name])}`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'youhan-one-face-test-frames/1.0 (development test data)' },
    });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('downloaded', name);
  }
  return sharp(readFileSync(file)).resize({ width: 640, withoutEnlargement: true }).toBuffer();
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
