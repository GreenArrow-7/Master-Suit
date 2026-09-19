// Renders the YOUHAN ONE mark (apps/web/src/app/icon.svg) into the Android launcher and
// splash resources and the iOS app icon and splash image. Run from apps/mobile:
//   node scripts/render-brand-assets.mjs
// Uses the Playwright Chromium already installed for apps/web; no image tooling is added.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '..');
const web = path.resolve(mobile, '..', 'web');
const { chromium } = createRequire(path.join(web, 'package.json'))('@playwright/test');

const MIDNIGHT = '#020817';
const source = readFileSync(path.join(web, 'src/app/icon.svg'), 'utf8');
// The mark alone: the favicon's rounded midnight tile removed.
const mark = source.replace(/<rect[^>]*\/>/, '').replace('width="32" height="32"', 'width="100%" height="100%"');

/** The mark centred at `share` of the shorter side, on an optional filled square, tile or circle. */
function html(width, height, { background, share, round = false, tile = false }) {
  const side = Math.min(width, height) * share;
  const shape = round ? 'border-radius:50%;' : tile ? `border-radius:${Math.round(width * 0.22)}px;` : '';
  const fill = background ? `background:${background};` : '';
  return `<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${width}px;height:${height}px;display:grid;place-items:center;${fill}${shape}">
      <div style="width:${side}px;height:${side}px">${mark}</div>
    </div></body></html>`;
}

const res = path.join(mobile, 'android/app/src/main/res');
const ios = path.join(mobile, 'ios/App/App/Assets.xcassets');
const jobs = [];
for (const [density, legacy, foreground] of [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]) {
  // The mark spans ~75% of its viewBox; these shares keep it inside each shape's safe zone.
  jobs.push([`${res}/mipmap-${density}/ic_launcher.png`, legacy, legacy, { background: MIDNIGHT, share: 0.8, tile: true }]);
  jobs.push([`${res}/mipmap-${density}/ic_launcher_round.png`, legacy, legacy, { background: MIDNIGHT, share: 0.72, round: true }]);
  jobs.push([`${res}/mipmap-${density}/ic_launcher_foreground.png`, foreground, foreground, { share: 0.62 }]);
}
for (const [dir, width, height] of [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
])
  jobs.push([`${res}/${dir}/splash.png`, width, height, { background: MIDNIGHT, share: 0.3 }]);
// iOS app icons must be opaque and full-bleed; the system applies the corner mask.
jobs.push([`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, 1024, 1024, { background: MIDNIGHT, share: 0.78 }]);
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  jobs.push([`${ios}/Splash.imageset/${name}`, 2732, 2732, { background: MIDNIGHT, share: 0.18 }]);

const browser = await chromium.launch();
try {
  for (const [file, width, height, options] of jobs) {
    const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await tab.setContent(html(width, height, options));
    const transparent = !options.background || options.round || options.tile;
    await tab.screenshot({ path: file, omitBackground: transparent, type: 'png' });
    await tab.close();
    console.log('wrote', path.relative(mobile, file), `${width}x${height}`);
  }
} finally {
  await browser.close();
}
