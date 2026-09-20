import { test, expect } from '@playwright/test';
import { loginPlatformOwner } from './helpers';

/**
 * The platform console keeps its own identity but meets the same bar: every
 * console screen at phone and desktop width fits the viewport, has a heading,
 * and keeps its controls apart. Signed in as the platform owner.
 */
const ROUTES = [
  '/platform',
  '/platform/workspaces',
  '/platform/workspaces/new',
  '/platform/users',
  '/platform/plans',
  '/platform/subscriptions',
  '/platform/security',
  '/platform/settings',
  '/platform/audit',
  '/platform/ai-usage',
  '/platform/system-health',
];

for (const width of [390, 1440]) {
  test(`platform console fits at ${width}px`, async ({ browser }) => {
    // A phone context, not a resized desktop one: a desktop context draws
    // classic 15px scrollbars, and any 100vw element then "overflows" by that
    // much without a real defect. Phones draw overlay scrollbars.
    const context = await browser.newContext({
      viewport: { width, height: width < 700 ? 844 : 900 },
      isMobile: width < 700,
      hasTouch: width < 700,
    });
    const page = await context.newPage();
    await loginPlatformOwner(page);
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
      const probe = await page.evaluate((vw) => {
        const vis = (e: Element) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && (e as HTMLElement).checkVisibility();
        };
        const controls = [...document.querySelectorAll('input, select, textarea, button, a')].filter(
          (e) => vis(e) && !['hidden', 'checkbox', 'radio'].includes((e as HTMLInputElement).type),
        );
        const overlaps: string[] = [];
        for (let i = 0; i < controls.length; i++)
          for (let j = i + 1; j < controls.length; j++) {
            if (controls[i]!.contains(controls[j]!) || controls[j]!.contains(controls[i]!)) continue;
            const a = controls[i]!.getBoundingClientRect();
            const b = controls[j]!.getBoundingClientRect();
            if (
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4
            )
              overlaps.push(`${controls[i]!.tagName} x ${controls[j]!.tagName}`);
          }
        // Only elements outside every horizontal scroller can widen the document;
        // name each with its ancestry so a failure says where the width comes from.
        const inScroller = (e: Element) => {
          for (let p = e.parentElement; p; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === 'auto' || o === 'scroll') return true;
          }
          return false;
        };
        const cw = document.documentElement.clientWidth;
        const beyond = [...document.querySelectorAll('body *')]
          .filter((e) => vis(e) && e.getBoundingClientRect().right > cw + 1 && !inScroller(e))
          .slice(0, 8)
          .map((e) => {
            const chain: string[] = [];
            for (let n: Element | null = e; n && chain.length < 4; n = n.parentElement)
              chain.push(`${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0] ?? ''}`);
            const r = e.getBoundingClientRect();
            return `${chain.join('<')} l=${Math.round(r.left)} w=${Math.round(r.width)}`;
          });
        const thead = document.querySelector('.lf-table thead');
        return {
          docWidth: document.documentElement.scrollWidth,
          // CI's Chromium reports innerWidth 392 for a 390px mobile context while
          // clientWidth stays 390; the document can scroll sideways only when it
          // is wider than the window, so that is the number to compare against.
          windowWidth: Math.max(document.documentElement.clientWidth, innerWidth),
          overlaps,
          beyond,
          env: {
            innerWidth,
            phoneMedia: matchMedia('(max-width: 760px)').matches,
            viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
            theadPosition: thead ? getComputedStyle(thead).position : null,
            wrapOverflowX: (() => {
              const w = document.querySelector('.lf-table-wrap');
              return w ? getComputedStyle(w).overflowX : null;
            })(),
            sheets: [...document.styleSheets].map((x) => (x.href ?? 'inline').split('/').pop()).slice(0, 12),
          },
        };
      }, width);
      expect(
        probe.docWidth,
        `${route}: no page-wide horizontal scroll (${probe.beyond.join('; ')}) env=${JSON.stringify(probe.env)}`,
      ).toBeLessThanOrEqual(probe.windowWidth + 1);
      expect(probe.overlaps, `${route}: controls apart`).toEqual([]);
    }
    await context.close();
  });
}
