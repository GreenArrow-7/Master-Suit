import { prisma } from '@/lib/db';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { AI_TOKEN_LIMIT_KEY } from '@/lib/ai/usage';
import PlanForm from './PlanForm';

export default async function Page() {
  const plans = await prisma.subscriptionPlan.findMany({
    include: { planModules: true, planLimits: true, _count: { select: { subscriptions: true } } },
    orderBy: { name: 'asc' },
  });
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">Commercial</div>
        <h1 style={{ margin: '8px 0 0' }}>Subscription plans</h1>
      </div>
      <PlanForm />
      <WorkspaceTable
        headers={[
          'Plan',
          'Code',
          'Modules',
          'Users',
          'Employees',
          'Storage MB',
          'AI tokens / month',
          'Subscriptions',
          'Active',
        ]}
        rows={plans.map((plan) => [
          plan.name,
          plan.code,
          (plan.planModules.length
            ? plan.planModules.filter((module) => module.enabled).map((module) => module.module)
            : plan.modules
          ).join(' + '),
          plan.planLimits.find((limit) => limit.key === 'users')?.value ?? plan.seatLimit,
          plan.planLimits.find((limit) => limit.key === 'employees')?.value ?? '—',
          plan.planLimits.find((limit) => limit.key === 'storage_mb')?.value ?? plan.storageMb,
          // "No limit", not "0": an absent row means no ceiling has been
          // decided, and the AI is unrestricted for this tier.
          plan.planLimits.find((limit) => limit.key === AI_TOKEN_LIMIT_KEY)?.value?.toLocaleString('en-GB') ??
            'No limit',
          plan._count.subscriptions,
          plan.active ? 'Yes' : 'No',
        ])}
      />
    </div>
  );
}
