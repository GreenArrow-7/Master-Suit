import { requirePageAccess } from '@/lib/workspace-page';
import AccountDetail from '../../../admin/users/[userId]/page';

/**
 * One account, inside the HR module.
 *
 * The directory at /people/users links each name module-relatively, so a row
 * resolved to /people/users/{id} — a route that did not exist, and every name
 * in People > Users was a 404. Linking out to /admin/users instead would leave
 * the module: `activeModule` is derived from the path, so the Sales navigation
 * and theme would replace the HR shell mid-task.
 *
 * A wrapper for the same reason the list is one: `export { default } from …`
 * confuses the server-component module graph and drops the route to client
 * rendering.
 */
export const metadata = { title: 'Account' };

export default async function Page(props: { params: Promise<{ workspaceSlug: string; userId: string }> }) {
  // Checked here too: every routed page asserts its own access.
  await requirePageAccess({ permission: ['users', 'VIEW'] });
  return AccountDetail(props);
}
