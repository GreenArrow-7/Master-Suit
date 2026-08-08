import { prisma } from '@/lib/db';
import NewWorkspaceForm from './NewWorkspaceForm';
import PageHeader from '@/components/ui/PageHeader';

export default async function NewWorkspacePage() {
  const plans = await prisma.subscriptionPlan.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  return (
    <div className="lf-page-stack" style={{ maxWidth: 980 }}>
      <PageHeader
        eyebrow="Customer provisioning"
        title="Create workspace"
        description="Provision the company, administrator, subscription and product access in five reviewed steps."
        breadcrumbs={[
          { label: 'Platform', href: '/platform' },
          { label: 'Workspaces', href: '/platform/workspaces' },
          { label: 'Create' },
        ]}
      />
      <NewWorkspaceForm plans={plans.map((plan) => ({ code: plan.code, name: plan.name, modules: plan.modules }))} />
    </div>
  );
}
