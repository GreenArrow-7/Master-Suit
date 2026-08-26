import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';
import SettingEditor from '@/components/platform/SettingEditor';
import { env } from '@/lib/env';
import { getNumericSetting, getUploadMaxMb } from '@/lib/platform-settings';

export const dynamic = 'force-dynamic';

/**
 * Two kinds of rows, visibly different on purpose.
 *
 * Operator settings — session lifetime, idle timeout, the lockout thresholds
 * and the upload limit — are editable here and take effect immediately: they
 * live in the database and override the environment default. All five are read
 * at the point of use rather than captured at boot, which is what makes editing
 * them at runtime honest.
 * Deployment configuration (URLs, providers, proxies) is shown read-only from
 * the environment the server actually booted with: editing those at runtime
 * would produce a page that disagrees with the running process, which is worse
 * than making the operator restart.
 */
export default async function PlatformSettingsPage() {
  const [uploadMaxMb, sessionTtl, idleTimeout, maxFailedLogins, lockoutMinutes] = await Promise.all([
    getUploadMaxMb(),
    getNumericSetting('sessionTtlMinutes'),
    getNumericSetting('sessionIdleTimeoutMinutes'),
    getNumericSetting('maxFailedLogins'),
    getNumericSetting('lockoutMinutes'),
  ]);

  const readOnlyRows: [string, string, string][] = [
    ['Public application URL', env.APP_URL, 'Platform'],
    ['Environment', env.NODE_ENV, 'Platform'],
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
              'Session lifetime',
              <SettingEditor
                key="sessionTtlMinutes"
                settingKey="sessionTtlMinutes"
                value={`${sessionTtl}`}
                hint="Minutes a sign-in lasts before it must be renewed. 5–43200."
              />,
              'All users',
            ],
            [
              'Idle timeout',
              <SettingEditor
                key="sessionIdleTimeoutMinutes"
                settingKey="sessionIdleTimeoutMinutes"
                value={`${idleTimeout}`}
                hint="Minutes an unused session survives before it is refused. 1–10080."
              />,
              'All users',
            ],
            [
              'Failed sign-ins before lockout',
              <SettingEditor
                key="maxFailedLogins"
                settingKey="maxFailedLogins"
                value={`${maxFailedLogins}`}
                hint="Consecutive wrong passwords that lock an account. 3–100."
              />,
              'All users',
            ],
            [
              'Lockout duration',
              <SettingEditor
                key="lockoutMinutes"
                settingKey="lockoutMinutes"
                value={`${lockoutMinutes}`}
                hint="Minutes a locked account stays locked. 1–1440."
              />,
              'All users',
            ],
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
        <WorkspaceTable headers={['Setting', 'Current value', 'Scope']} rows={readOnlyRows.map((row) => [...row])} />
      </section>
    </div>
  );
}
