import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { prisma } from '@/lib/db';
import ContactForm from '../../new/ContactForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Edit contact' };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['contacts', 'EDIT'] });

  const scope = await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true });
  const contact = await prisma.contact.findFirst({
    where: { ...scope, id },
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      email: true,
      phone: true,
      accountId: true,
      account: { select: { id: true, name: true } },
    },
  });
  if (!contact) notFound();

  const rules = await loadFieldRules(ctx, 'CONTACT');
  const safe = applyFieldSecurity(ctx, 'CONTACT', rules, contact) as typeof contact;

  const accountScope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
  const accounts = await prisma.account.findMany({
    where: accountScope,
    orderBy: { name: 'asc' },
    take: 200,
    select: { id: true, name: true },
  });
  // Keep the current account selectable even when it falls outside the first
  // 200 or the viewer's account scope — otherwise saving would silently unlink it.
  const current = contact.account;
  if (current && !accounts.some((a) => a.id === current.id)) accounts.unshift(current);

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href={`/contacts/${contact.id}`} style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← {contact.fullName}
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Edit contact
      </h1>
      <ContactForm
        accounts={accounts}
        contactId={contact.id}
        initial={{
          fullName: safe.fullName,
          jobTitle: safe.jobTitle,
          email: safe.email,
          phone: safe.phone,
          accountId: contact.accountId,
        }}
      />
    </div>
  );
}
