import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { can } from '@/lib/security/rbac';
import { moduleNames } from '@/lib/security/entitlements';
import { sameScreenElsewhere } from '@/lib/nav/realtyShared';
import { requestCtx, workspaceOwns } from '@/lib/workspace-page';
import { PRODUCT_MODULE_KEYS, type ProductModuleKey } from '@/lib/modules/catalogue';
import RecheckOnNavigate from './RecheckOnNavigate';

/**
 * What a module layout shows for a screen the workspace's plan does not include.
 *
 * The layouts used to send it to the dashboard without a word (M2-05), so a
 * Lead Eagle administrator opening Events could not tell a missing product from
 * a broken link. Like forbidden.tsx it renders inside the workspace shell, and
 * it is not an error: nothing failed, the plan simply lacks the product.
 *
 * When the plan has the same screen under another folder (a `/sales/` record
 * link in a Lead Eagle workspace, an old bookmark of People's check-in), it sends
 * the viewer there instead; otherwise it names every product that carries the
 * screen. The screen is named from the URL (`/{slug}/sales/site-visits/…` →
 * "Site visits"); a module root has no name of its own and is "This screen".
 *
 * The layout above stays mounted while this shows, and Next still renders the
 * page beneath it (unseen), so each page asserts its own module as well.
 */
export default async function NotInPlan({
  slug,
  module,
}: {
  slug: string;
  /** The product of the folder the layout gates; any other that carries the screen is added from the URL. */
  module: ProductModuleKey | readonly ProductModuleKey[];
}) {
  const header = await headers();
  const path = header.get('x-pathname') ?? '';
  const elsewhere = sameScreenElsewhere(`${path}${header.get('x-search') ?? ''}`);
  for (const [product, target] of elsewhere) {
    if (!product || (await workspaceOwns(slug, product))) redirect(target);
  }

  const ctx = await requestCtx();
  const root = path.split('/')[3];
  const screen = root ? `${root[0]!.toUpperCase()}${root.slice(1).replaceAll('-', ' ')}` : 'This screen';
  const carriers = new Set<ProductModuleKey | null>([[module].flat(), elsewhere.map(([product]) => product)].flat());
  const names = moduleNames(PRODUCT_MODULE_KEYS.filter((key) => carriers.has(key)));

  return (
    <div className="lf-empty" style={{ maxWidth: 520, margin: '10vh auto', textAlign: 'center' }}>
      <RecheckOnNavigate path={path} />
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
