import { resolveWorkspacePage } from '@/lib/workspace-page';
import HrPolicyForm, { type Definition } from '@/components/workspace/HrPolicyForm';
import { isHrAdmin } from '@/services/hr/leave';
import { getHrPolicy, GROUP_LABELS, HR_SETTINGS, type SettingGroup } from '@/services/hr/settings';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'EDIT'] });
  const policy = await getHrPolicy(ctx);
  const admin = isHrAdmin(ctx);

  const groups = (Object.keys(GROUP_LABELS) as SettingGroup[])
    .map((key) => ({
      key,
      label: GROUP_LABELS[key],
      definitions: HR_SETTINGS.filter((setting) => setting.group === key) as unknown as Definition[],
    }))
    .filter((group) => group.definitions.length > 0);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>HR policy</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '78ch' }}>
          Every tunable parameter behind attendance, leave and settlement, editable for this workspace. Anything left at
          its default follows the product default, including when a release changes it — only values you actually change
          are stored.
          {admin
            ? ' Each change is written to the audit log with its old and new value.'
            : ' You can see these but only an administrator can change them.'}
        </p>
      </section>

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Before you change anything</h2>
        <ul
          style={{
            margin: '10px 0 0',
            paddingLeft: 20,
            color: 'var(--lf-ink-600)',
            fontSize: 'var(--lf-text-sm)',
            display: 'grid',
            gap: 6,
          }}
        >
          <li>
            <strong>Face match threshold</strong> is the one to tune first, and the one to tune with evidence. Enrol ten
            staff, let them check in for a week, then look at the score distribution in the attendance review queue.
            Lowering it to stop complaints is how you end up accepting the wrong person.
          </li>
          <li>
            Values marked <span className="lf-badge">statutory</span> come from UAE Federal Decree-Law 33/2021. Company
            policy may be <em>more</em> generous than these figures, never less. Have a UAE labour lawyer confirm
            anything you change here before it touches a payout.
          </li>
          <li>
            Gratuity and leave figures apply from the moment they are saved. Settlements already recorded keep the
            policy version they were calculated under, so past payouts are not retrospectively rewritten.
          </li>
        </ul>
      </section>

      <HrPolicyForm
        endpoint={`/api/v1/workspaces/${workspaceSlug}/hr/actions`}
        groups={groups}
        policy={policy as unknown as Record<string, unknown>}
        readOnly={!admin}
      />
    </div>
  );
}
