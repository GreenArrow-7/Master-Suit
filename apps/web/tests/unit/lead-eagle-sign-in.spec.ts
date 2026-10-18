/**
 * PROD-13: Lead Eagle's own sign-in door (`/login?product=lead-eagle`).
 *
 * The same page, form, endpoint and accounts as `/login`, under Lead Eagle's
 * name; the trial link only while sign-up is open and never inside the iOS app.
 * Plain `/login` is unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const req = vi.hoisted(() => ({ ua: '', offer: null as null | { days: number } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': req.ua }) }));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {} }),
}));
vi.mock('@/services/platform/signup', () => ({ signupOffer: async () => req.offer }));
vi.mock('@/lib/value/platformValue', () => ({ platformValue: async () => null }));

import LoginPage from '@/app/(auth)/login/page';
import LoginForm from '@/app/(auth)/login/LoginForm';
import AuthShell from '@/components/auth/AuthShell';
import { LEAD_EAGLE_LOGIN, loginPathFor } from '@/lib/security/redirect';

const IOS_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YouhanOneApp/1.2.0';

async function render(
  params: Record<string, string>,
  { ua = '', offer = { days: 14 } as null | { days: number } } = {},
) {
  req.ua = ua;
  req.offer = offer;
  const page = (await LoginPage({ searchParams: Promise.resolve(params) })) as ReactElement<{ children: ReactNode }>;
  // AuthShell is an async server component; renderToStaticMarkup cannot await it.
  const shell = await AuthShell(page.props as Parameters<typeof AuthShell>[0]);
  return { page, html: renderToStaticMarkup(shell) };
}

const forms = (node: ReactNode): ReactElement<{ next?: string | null; product?: string }>[] =>
  [node]
    .flat(Infinity as 1)
    .flatMap((child) =>
      !isValidElement(child)
        ? []
        : child.type === LoginForm
          ? [child as ReactElement<{ product?: string }>]
          : forms((child.props as { children?: ReactNode }).children),
    );

describe('Lead Eagle sign-in', () => {
  it('is the same sign-in form under the Lead Eagle name, with the trial link while sign-up is open', async () => {
    const { page, html } = await render({ product: 'lead-eagle', next: '/acme/lead-eagle/leads' });
    // One LoginForm, the plain page's own component: the same POST /api/v1/auth/login.
    expect(page.type).toBe(AuthShell);
    expect(forms(page)).toHaveLength(1);
    expect(forms(page)[0].props).toMatchObject({ next: '/acme/lead-eagle/leads', product: 'Lead Eagle' });
    expect(html).toContain('>Lead Eagle</span>');
    expect(html).toContain('Sign in to Lead Eagle with your YOUHAN ONE account.');
    expect(html).toContain('<a href="/signup">Start your Lead Eagle trial</a>');
    expect(html).not.toContain('Working as one');
  });

  it('hides the trial link inside the iOS app', async () => {
    const { html } = await render({ product: 'lead-eagle' }, { ua: IOS_APP });
    expect(html).toContain('>Lead Eagle</span>');
    expect(html).not.toContain('/signup');
  });

  it('hides the trial link while sign-up is closed', async () => {
    const { html } = await render({ product: 'lead-eagle' }, { offer: null });
    expect(html).toContain('>Lead Eagle</span>');
    expect(html).not.toContain('/signup');
  });

  it.each([
    ['no product', {}],
    ['another product', { product: 'sales' }],
  ])('leaves every other sign-in as it was: %s', async (_label, params) => {
    const { page, html } = await render(params);
    expect(forms(page)).toHaveLength(1);
    expect(forms(page)[0].props.product).toBeUndefined();
    expect(html).not.toContain('Lead Eagle');
    expect(html).toContain('Sign in to your workspace.');
    expect(html).toContain('Working as one');
    expect(html).toContain('<a href="/signup">Start a 14-day free trial</a>');
  });
});

describe('the way back to Lead Eagle', () => {
  it('sends a signed-out visitor on a Lead Eagle screen to the Lead Eagle door', () => {
    expect(loginPathFor('/acme/lead-eagle/leads/42', '?tab=calls')).toBe(
      `${LEAD_EAGLE_LOGIN}&next=%2Facme%2Flead-eagle%2Fleads%2F42%3Ftab%3Dcalls`,
    );
    expect(loginPathFor('/acme/lead-eagle')).toBe(`${LEAD_EAGLE_LOGIN}&next=%2Facme%2Flead-eagle`);
  });

  it('keeps every other screen on the plain door', () => {
    expect(loginPathFor('/acme/sales/leads/42')).toBe('/login?next=%2Facme%2Fsales%2Fleads%2F42');
    expect(loginPathFor('/lead-eagle-co/dashboard')).toBe('/login?next=%2Flead-eagle-co%2Fdashboard');
  });
});
