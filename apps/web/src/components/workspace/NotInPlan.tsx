import Link from 'next/link';
import { headers } from 'next/headers';
import { can } from '@/lib/security/rbac';
import { moduleNames } from '@/lib/security/entitlements';
import { requestCtx } from '@/lib/workspace-page';
import type { ProductModuleKey } from '@/lib/modules/catalogue';

/**
 * What a module layout shows for a screen the workspace's plan does not include.
 *
 * The layouts used to send it to the dashboard without a word (M2-05), so a
 * Lead Eagle administrator opening Events could not tell a missing product from
 * a broken link. Like forbidden.tsx it renders inside the workspace shell, and
 * it is not an error: nothing failed, the plan simply lacks the product.
 *
 * The screen is named from the URL (`/{slug}/sales/site-visits/…` → "Site
 * visits"); a module root has no name of its own and is "This screen".
 */
export default async function NotInPlan({
  slug,
  module,
}: {
  slug: string;
  /** The products that carry this screen; any one would open it. */
  module: ProductModuleKey | readonly ProductModuleKey[];
}) {
  const ctx = await requestCtx();
  const root = ((await headers()).get('x-pathname') ?? '').split('/')[3];
  const screen = root ? `${root[0]!.toUpperCase()}${root.slice(1).replaceAll('-', ' ')}` : 'This screen';
  const names = moduleNames(module);

  return (
    <div className="lf-empty" style={{ maxWidth: 520, margin: '10vh auto', textAlign: 'center' }}>
      <h1 className="lf-h2" style={{ margin: 0 }}>
        {screen} is part of {names}.
      </h1>
      <p style={{ margin: '8px auto 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
        This workspace’s plan does not include it.
        {can(ctx, 'settings', 'MANAGE_CONFIGURATION') &&
          ` The plan is set by your platform provider: ask them to add ${names}.`}
      </p>
      <Link className="lf-btn" style={{ marginTop: 'var(--lf-space-5)' }} href={`/${slug}/dashboard`}>
        Back to the dashboard
      </Link>
    </div>
  );
}
