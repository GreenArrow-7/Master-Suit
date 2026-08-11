import { requirePageAccess } from '@/lib/workspace-page';
import RolesAdmin from '../../admin/roles/page';

/** Roles & permissions, inside the HR module. See users/page.tsx for why. */
export const metadata = { title: 'Roles & permissions' };

export default async function Page(props: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ roleId?: string }>;
}) {
  await requirePageAccess({ permission: ['roles', 'VIEW'] });
  return RolesAdmin(props);
}
