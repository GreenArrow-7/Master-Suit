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
  test(`platform console fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
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
        return { docWidth: document.documentElement.scrollWidth, overlaps };
      }, width);
      expect(probe.docWidth, `${route}: no page-wide horizontal scroll`).toBeLessThanOrEqual(width);
      expect(probe.overlaps, `${route}: controls apart`).toEqual([]);
    }
  });
}
