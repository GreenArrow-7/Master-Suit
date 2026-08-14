import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';
import SettingEditor from '@/components/platform/SettingEditor';
import { env } from '@/lib/env';
import { getUploadMaxMb } from '@/lib/platform-settings';

export const dynamic = 'force-dynamic';

/**
 * Two kinds of rows, visibly different on purpose.
 *
 * Operator settings (the upload limit) are editable here and take effect
 * immediately — they live in the database and override the environment default.
 * Deployment configuration (URLs, providers, proxies) is shown read-only from
 * the environment the server actually booted with: editing those at runtime
 * would produce a page that disagrees with the running process, which is worse
 * than making the operator restart.
 */
export default async function PlatformSettingsPage() {
  const uploadMaxMb = await getUploadMaxMb();

  const readOnlyRows: [string, string, string][] = [
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
    ['Trusted proxies', env.TRUSTED_PROXY_CIDRS || 'not configured', 'Platform'],
    ['Object storage', `${env.S3_BUCKET} · ${env.S3_REGION}`, 'All workspaces'],
  ];

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Platform"
        title="Platform settings"
        description="Operator settings apply immediately. Deployment configuration is read from the environment and needs a restart to change."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Settings' }]}
      />

      <section>
        <h2 className="lf-h2" style={{ marginBottom: 10 }}>
          Operator settings
        </h2>
        <WorkspaceTable
          headers={['Setting', 'Current value', 'Scope']}
          rows={[
            [
              'Upload limit',
              <SettingEditor
                key="uploadMaxMb"
                settingKey="uploadMaxMb"
                value={`${uploadMaxMb}`}
                hint="Whole number of megabytes, 1–500. Applies to every workspace immediately."
              />,
              'All workspaces',
            ],
          ]}
        />
      </section>

      <section>
        <h2 className="lf-h2" style={{ marginBottom: 10 }}>
          Deployment configuration
        </h2>
        <WorkspaceTable
          headers={['Setting', 'Current value', 'Scope']}
          rows={readOnlyRows.map((row) => [...row])}
        />
      </section>
    </div>
  );
}
