import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';

export default function PlatformSettingsPage() {
  return <div className="lf-page-stack">
    <PageHeader eyebrow="Platform" title="Platform settings" description="Review the operating defaults applied across all customer workspaces." breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Settings' }]} />
    <WorkspaceTable headers={['Setting', 'Current value', 'Scope']} rows={[
      ['Public application URL', 'http://localhost:3000', 'Platform'],
      ['Default region', 'Asia/Dubai', 'New workspaces'],
      ['Default currency', 'AED', 'New workspaces'],
      ['Authentication authority', 'Unified PlatformSession', 'All users'],
      ['Data isolation', 'PostgreSQL tenant policies', 'All workspaces'],
    ]} />
  </div>;
}
