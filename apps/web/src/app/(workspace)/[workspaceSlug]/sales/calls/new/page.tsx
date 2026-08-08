import { requirePageAccess } from '@/lib/workspace-page';
import NewCallForm from './NewCallForm';

/**
 * Server wrapper around a client form.
 *
 * The form itself is interactive and cannot check anything, so the permission
 * is asserted here. Without it the page rendered for anyone and only the POST
 * was refused — an editable form that cannot be submitted.
 */
export const metadata = { title: 'New call' };

export default async function NewCallPage() {
  await requirePageAccess({ module: 'SALES', permission: ['calls', 'CREATE'] });
  return <NewCallForm />;
}
