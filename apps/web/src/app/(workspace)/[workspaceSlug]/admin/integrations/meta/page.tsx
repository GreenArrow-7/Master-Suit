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
export default async function MetaIntegrationPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requirePageAccess({ permission: ['integrations', 'VIEW'] });
  const config = await metaConfig(ctx.tenantId);

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
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}
