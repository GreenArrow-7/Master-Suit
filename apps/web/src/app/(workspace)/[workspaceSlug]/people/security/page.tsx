import { requirePageAccess, SELF_SERVICE } from '@/lib/workspace-page';
import SecurityPage from '../../profile/security/page';

/** Security, inside the HR module. See users/page.tsx for why. */
export const metadata = { title: 'Security' };

export default async function Page(props: { params: Promise<{ workspaceSlug: string }> }) {
  await requirePageAccess({ permission: SELF_SERVICE });
  return SecurityPage(props);
}
