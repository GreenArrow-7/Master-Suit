import SecurityPage from '../../profile/security/page';

/** Security, inside the HR module. See users/page.tsx for why. */
export const metadata = { title: 'Security' };

export default async function Page(props: { params: Promise<{ workspaceSlug: string }> }) {
  return SecurityPage(props);
}
