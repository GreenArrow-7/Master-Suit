import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import AccountForm from './AccountForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add account' };

export default async function NewAccountPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  if (!can(ctx, 'accounts', 'CREATE')) redirect('/accounts');

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/accounts" style={{ fontSize: 'var(--lf-text-sm)' }}>← Accounts</SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>Add account</h1>
      <AccountForm />
    </div>
  );
}
