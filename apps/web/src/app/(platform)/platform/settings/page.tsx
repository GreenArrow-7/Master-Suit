import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Read from configuration, not written into the markup.
 *
 * Every row here used to be a string literal. "Public application URL:
 * http://localhost:3000" was shown to operators of a deployed platform, and
 * "Data isolation: PostgreSQL tenant policies" asserted row-level security was
 * in force at a time when it was not enforced at all — a settings page that
 * describes a system other than the one running is worse than no page, because
 * it is consulted precisely when someone is trying to find out what is true.
 */
export default function PlatformSettingsPage() {
  const rows: [string, string, string][] = [
    ['Public application URL', env.APP_URL, 'Platform'],
    ['Environment', env.NODE_ENV, 'Platform'],
    ['Session lifetime', `${env.SESSION_TTL_MINUTES} minutes`, 'All users'],
    ['Idle timeout', `${env.SESSION_IDLE_TIMEOUT_MINUTES} minutes`, 'All users'],
    ['Account lockout', `${env.MAX_FAILED_LOGINS} attempts, ${env.LOCKOUT_MINUTES} minutes`, 'All users'],
    [
      'Email delivery',
      env.EMAIL_PROVIDER === 'smtp' ? `SMTP · ${env.SMTP_HOST || 'not set'}` : 'Mock (not delivered)',
      'Platform',
    ],
    ['Antivirus scanning', env.ANTIVIRUS_PROVIDER, 'Uploads'],
    ['Upload limit', `${env.UPLOAD_MAX_MB} MB`, 'All workspaces'],
    ['Trusted proxies', env.TRUSTED_PROXY_CIDRS || 'not configured', 'Platform'],
    ['Object storage', `${env.S3_BUCKET} · ${env.S3_REGION}`, 'All workspaces'],
  ];

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Platform"
        title="Platform settings"
        description="The configuration this server is actually running with. Change it in the environment, then restart."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Settings' }]}
      />
      <WorkspaceTable headers={['Setting', 'Current value', 'Scope']} rows={rows.map((row) => [...row])} />
    </div>
  );
}
