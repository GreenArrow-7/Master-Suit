/**
 * Shared product code must not name one customer's company. The role page, the
 * live-coach demo script and the simulated Meta assets all carried the first
 * customer's name as a literal, so every other tenant read someone else's brand
 * as their own. Each now takes the name from the workspace record or the
 * branding constants; these checks keep the literal from coming back.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoScript } from '@/lib/ai/liveCoach';
import { DEMO_ASSETS } from '@/services/meta/config';
import { PRODUCT_NAME } from '@/lib/branding';

const CUSTOMER = /manath/i;

describe('shared copy names no single customer', () => {
  it('the live-coach demo script introduces the agent from the workspace it is given', () => {
    const turns = demoScript('Aisha', 'Omar Khan', 'Acme Realty');
    const intro = turns.find((t) => t.speaker === 'Agent' && /calling from/.test(t.text));
    expect(intro?.text).toContain('calling from Acme Realty');
    expect(turns.map((t) => t.text).join('\n')).not.toMatch(CUSTOMER);
  });

  it('the simulated Meta assets are named after the product', () => {
    expect(DEMO_ASSETS.businessName).toContain(PRODUCT_NAME);
    expect(DEMO_ASSETS.pageName).toContain(PRODUCT_NAME);
    expect(DEMO_ASSETS.instagramHandle).toMatch(/^@[a-z0-9]+demo$/);
    expect(JSON.stringify(DEMO_ASSETS)).not.toMatch(CUSTOMER);
  });

  it('the role page reads the organisation name from the workspace record', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src', 'app', '(workspace)', '[workspaceSlug]', 'profile', 'role', 'page.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(CUSTOMER);
    expect(source).toMatch(/workspace\.displayName/);
  });
});
