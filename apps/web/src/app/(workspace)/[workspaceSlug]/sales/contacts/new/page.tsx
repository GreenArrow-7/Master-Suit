import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import ContactForm from './ContactForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add contact' };

export default async function NewContactPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  if (!can(ctx, 'contacts', 'CREATE')) redirect('/contacts');

  const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
  const accounts = await prisma.account.findMany({
    where: scope, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true },
  });

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/contacts" style={{ fontSize: 'var(--lf-text-sm)' }}>← Contacts</SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>Add contact</h1>
      <ContactForm accounts={accounts} />
    </div>
  );
}
