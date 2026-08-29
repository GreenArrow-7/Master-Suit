import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import ContactForm from './ContactForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Add contact' };

export default async function NewContactPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['contacts', 'CREATE'] });
  if (!can(ctx, 'contacts', 'CREATE')) redirect('/contacts');

  /**
   * The account picker is optional; permission to create a contact is not
   * permission to browse accounts.
   *
   * `visibilityWhere` throws Forbidden on a NONE scope, and this call was
   * unguarded — so a role that may create contacts but not read accounts (a
   * Marketing Executive, in this workspace today) was refused the whole page
   * rather than shown a form with one fewer field. Contact and account are
   * separate grants; the page now treats them that way.
   */
  const accounts = can(ctx, 'accounts', 'VIEW')
    ? await prisma.account.findMany({
        where: await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true }),
        orderBy: { name: 'asc' },
        take: 200,
        select: { id: true, name: true },
      })
    : [];

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href="/contacts" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Contacts
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Add contact
      </h1>
      <ContactForm accounts={accounts} />
    </div>
  );
}
