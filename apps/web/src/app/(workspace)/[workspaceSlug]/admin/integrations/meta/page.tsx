import Link from 'next/link';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { metaConfig } from '@/services/meta/config';
import MetaConfiguration from '@/components/workspace/MetaConfiguration';

export const metadata = { title: 'Facebook & Instagram' };

/**
 * Meta administration (§2 of Phase 2B).
 *
 * Gated on viewing integrations to open, and on managing them to change
 * anything — the same split the rest of Settings uses. A sales rep reaching this
 * URL directly gets the workspace's standard refusal, and the API refuses them
 * again independently, because hiding a nav item is not access control.
 */
export default async function MetaIntegrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ connected?: string; page?: string; error?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const ctx = await requirePageAccess({ permission: ['integrations', 'VIEW'] });
  const config = await metaConfig(ctx.tenantId);

  /**
   * What the OAuth callback redirected back with. Read here rather than from
   * `window.location` in an effect: the person is arriving from Facebook and the
   * first paint should already say what happened.
   */
  const outcome =
    query.connected === 'meta'
      ? query.error
        ? { ok: false, text: query.error }
        : { ok: true, text: `Connected to ${query.page ?? 'Facebook'}.` }
      : null;

  return (
    <div className="lf-page-stack">
      <header className="lf-meta__head">
        <Link className="lf-meta__back" href={`/${workspaceSlug}/admin/integrations`}>
          ← Integrations
        </Link>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: '4px 0 0' }}>
          Facebook &amp; Instagram
        </h1>
        <p className="lf-meta__blurb">
          Connect Meta channels, sync lead forms and decide how new enquiries enter your CRM.
        </p>
      </header>

      <MetaConfiguration
        config={JSON.parse(JSON.stringify(config))}
        canEdit={can(ctx, 'integrations', 'MANAGE_CONFIGURATION')}
        outcome={outcome}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}
