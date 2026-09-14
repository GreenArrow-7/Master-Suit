import PageHeader from '@/components/ui/PageHeader';
import CredentialManager from '@/components/platform/CredentialManager';
import { requirePlatformPage } from '@/lib/platform-page';
import { credentialStatus } from '@/services/identity/platformCredentials';

export const dynamic = 'force-dynamic';

/**
 * The signed-in owner's own sign-in credentials.
 *
 * Owner console only, and so only from a session signed in with the
 * administration password: `requirePlatformPage` refuses a monitoring session.
 * Reads whether a monitoring password exists, never the hash; every change goes
 * through api/v1/platform/credentials, which re-authenticates.
 */
export default async function PlatformSecurityPage() {
  const ctx = await requirePlatformPage();
  const status = await credentialStatus(ctx.platformUserId);

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Platform"
        title="Sign-in and passwords"
        description={`${ctx.email} · administration session`}
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Sign-in and passwords' }]}
      />
      <CredentialManager
        hasMonitoringCredential={status.hasMonitoringCredential}
        monitoringCredentialSetAt={status.monitoringCredentialSetAt?.toISOString() ?? null}
        eligible={status.eligibleForMonitoringCredential}
        ineligibleReason={status.ineligibleReason}
      />
    </div>
  );
}
