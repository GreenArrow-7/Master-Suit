import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { prisma } from '@/lib/db';
import AccountForm from '../../new/AccountForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Edit account' };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['accounts', 'EDIT'] });

  const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
  const account = await prisma.account.findFirst({
    where: { ...scope, id },
    select: {
      id: true,
      name: true,
      accountType: true,
      industry: true,
      website: true,
      mainPhone: true,
      mainEmail: true,
    },
  });
  if (!account) notFound();

  const rules = await loadFieldRules(ctx, 'ACCOUNT');
  const safe = applyFieldSecurity(ctx, 'ACCOUNT', rules, account) as typeof account;

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href={`/accounts/${account.id}`} style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← {account.name}
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Edit account
      </h1>
      <AccountForm
        accountId={account.id}
        initial={{
          name: safe.name,
          accountType: safe.accountType,
          industry: safe.industry,
          website: safe.website,
          mainPhone: safe.mainPhone,
          mainEmail: safe.mainEmail,
        }}
      />
    </div>
  );
}
