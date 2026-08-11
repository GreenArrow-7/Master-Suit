import UsersDirectory from '../../admin/users/page';

/**
 * The user directory, inside the HR module.
 *
 * It previously lived only at /admin/users. Reaching it from the HR sidebar
 * navigated out of the module: `activeModule` is derived from the path, so
 * /admin/* rendered the Sales navigation and the burgundy theme, and the HR
 * screens appeared to vanish. Every module the HR shell offers now lives under
 * /people/*, which keeps the shell, the theme and the navigation intact.
 *
 * A wrapper rather than a re-export: `export { default } from …` confuses the
 * server-component module graph and drops the route to client rendering.
 */
export const metadata = { title: 'Users' };

export default async function Page(props: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string; role?: string; show?: string }>;
}) {
  return UsersDirectory(props);
}
